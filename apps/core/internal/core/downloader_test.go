package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type testDownloaderConfig struct {
	localDir string
	desktop  bool
	useProxy bool
	proxy    string
}

func (c testDownloaderConfig) GetLocalDir() string   { return c.localDir }
func (c testDownloaderConfig) IsDesktop() bool       { return c.desktop }
func (testDownloaderConfig) GetDeleteSegments() bool { return true }
func (c testDownloaderConfig) GetUseProxy() bool     { return c.useProxy }
func (c testDownloaderConfig) GetProxy() string      { return c.proxy }

type pointerDownloaderConfig struct {
	useProxy bool
	proxy    string
}

func (c *pointerDownloaderConfig) GetUseProxy() bool { return c.useProxy }
func (c *pointerDownloaderConfig) GetProxy() string  { return c.proxy }

type runnerFunc func(context.Context, string, []string, func(string)) error

func (f runnerFunc) Run(ctx context.Context, bin string, args []string, onLine func(string)) error {
	return f(ctx, bin, args, onLine)
}

type configurableRunnerFunc func(context.Context, string, []string, func(string), RunnerOptions) error

func (f configurableRunnerFunc) Run(ctx context.Context, bin string, args []string, onLine func(string)) error {
	return f(ctx, bin, args, onLine, RunnerOptions{})
}

func (f configurableRunnerFunc) RunWithOptions(ctx context.Context, bin string, args []string, onLine func(string), options RunnerOptions) error {
	return f(ctx, bin, args, onLine, options)
}

func ensureTestLogger() {
	if logger.Logger == nil {
		logger.Logger = zap.NewNop()
		logger.Sugar = logger.Logger.Sugar()
	}
}

func TestBuildArgsUsesStoredBilibiliCookie(t *testing.T) {
	d := &DownloaderSvc{}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"cookie":     {ArgsName: []string{"--cookie"}},
		"__common__": {ArgsName: []string{"--encoding-priority", "avc,hevc,av1"}},
	}}

	args := d.buildArgs(DownloadParams{
		Type:    TypeBilibili,
		Headers: []string{"Referer: https://www.bilibili.com", "cookie: SESSDATA=secret; bili_jct=csrf"},
	}, s)

	cookieIndex := slices.Index(args, "--cookie")
	if cookieIndex == -1 || cookieIndex+1 >= len(args) {
		t.Fatal("expected --cookie argument")
	}
	if got := args[cookieIndex+1]; got != "SESSDATA=secret; bili_jct=csrf" {
		t.Fatal("unexpected cookie value")
	}
	if slices.Contains(args, "--use-app-api") {
		t.Fatal("APP API must not be forced")
	}
}

func TestBuildArgsOmitsMissingCookie(t *testing.T) {
	d := &DownloaderSvc{}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"cookie": {ArgsName: []string{"--cookie"}},
	}}

	args := d.buildArgs(DownloadParams{Type: TypeBilibili}, s)
	if slices.Contains(args, "--cookie") {
		t.Fatal("unexpected cookie argument")
	}
}

func TestURLOriginForLog(t *testing.T) {
	tests := []struct{ name, raw, want string }{
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

func TestHeaderValueIsCaseInsensitive(t *testing.T) {
	headers := []string{"COOKIE : SESSDATA=value:with:colons"}
	if got := headerValue(headers, "Cookie"); got != "SESSDATA=value:with:colons" {
		t.Fatal("unexpected case-insensitive header value")
	}
}

func TestBuildArgsPassesSniffedM3U8Headers(t *testing.T) {
	d := &DownloaderSvc{}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"headers": {ArgsName: []string{"--header"}},
	}}
	headerLines := []string{
		"Referer:https://example.com/watch/video",
		"Origin:https://example.com",
		"User-Agent:Mozilla/5.0",
	}

	args := d.buildArgs(DownloadParams{Type: TypeM3U8, Headers: headerLines}, s)
	for _, header := range headerLines {
		index := slices.Index(args, header)
		if index < 1 || args[index-1] != "--header" {
			t.Fatal("expected header argument")
		}
	}
}

