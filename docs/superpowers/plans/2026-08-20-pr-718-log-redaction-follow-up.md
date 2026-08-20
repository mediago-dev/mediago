# PR 718 Downloader Log Redaction Follow-up Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain URL origins and valid Header names in downloader diagnostics while preventing command parameter values from reaching downloader-owned logs.

**Architecture:** Derive structured diagnostic fields directly from typed download inputs rather than logging a reconstructed command array. Small fail-closed helpers sanitize URL origins, Header names, and proxy state; integration tests capture the real Zap entries and separately exercise non-M3U8 success and M3U8 missing-output failure paths.

**Tech Stack:** Go, `net/url`, Zap structured logging, `zaptest/observer`, standard Go tests.

---

## Chunk 1: Fail-closed downloader diagnostics

### Task 1: URL Origin Sanitizer

**Files:**

- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] **Step 1: Write the failing URL sanitizer test**

Add this complete test to `downloader_test.go`:

```go
func TestURLOriginForLog(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{"removes credentials and resource data", "https://encoded%2Duser:password@example.com:8443/private/video.m3u8?token=query-secret#fragment-secret", "https://example.com:8443"},
		{"retains a valid origin", "http://media.example/video", "http://media.example"},
		{"rejects a relative URL", "/private/video?token=secret", "[REDACTED]"},
		{"rejects a missing host", "https:///private/video", "[REDACTED]"},
		{"rejects a malformed escape", "https://example.com/%zz-secret", "[REDACTED]"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := urlOriginForLog(test.raw); got != test.want {
				t.Fatalf("urlOriginForLog(%q) = %q, want %q", test.raw, got, test.want)
			}
		})
	}
}
```

- [x] **Step 2: Run the test and verify RED**

From `apps/core`, run:

```bash
go test ./internal/core -run '^TestURLOriginForLog$' -count=1
```

Expected: compilation fails because `urlOriginForLog` is undefined.

- [x] **Step 3: Implement the minimal sanitizer**

Add near `headerValue` in `downloader.go`:

```go
const redactedLogValue = "[REDACTED]"

func urlOriginForLog(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Opaque != "" {
		return redactedLogValue
	}
	return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host}).String()
}
```

- [x] **Step 4: Run the same focused command and verify GREEN**

Expected: PASS.

### Task 2: Header Names and Proxy State

**Files:**

- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] **Step 1: Write the failing Header-name test**

```go
func TestHeaderNamesForLog(t *testing.T) {
	tests := []struct {
		name    string
		headers []string
		want    []string
	}{
		{"valid names", []string{"Authorization: Bearer header-secret", "X-Debug_Trace: trace-secret"}, []string{"Authorization", "X-Debug_Trace"}},
		{"missing colon", []string{"malformed-secret"}, []string{"[REDACTED]"}},
		{"empty name", []string{" : empty-name-secret"}, []string{"[REDACTED]"}},
		{"invalid name", []string{"Bad Header: invalid-name-secret"}, []string{"[REDACTED]"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := headerNamesForLog(test.headers); !slices.Equal(got, test.want) {
				t.Fatalf("headerNamesForLog() = %q, want %q", got, test.want)
			}
		})
	}
}
```

- [x] **Step 2: Run the Header test and verify RED**

```bash
go test ./internal/core -run '^TestHeaderNamesForLog$' -count=1
```

Expected: compilation fails because `headerNamesForLog` is undefined.

- [x] **Step 3: Implement Header field-name validation**

```go
func headerNameForLog(header string) string {
	name, _, found := strings.Cut(header, ":")
	name = strings.TrimSpace(name)
	if !found || name == "" {
		return redactedLogValue
	}
	for i := 0; i < len(name); i++ {
		char := name[i]
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') || strings.ContainsRune("!#$%&'*+-.^_`|~", rune(char)) {
			continue
		}
		return redactedLogValue
	}
	return name
}

func headerNamesForLog(headers []string) []string {
	names := make([]string, 0, len(headers))
	for _, header := range headers {
		names = append(names, headerNameForLog(header))
	}
	return names
}
```

- [x] **Step 4: Run the same Header command and verify GREEN**

Expected: PASS.

- [x] **Step 5: Write the failing proxy truth-table test**

```go
type pointerDownloaderConfig struct {
	useProxy bool
	proxy    string
}

