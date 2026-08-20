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
	useProxy bool
	proxy    string
}

func (c testDownloaderConfig) GetLocalDir() string   { return c.localDir }
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
			return nil
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

	err := d.Download(context.Background(), DownloadParams{
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
	if got := fmt.Sprint(argumentFields["arg_count"]); got != "13" {
		t.Fatalf("Command arguments built arg_count = %q, want 13", got)
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

	if len(runnerArgs) != 13 {
		t.Fatalf("runner arguments length = %d, want 13", len(runnerArgs))
	}
	assertStandaloneArgCount(t, "youtube", "URL", runnerArgs, 1, downloadURL)
	assertAdjacentArgCount(t, "youtube", "local directory", runnerArgs, 1, "--paths", localDir)
	assertAdjacentArgCount(t, "youtube", "output name", runnerArgs, 1, "--output", downloadName)
	assertAdjacentArgCount(t, "youtube", "first header", runnerArgs, 1, "--add-header", headerOne)
	assertAdjacentArgCount(t, "youtube", "second header", runnerArgs, 1, "--add-header", headerTwo)
	assertAdjacentArgCount(t, "youtube", "proxy", runnerArgs, 1, "--proxy", proxyValue)
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
	err := d.Download(context.Background(), DownloadParams{
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
	err := d.Download(context.Background(), DownloadParams{
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
	err := d.Download(context.Background(), DownloadParams{
		ID: "1", Type: TypeM3U8, URL: "https://example.com/video.m3u8", Name: "video",
	}, Callbacks{})

	if err != nil {
		t.Fatalf("Download() error = %v", err)
	}
}