func TestBuildArgsEscapesLiteralPercentInYTDLPOutputTemplate(t *testing.T) {
	d := &DownloaderSvc{
		binMap: map[DownloadType]string{TypeYoutube: "/runtime/yt-dlp"},
		cfg:    testDownloaderConfig{localDir: "/downloads"},
	}
	args := d.buildArgs(DownloadParams{
		Type: TypeYoutube,
		URL:  "https://example.com/video",
		Name: "100% real.mp4",
	}, defaultContractSchema(t, string(TypeYoutube)))
	assertAdjacentArgCount(t, "yt-dlp", "escaped output template", args, 1, "-o", "100%% real.%(ext)s")
}

func TestBuildArgsUsesBundledFFmpeg(t *testing.T) {
	d := &DownloaderSvc{binMap: map[DownloadType]string{
		TypeM3U8: "/opt/mediago/deps/N_m3u8DL-RE",
	}}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"ffmpegBinaryPath": {ArgsName: []string{"--ffmpeg-binary-path"}},
	}}

	args := d.buildArgs(DownloadParams{Type: TypeM3U8}, s)
	want := []string{"--ffmpeg-binary-path", "/opt/mediago/deps/ffmpeg"}
	if !slices.Equal(args, want) {
		t.Fatal("unexpected ffmpeg binary arguments")
	}
}

func TestDownloadLogsStructuredDiagnosticsWithoutParameterValues(t *testing.T) {
	observedCore, observedLogs := observer.New(zapcore.DebugLevel)
	observedLogger := zap.New(observedCore)
	previousLogger := logger.Logger
	previousSugar := logger.Sugar
	logger.Logger = observedLogger
	logger.Sugar = observedLogger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "youtube")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	const (
		downloadURL  = "https://url-user-secret:url-pass-secret@media.example:8443/url-path-secret/video?token=url-query-secret#url-fragment-secret"
		downloadName = "download-name-secret"
		headerOne    = "Authorization: header-one-secret"
		headerTwo    = "X-Debug-Trace: header-two-secret"
		proxyValue   = "https://proxy.example:9443/proxy-path-secret?token=proxy-query-secret"
		commonValue  = "common-argument-secret"
	)
	localDir := filepath.Join(tempDir, "local-dir-secret")

	var runnerArgs []string
	d := NewDownloader(
		map[DownloadType]string{TypeYoutube: bin},
		runnerFunc(func(_ context.Context, _ string, args []string, _ func(string)) error {
			runnerArgs = slices.Clone(args)
			if err := os.MkdirAll(localDir, 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(localDir, downloadName), []byte("media"), 0o600)
		}),
		schema.SchemaList{Schemas: []schema.Schema{{
			Type: string(TypeYoutube),
			Args: map[string]schema.ArgSpec{
				"url":        {ArgsName: []string{}},
				"localDir":   {ArgsName: []string{"--paths"}},
				"name":       {ArgsName: []string{"--output"}},
				"headers":    {ArgsName: []string{"--add-header"}},
				"proxy":      {ArgsName: []string{"--proxy"}},
				"__common__": {ArgsName: []string{"--fixed", commonValue}},
			},
		}}},
		testDownloaderConfig{localDir: localDir, useProxy: true, proxy: proxyValue},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID:      "log-test",
		Type:    TypeYoutube,
		URL:     downloadURL,
		Name:    downloadName,
		Headers: []string{headerOne, headerTwo},
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}

	secretMarkers := []string{
		"url-user-secret",
		"url-pass-secret",
		"url-path-secret",
		"url-query-secret",
		"url-fragment-secret",
		downloadName,
		"header-one-secret",
		"header-two-secret",
		"proxy-path-secret",
		"proxy-query-secret",
		commonValue,
		"local-dir-secret",
	}
	for _, entry := range observedLogs.All() {
		serialized := entry.Message + fmt.Sprint(entry.ContextMap())
		for _, secret := range secretMarkers {
			if strings.Contains(serialized, secret) {
				t.Fatalf("log entry %q exposed secret %q: %s", entry.Message, secret, serialized)
			}
		}
	}

	startingEntries := observedLogs.FilterMessage("Starting download task").All()
	if len(startingEntries) != 1 {
		t.Fatalf("Starting download task log entries = %d, want 1", len(startingEntries))
	}
	startingFields := startingEntries[0].ContextMap()
	if got := fmt.Sprint(startingFields["id"]); got != "log-test" {
		t.Fatalf("Starting download task id = %q, want log-test", got)
	}
	if got := fmt.Sprint(startingFields["type"]); got != "youtube" {
		t.Fatalf("Starting download task type = %q, want youtube", got)
	}
	if got := fmt.Sprint(startingFields["url_origin"]); got != "https://media.example:8443" {
		t.Fatalf("Starting download task url_origin = %q, want https://media.example:8443", got)
	}
	if _, ok := startingFields["url"]; ok {
		t.Fatal("Starting download task unexpectedly includes url")
	}
	if _, ok := startingFields["name"]; ok {
		t.Fatal("Starting download task unexpectedly includes name")
	}

	argumentEntries := observedLogs.FilterMessage("Command arguments built").All()
	if len(argumentEntries) != 1 {
		t.Fatalf("Command arguments built log entries = %d, want 1", len(argumentEntries))
	}
	argumentFields := argumentEntries[0].ContextMap()
	if got := fmt.Sprint(argumentFields["id"]); got != "log-test" {
		t.Fatalf("Command arguments built id = %q, want log-test", got)
	}
	if got := fmt.Sprint(argumentFields["arg_count"]); got != "15" {
		t.Fatalf("Command arguments built arg_count = %q, want 15", got)
	}
	if got := fmt.Sprint(argumentFields["url_origin"]); got != "https://media.example:8443" {
		t.Fatalf("Command arguments built url_origin = %q, want https://media.example:8443", got)
	}
	if got := fmt.Sprint(argumentFields["proxy_configured"]); got != "true" {
		t.Fatalf("Command arguments built proxy_configured = %q, want true", got)
	}
	if got := fmt.Sprint(argumentFields["header_names"]); got != "[Authorization X-Debug-Trace]" {
		t.Fatalf("Command arguments built header_names = %q, want [Authorization X-Debug-Trace]", got)
	}
	if _, ok := argumentFields["args"]; ok {
		t.Fatal("Command arguments built unexpectedly includes args")
	}

	if len(runnerArgs) != 15 {
		t.Fatalf("runner arguments length = %d, want 15", len(runnerArgs))
	}
	assertStandaloneArgCount(t, "youtube", "URL", runnerArgs, 1, downloadURL)
	assertAdjacentArgCount(t, "youtube", "local directory", runnerArgs, 1, "--paths", localDir)
	assertAdjacentArgCount(t, "youtube", "output name", runnerArgs, 1, "--output", downloadName)
	assertAdjacentArgCount(t, "youtube", "first header", runnerArgs, 1, "--add-header", headerOne)
	assertAdjacentArgCount(t, "youtube", "second header", runnerArgs, 1, "--add-header", headerTwo)
	assertAdjacentArgCount(t, "youtube", "proxy", runnerArgs, 1, "--proxy", proxyValue)
	assertAdjacentArgCount(t, "youtube", "Deno runtime", runnerArgs, 1, "--js-runtimes", "deno:"+filepath.Join(tempDir, "deno"))
	assertAdjacentArgCount(t, "youtube", "common argument", runnerArgs, 1, "--fixed", commonValue)
}