func (c *pointerDownloaderConfig) GetUseProxy() bool { return c.useProxy }
func (c *pointerDownloaderConfig) GetProxy() string  { return c.proxy }

func TestProxyConfiguredForLog(t *testing.T) {
	tests := []struct {
		name string
		cfg  interface{}
		want bool
	}{
		{"unsupported config", struct{}{}, false},
		{"untyped nil", nil, false},
		{"typed nil", (*pointerDownloaderConfig)(nil), false},
		{"disabled with value", testDownloaderConfig{proxy: "https://proxy.example?token=secret"}, false},
		{"enabled without value", testDownloaderConfig{useProxy: true}, false},
		{"enabled with value", testDownloaderConfig{useProxy: true, proxy: "https://proxy.example?token=secret"}, true},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := proxyConfiguredForLog(test.cfg); got != test.want {
				t.Fatalf("proxyConfiguredForLog() = %v, want %v", got, test.want)
			}
		})
	}
}
```

- [x] **Step 6: Run the proxy test and verify RED**

```bash
go test ./internal/core -run '^TestProxyConfiguredForLog$' -count=1
```

Expected: compilation fails because `proxyConfiguredForLog` is undefined.

- [x] **Step 7: Implement the non-panicking proxy helper**

Add `reflect` to `downloader.go`'s imports, then add:

```go
type downloaderProxyConfig interface {
	GetUseProxy() bool
	GetProxy() string
}