func TestDownloadRejectsM3U8WithoutMergedOutput(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error { return nil }),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)
	_, err := d.Download(context.Background(), DownloadParams{
		ID: "1", Type: TypeM3U8, URL: "https://example.com/video.m3u8", Name: "video",
	}, Callbacks{})

	if !errors.Is(err, ErrM3U8OutputMissing) {
		t.Fatalf("Download() error = %v, want ErrM3U8OutputMissing", err)
	}
}

func TestM3U8MissingOutputLogOmitsParameterValues(t *testing.T) {
	observedCore, observedLogs := observer.New(zapcore.DebugLevel)
	observedLogger := zap.New(observedCore)
	previousLogger := logger.Logger
	previousSugar := logger.Sugar
	logger.Logger = observedLogger
	logger.Sugar = observedLogger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

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
	_, err := d.Download(context.Background(), DownloadParams{
		ID: "m3u8-log-test", Type: TypeM3U8, URL: "https://media.example/video.m3u8", Name: "m3u8-name-secret",
	}, Callbacks{})
	if !errors.Is(err, ErrM3U8OutputMissing) {
		t.Fatalf("Download() error = %v, want ErrM3U8OutputMissing", err)
	}
	parameterValues := []string{"m3u8-directory-secret", "m3u8-name-secret"}
	for _, value := range parameterValues {
		if strings.Contains(err.Error(), value) {
			t.Fatalf("missing-output error contains parameter value %q: %s", value, err)
		}
	}

	entries := observedLogs.FilterMessage("M3U8 downloader exited without creating a merged media file").All()
	if len(entries) != 1 {
		t.Fatalf("missing-output log entries = %d, want 1", len(entries))
	}
	fields := entries[0].ContextMap()
	serialized := entries[0].Message + fmt.Sprint(fields)
	for _, value := range parameterValues {
		if strings.Contains(serialized, value) {
			t.Fatalf("missing-output log contains parameter value %q: %s", value, serialized)
		}
	}
	if _, ok := fields["directory"]; ok {
		t.Fatal("missing-output log unexpectedly includes directory")
	}
	if _, ok := fields["name"]; ok {
		t.Fatal("missing-output log unexpectedly includes name")
	}
	if got := fmt.Sprint(fields["id"]); got != "m3u8-log-test" {
		t.Fatalf("missing-output log id = %q, want m3u8-log-test", got)
	}
}

func TestDownloadAcceptsNewMergedM3U8Output(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error {
			return os.WriteFile(filepath.Join(tempDir, "video.mp4"), []byte("merged"), 0o600)
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)
	result, err := d.Download(context.Background(), DownloadParams{
		ID: "1", Type: TypeM3U8, URL: "https://example.com/video.m3u8", Name: "video",
	}, Callbacks{})

	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if result.PrimaryPath != filepath.Join(tempDir, "video.mp4") {
		t.Fatalf("Download() primary path = %q", result.PrimaryPath)
	}
}

func TestDownloadDoesNotTreatM3U8SegmentsAsCompletedOutput(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error {
			segmentDir := filepath.Join(tempDir, "video", "0___1000_")
			if err := os.MkdirAll(segmentDir, 0o700); err != nil {
				return err
			}
			return os.WriteFile(filepath.Join(segmentDir, "100.ts"), []byte("segment"), 0o600)
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID: "segments-only", Type: TypeM3U8, URL: "https://example.com/video.m3u8", Name: "video",
	}, Callbacks{})
	if !errors.Is(err, ErrM3U8OutputMissing) {
		t.Fatalf("Download() error = %v, want ErrM3U8OutputMissing", err)
	}
}

func TestDownloadReturnsOnlyTopLevelM3U8Artifact(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	outputPath := filepath.Join(tempDir, "live.ts")
	segmentPath := filepath.Join(tempDir, "live", "0___1000_", "100.ts")
	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error {
			if err := os.MkdirAll(filepath.Dir(segmentPath), 0o700); err != nil {
				return err
			}
			if err := os.WriteFile(segmentPath, []byte("segment"), 0o600); err != nil {
				return err
			}
			return os.WriteFile(outputPath, []byte("merged"), 0o600)
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID: "top-level-only", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if !slices.Equal(result.ArtifactPaths, []string{outputPath}) {
		t.Fatalf("Download() artifact paths = %q, want [%q]", result.ArtifactPaths, outputPath)
	}
}

func TestDownloadRecoversCompletedLiveOutputAfterDownloaderError(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	downloaderErr := errors.New("live playlist ended with exit status 1")
	outputPath := filepath.Join(tempDir, "live.ts")
	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string)) error {
			onLine("检测到直播流")
			onLine("保存文件名: live")
			if err := os.WriteFile(outputPath, []byte("recorded media"), 0o600); err != nil {
				return err
			}
			return downloaderErr
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID: "live-natural-end", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if result.PrimaryPath != outputPath {
		t.Fatalf("Download() primary path = %q, want %q", result.PrimaryPath, outputPath)
	}
	if !result.RecoveredAfterError {
		t.Fatal("Download() did not mark the live output as recovered after downloader error")
	}
	if result.FinalizedAfterStop {
		t.Fatal("natural live end must not be marked as a user stop")
	}
}