func proxyConfiguredForLog(cfg interface{}) bool {
	if cfg == nil {
		return false
	}
	value := reflect.ValueOf(cfg)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice, reflect.UnsafePointer:
		if value.IsNil() {
			return false
		}
	}
	proxyCfg, ok := cfg.(downloaderProxyConfig)
	return ok && proxyCfg.GetUseProxy() && proxyCfg.GetProxy() != ""
}
```

- [x] **Step 8: Run the same proxy command and verify GREEN**

Expected: PASS.

### Task 3: Successful Download Log Boundary

**Files:**

- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] **Step 1: Write the failing real-log regression test**

Add imports for `fmt`, `go.uber.org/zap/zapcore`, and `go.uber.org/zap/zaptest/observer`, then add:

```go
func TestDownloadLogsStructuredDiagnosticsWithoutParameterValues(t *testing.T) {
	observedCore, observedLogs := observer.New(zapcore.DebugLevel)
	observedLogger := zap.New(observedCore)
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger, logger.Sugar = observedLogger, observedLogger.Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previousLogger, previousSugar })

	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "youtube")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	const (
		downloadURL = "https://url-user-secret:url-pass-secret@media.example:8443/url-path-secret/video?token=url-query-secret#url-fragment-secret"
		downloadName = "download-name-secret"
		headerOne = "Authorization: header-one-secret"
		headerTwo = "X-Debug-Trace: header-two-secret"
		proxyValue = "https://proxy.example:9443/proxy-path-secret?token=proxy-query-secret"
		commonValue = "common-argument-secret"
	)
	localDir := filepath.Join(tempDir, "local-dir-secret")
	testSchema := schema.Schema{Type: string(TypeYoutube), Args: map[string]schema.ArgSpec{
		"url": {ArgsName: []string{}},
		"localDir": {ArgsName: []string{"--paths"}},
		"name": {ArgsName: []string{"--output"}},
		"headers": {ArgsName: []string{"--add-header"}},
		"proxy": {ArgsName: []string{"--proxy"}},
		"__common__": {ArgsName: []string{"--fixed", commonValue}},
	}}

	var capturedArgs []string
	d := NewDownloader(
		map[DownloadType]string{TypeYoutube: bin},
		runnerFunc(func(_ context.Context, _ string, args []string, _ func(string)) error {
			capturedArgs = slices.Clone(args)
			return nil
		}),
		schema.SchemaList{Schemas: []schema.Schema{testSchema}},
		testDownloaderConfig{localDir: localDir, useProxy: true, proxy: proxyValue},
	)
	params := DownloadParams{ID: "log-test", Type: TypeYoutube, URL: downloadURL, Name: downloadName, Headers: []string{headerOne, headerTwo}}
	if err := d.Download(context.Background(), params, Callbacks{}); err != nil {
		t.Fatalf("Download() error = %v", err)
	}

	secrets := []string{"url-user-secret", "url-pass-secret", "url-path-secret", "url-query-secret", "url-fragment-secret", downloadName, "header-one-secret", "header-two-secret", "proxy-path-secret", "proxy-query-secret", commonValue, "local-dir-secret"}
	for _, entry := range observedLogs.All() {
		serialized := entry.Message + fmt.Sprint(entry.ContextMap())
		for _, secret := range secrets {
			if strings.Contains(serialized, secret) {
				t.Fatalf("downloader log contains secret %q", secret)
			}
		}
	}

	startEntries := observedLogs.FilterMessage("Starting download task").All()
	if len(startEntries) != 1 {
		t.Fatalf("start log count = %d, want 1", len(startEntries))
	}
	startContext := startEntries[0].ContextMap()
	if startContext["url_origin"] != "https://media.example:8443" || startContext["id"] != "log-test" || startContext["type"] != string(TypeYoutube) {
		t.Fatalf("unexpected start context: %v", startContext)
	}
	if _, found := startContext["url"]; found {
		t.Fatal("legacy url field remained")
	}
	if _, found := startContext["name"]; found {
		t.Fatal("download name field remained")
	}

	argumentEntries := observedLogs.FilterMessage("Command arguments built").All()
	if len(argumentEntries) != 1 {
		t.Fatalf("argument log count = %d, want 1", len(argumentEntries))
	}
	argumentContext := argumentEntries[0].ContextMap()
	if fmt.Sprint(argumentContext["arg_count"]) != "13" || argumentContext["url_origin"] != "https://media.example:8443" || argumentContext["proxy_configured"] != true {
		t.Fatalf("unexpected argument context: %v", argumentContext)
	}
	if fmt.Sprint(argumentContext["header_names"]) != "[Authorization X-Debug-Trace]" {
		t.Fatalf("unexpected header names: %v", argumentContext["header_names"])
	}
	if _, found := argumentContext["args"]; found {
		t.Fatal("legacy args field remained")
	}

	if len(capturedArgs) != 13 {
		t.Fatalf("runner arg count = %d, want 13", len(capturedArgs))
	}
	assertStandaloneArgCount(t, "youtube", "url", capturedArgs, 1, downloadURL)
	assertAdjacentArgCount(t, "youtube", "local directory", capturedArgs, 1, "--paths", localDir)
	assertAdjacentArgCount(t, "youtube", "name", capturedArgs, 1, "--output", downloadName)
	assertAdjacentArgCount(t, "youtube", "first header", capturedArgs, 1, "--add-header", headerOne)
	assertAdjacentArgCount(t, "youtube", "second header", capturedArgs, 1, "--add-header", headerTwo)
	assertAdjacentArgCount(t, "youtube", "proxy", capturedArgs, 1, "--proxy", proxyValue)
	assertAdjacentArgCount(t, "youtube", "common argument", capturedArgs, 1, "--fixed", commonValue)
}
```

- [x] **Step 2: Run the test and verify RED**

```bash
go test ./internal/core -run '^TestDownloadLogsStructuredDiagnosticsWithoutParameterValues$' -count=1
```

Expected: FAIL because current start and argument logs expose sentinels.

- [x] **Step 3: Replace the two raw log entries**

```go
logger.Info("Starting download task",
	zap.String("id", string(p.ID)),
	zap.String("type", string(p.Type)),
	zap.String("url_origin", urlOriginForLog(p.URL)))
```

```go
logger.Debug("Command arguments built",
	zap.String("id", string(p.ID)),
	zap.Int("arg_count", len(args)),
	zap.String("url_origin", urlOriginForLog(p.URL)),
	zap.Strings("header_names", headerNamesForLog(p.Headers)),
	zap.Bool("proxy_configured", proxyConfiguredForLog(d.cfg)))