func TestDownloadMergesPreservedSingleTrackLiveSegmentsAfterDownloaderError(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	segmentDir := filepath.Join(tempDir, "live", "0___1000_")
	segmentPaths := []string{
		filepath.Join(segmentDir, "100.ts"),
		filepath.Join(segmentDir, "101.ts"),
		filepath.Join(segmentDir, "102.ts"),
	}
	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string)) error {
			onLine("检测到直播流")
			onLine("保存文件名: live")
			if err := os.MkdirAll(segmentDir, 0o700); err != nil {
				return err
			}
			for index, path := range segmentPaths {
				if err := os.WriteFile(path, []byte(fmt.Sprintf("segment-%d", index)), 0o600); err != nil {
					return err
				}
			}
			return errors.New("live source ended unexpectedly")
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID: "live-segment-recovery", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if result.PrimaryPath != filepath.Join(tempDir, "live.ts") {
		t.Fatalf("Download() primary path = %q", result.PrimaryPath)
	}
	if !result.RecoveredAfterError || !result.RecoveredSegments {
		t.Fatalf("Download() recovery flags = %#v", result)
	}
	contents, err := os.ReadFile(result.PrimaryPath)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(contents), "segment-0segment-1segment-2"; got != want {
		t.Fatalf("recovered contents = %q, want %q", got, want)
	}
	for _, segmentPath := range segmentPaths {
		if _, err := os.Stat(segmentPath); err != nil {
			t.Fatalf("preserved segment was removed: %v", err)
		}
	}
	if !slices.Equal(result.ArtifactPaths, []string{result.PrimaryPath}) {
		t.Fatalf("Download() artifacts = %q", result.ArtifactPaths)
	}
}

func TestDownloadPreservesAmbiguousLiveSegmentsWhenRecoveryIsUnsafe(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		runnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string)) error {
			onLine("检测到直播流")
			for _, track := range []string{"video", "audio"} {
				directory := filepath.Join(tempDir, "live", track)
				if err := os.MkdirAll(directory, 0o700); err != nil {
					return err
				}
				if err := os.WriteFile(filepath.Join(directory, "100.ts"), []byte(track), 0o600); err != nil {
					return err
				}
			}
			return errors.New("live source ended unexpectedly")
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID: "live-ambiguous-segments", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if !errors.Is(err, ErrLiveSegmentRecovery) {
		t.Fatalf("Download() error = %v, want ErrLiveSegmentRecovery", err)
	}
	if _, statErr := os.Stat(filepath.Join(tempDir, "live", "video", "100.ts")); statErr != nil {
		t.Fatalf("video segment was removed: %v", statErr)
	}
	if _, statErr := os.Stat(filepath.Join(tempDir, "live", "audio", "100.ts")); statErr != nil {
		t.Fatalf("audio segment was removed: %v", statErr)
	}
}

func TestDownloadReturnsFinalizedLiveOutputAfterCancellation(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		configurableRunnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string), options RunnerOptions) error {
			onLine("检测到直播流")
			onLine("保存文件名: live")
			if options.ShouldGracefullyStop == nil || !options.ShouldGracefullyStop() {
				t.Fatal("live runner did not request graceful cancellation")
			}
			if err := os.WriteFile(filepath.Join(tempDir, "live.mp4"), []byte("recorded media"), 0o600); err != nil {
				return err
			}
			return context.Canceled
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID: "live-stop", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if result.PrimaryPath != filepath.Join(tempDir, "live.mp4") {
		t.Fatalf("Download() primary path = %q", result.PrimaryPath)
	}
	if !result.FinalizedAfterStop {
		t.Fatal("Download() did not mark the live output as finalized after stop")
	}
}

func TestDownloadKeepsCanceledLiveWithoutOutputStopped(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		configurableRunnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string), _ RunnerOptions) error {
			onLine("检测到直播流")
			onLine("保存文件名: live")
			return context.Canceled
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID: "live-empty", Type: TypeM3U8, URL: "https://example.com/live.m3u8", Name: "live",
	}, Callbacks{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Download() error = %v, want context.Canceled", err)
	}
}

func TestDownloadDoesNotFinalizeCanceledNonLiveOutput(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "N_m3u8DL-RE")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeM3U8: bin},
		configurableRunnerFunc(func(_ context.Context, _ string, _ []string, _ func(string), _ RunnerOptions) error {
			if err := os.WriteFile(filepath.Join(tempDir, "vod.mp4"), []byte("partial media"), 0o600); err != nil {
				return err
			}
			return context.Canceled
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID: "vod-stop", Type: TypeM3U8, URL: "https://example.com/vod.m3u8", Name: "vod",
	}, Callbacks{})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Download() error = %v, want context.Canceled", err)
	}
}

func TestDownloadReturnsPrimaryOutputForEveryDownloaderType(t *testing.T) {
	ensureTestLogger()
	tests := []struct {
		name         string
		downloadType DownloadType
		taskName     string
		outputName   string
		reportOutput bool
	}{
		{name: "m3u8", downloadType: TypeM3U8, taskName: "stream", outputName: "stream.mp4"},
		{name: "bilibili", downloadType: TypeBilibili, taskName: "bilibili", outputName: "bilibili.mp4"},
		{name: "direct avoids duplicate extension", downloadType: TypeDirect, taskName: "direct.mp4", outputName: "direct.mp4"},
		{name: "mediago", downloadType: TypeMediago, taskName: "mediago", outputName: "mediago.mkv"},
		{name: "yt-dlp final marker", downloadType: TypeYoutube, taskName: "social.video", outputName: "social.video.mp4", reportOutput: true},
		{name: "xiaohongshu", downloadType: TypeXiaohongshu, taskName: "xiaohongshu", outputName: "xiaohongshu.mp4"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			tempDir := t.TempDir()
			bin := filepath.Join(tempDir, BinaryNames[test.downloadType])
			if err := os.MkdirAll(filepath.Dir(bin), 0o700); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
				t.Fatal(err)
			}
			want := filepath.Join(tempDir, test.outputName)
			d := NewDownloader(
				map[DownloadType]string{test.downloadType: bin},
				runnerFunc(func(_ context.Context, _ string, _ []string, onLine func(string)) error {
					if err := os.WriteFile(want, []byte("media"), 0o600); err != nil {
						return err
					}
					if test.reportOutput {
						onLine(ytDLPOutputMarker + want)
					}
					return nil
				}),
				schema.DefaultSchemas(),
				testDownloaderConfig{localDir: tempDir},
			)

			result, err := d.Download(context.Background(), DownloadParams{
				ID:   "all-downloaders",
				Type: test.downloadType,
				URL:  "https://example.com/video.mp4",
				Name: test.taskName,
			}, Callbacks{})
			if err != nil {
				t.Fatalf("Download() error = %v", err)
			}
			if result.PrimaryPath != want {
				t.Fatalf("Download() primary path = %q, want %q", result.PrimaryPath, want)
			}
			if len(result.ArtifactPaths) != 1 || result.ArtifactPaths[0] != want {
				t.Fatalf("Download() artifact paths = %q, want [%q]", result.ArtifactPaths, want)
			}
		})
	}
}