```

- [x] **Step 4: Run the same real-log command and verify GREEN**

Expected: PASS, including deterministic execution-argument assertions.

### Task 4: M3U8 Missing-Output Log Boundary

**Files:**

- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] **Step 1: Write the failing M3U8 error-log test**

```go
func TestM3U8MissingOutputLogOmitsParameterValues(t *testing.T) {
	observedCore, observedLogs := observer.New(zapcore.DebugLevel)
	observedLogger := zap.New(observedCore)
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger, logger.Sugar = observedLogger, observedLogger.Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previousLogger, previousSugar })

	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	localDir := filepath.Join(tempDir, "m3u8-directory-secret")
	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error { return nil }),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: localDir},
	)
	err := d.Download(context.Background(), DownloadParams{
		ID: "m3u8-log-test", Type: TypeM3U8,
		URL: "https://media.example/video.m3u8", Name: "m3u8-name-secret",
	}, Callbacks{})
	if !errors.Is(err, ErrM3U8OutputMissing) {
		t.Fatalf("Download() error = %v, want ErrM3U8OutputMissing", err)
	}
	for _, secret := range []string{"m3u8-directory-secret", "m3u8-name-secret"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("M3U8 missing-output error contains secret %q", secret)
		}
	}

	entries := observedLogs.FilterMessage("M3U8 downloader exited without creating a merged media file").All()
	if len(entries) != 1 {
		t.Fatalf("M3U8 missing-output log count = %d, want 1", len(entries))
	}
	entryContext := entries[0].ContextMap()
	serialized := entries[0].Message + fmt.Sprint(entryContext)
	for _, secret := range []string{"m3u8-directory-secret", "m3u8-name-secret"} {
		if strings.Contains(serialized, secret) {
			t.Fatalf("M3U8 missing-output log contains secret %q", secret)
		}
	}
	if _, found := entryContext["directory"]; found {
		t.Fatal("M3U8 directory field remained")
	}
	if _, found := entryContext["name"]; found {
		t.Fatal("M3U8 name field remained")
	}
}
```

- [x] **Step 2: Run the M3U8 test and verify RED**

```bash
go test ./internal/core -run '^TestM3U8MissingOutputLogOmitsParameterValues$' -count=1
```

Expected: FAIL because the error entry contains both values.

- [x] **Step 3: Remove value-bearing fields from the M3U8 error entry and returned error**

Keep only `zap.String("id", string(p.ID))` on that error log, and return
`ErrM3U8OutputMissing` directly without joining the output directory or
download name. This preserves `errors.Is(err, ErrM3U8OutputMissing)` while
keeping propagated `err.Error()` text free of parameter values.

- [x] **Step 4: Run the same M3U8 command and verify GREEN**

Expected: PASS.

### Task 5: Refactor and Verification

**Files:**

- Modify: `apps/core/internal/core/downloader.go`
- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `docs/superpowers/plans/2026-08-20-pr-718-log-redaction-follow-up.md`
- Modify: `docs/superpowers/specs/2026-08-20-pr-718-log-redaction-follow-up-design.md`

- [x] **Step 1: Remove obsolete raw-argument redaction**

Delete `redactSensitiveArgs`, `redactHeader`, `proxyContainsCredentials`, and `TestRedactSensitiveArgs`. The new unit helpers and real-log tests own the security contract.

- [x] **Step 2: Format modified files**

From the repository root, run:

```bash
gofmt -w apps/core/internal/core/downloader.go apps/core/internal/core/downloader_test.go
pnpm exec oxfmt --write docs/superpowers/plans/2026-08-20-pr-718-log-redaction-follow-up.md docs/superpowers/specs/2026-08-20-pr-718-log-redaction-follow-up-design.md
```

- [x] **Step 3: Run focused and full verification**

Run `go test ./internal/core -count=1` and `go test ./... -count=1` from `apps/core`. Then run `pnpm check` and `pnpm test` from the repository root.

Expected: every command exits 0.

- [x] **Step 4: Inspect repository state**

Run `git diff --check`, `git status --short`, and `git diff --stat`.

Expected: only the approved downloader logging fix, its tests, and reviewed documentation changes are uncommitted. Do not commit, push, reply, or resolve review threads without separate user authorization.