func TestDownloadReturnsEveryArtifactFromTaskOutputDirectory(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, BinaryNames[TypeXiaohongshu])
	if err := os.MkdirAll(filepath.Dir(bin), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	const taskName = "xiaohongshu-note"
	videoPath := filepath.Join(tempDir, taskName+".mp4")
	alternateVideoPath := filepath.Join(tempDir, taskName+".webm")
	d := NewDownloader(
		map[DownloadType]string{TypeXiaohongshu: bin},
		runnerFunc(func(_ context.Context, _ string, _ []string, emit func(string)) error {
			if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
				return err
			}
			if err := os.WriteFile(alternateVideoPath, []byte("alternate video"), 0o600); err != nil {
				return err
			}
			emit(ytDLPOutputMarker + videoPath)
			return nil
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID:   "xiaohongshu-artifacts",
		Type: TypeXiaohongshu,
		URL:  "https://www.xiaohongshu.com/explore/abc123?xsec_token=signed-token",
		Name: taskName,
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if result.PrimaryPath != videoPath {
		t.Fatalf("Download() primary path = %q, want %q", result.PrimaryPath, videoPath)
	}
	wantArtifacts := []string{videoPath, alternateVideoPath}
	if !slices.Equal(result.ArtifactPaths, wantArtifacts) {
		t.Fatalf("Download() artifact paths = %q, want %q", result.ArtifactPaths, wantArtifacts)
	}
}

func TestDownloadYTDLPUsesTemporaryCookieFile(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, BinaryNames[TypeXiaohongshu])
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	const taskName = "xiaohongshu-cookie-file"
	videoPath := filepath.Join(tempDir, taskName+".mp4")
	var cookiePath string
	d := NewDownloader(
		map[DownloadType]string{TypeXiaohongshu: bin},
		runnerFunc(func(_ context.Context, _ string, args []string, emit func(string)) error {
			for index, arg := range args {
				if arg == "--add-header" && index+1 < len(args) && strings.HasPrefix(strings.ToLower(args[index+1]), "cookie:") {
					t.Fatal("Cookie must not be passed through --add-header")
				}
			}
			cookieIndex := slices.Index(args, "--cookies")
			if cookieIndex == -1 || cookieIndex+1 >= len(args) {
				t.Fatal("expected --cookies argument")
			}
			cookiePath = args[cookieIndex+1]
			contents, err := os.ReadFile(cookiePath)
			if err != nil {
				return err
			}
			if !strings.Contains(string(contents), "www.xiaohongshu.com\tFALSE\t/\tTRUE\t0\tweb_session\ttest-only") {
				t.Fatalf("unexpected Netscape cookie file: %q", contents)
			}
			info, err := os.Stat(cookiePath)
			if err != nil {
				return err
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatalf("cookie file mode = %o, want 600", info.Mode().Perm())
			}
			if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
				return err
			}
			emit(ytDLPOutputMarker + videoPath)
			return nil
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID:      "xiaohongshu-cookie-file",
		Type:    TypeXiaohongshu,
		URL:     "https://www.xiaohongshu.com/explore/abc123?xsec_token=signed-token",
		Name:    taskName,
		Headers: []string{"Referer: https://www.xiaohongshu.com/", "Cookie: web_session=test-only; a1=device-only"},
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	if cookiePath == "" {
		t.Fatal("runner did not receive a cookie file")
	}
	if _, err := os.Stat(cookiePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("temporary cookie file still exists: %v", err)
	}
}

func TestDownloadExplainsXiaohongshuNoVideoFormats(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, BinaryNames[TypeXiaohongshu])
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	d := NewDownloader(
		map[DownloadType]string{TypeXiaohongshu: bin},
		runnerFunc(func(_ context.Context, _ string, _ []string, emit func(string)) error {
			emit(`WARNING: Extractor failed to obtain "title". Creating a generic title instead`)
			emit(`ERROR: [XiaoHongShu] abc123: No video formats found!`)
			return errors.New("exit status 1")
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID:   "xiaohongshu-no-video",
		Type: TypeXiaohongshu,
		URL:  "https://www.xiaohongshu.com/explore/abc123?xsec_token=signed-token",
		Name: "xiaohongshu-no-video",
	}, Callbacks{})
	if !errors.Is(err, ErrXiaohongshuVideoUnavailable) {
		t.Fatalf("Download() error = %v, want %v", err, ErrXiaohongshuVideoUnavailable)
	}
}

func TestDownloadReturnsEveryBilibiliMultiPartArtifact(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, BinaryNames[TypeBilibili])
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}

	const taskName = "bilibili-series"
	partOne := filepath.Join(tempDir, taskName+".P1.mp4")
	partTwo := filepath.Join(tempDir, taskName+".P2.mp4")
	d := NewDownloader(
		map[DownloadType]string{TypeBilibili: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error {
			if err := os.WriteFile(partOne, []byte("part one"), 0o600); err != nil {
				return err
			}
			return os.WriteFile(partTwo, []byte("part two"), 0o600)
		}),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	result, err := d.Download(context.Background(), DownloadParams{
		ID:   "bilibili-multi-part",
		Type: TypeBilibili,
		URL:  "https://www.bilibili.com/video/BV-multi-part?p=1",
		Name: taskName,
	}, Callbacks{})
	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
	want := []string{partOne, partTwo}
	if !slices.Equal(result.ArtifactPaths, want) {
		t.Fatalf("Download() artifact paths = %q, want %q", result.ArtifactPaths, want)
	}
}

func TestDownloadRejectsSuccessfulExitWithoutOutputForEveryDownloader(t *testing.T) {
	ensureTestLogger()
	tempDir := t.TempDir()
	bin := filepath.Join(tempDir, "BBDown")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	d := NewDownloader(
		map[DownloadType]string{TypeBilibili: bin},
		runnerFunc(func(context.Context, string, []string, func(string)) error { return nil }),
		schema.DefaultSchemas(),
		testDownloaderConfig{localDir: tempDir},
	)

	_, err := d.Download(context.Background(), DownloadParams{
		ID: "missing-output", Type: TypeBilibili, URL: "https://example.com/video", Name: "video",
	}, Callbacks{})
	if !errors.Is(err, ErrDownloadOutputMissing) {
		t.Fatalf("Download() error = %v, want ErrDownloadOutputMissing", err)
	}
}
