package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
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

func TestRedactSensitiveArgs(t *testing.T) {
	original := []string{
		"BV1xx",
		"--cookie", "cookie-separate-secret",
		"--cookie=cookie-equal-secret",
		"-c", "cookie-short-secret",
		"--add-header", "cOoKiE : cookie-header-separate-secret",
		"--add-header=Cookie: cookie-header-equal-secret",
		"--add-header", "aUtHoRiZaTiOn: Bearer authorization-header-separate-secret",
		"--add-header=Authorization : Bearer authorization-header-equal-secret",
		"--add-header", "Proxy-Authorization : Basic proxy-authorization-header-separate-secret",
		"--add-header=pRoXy-AuThOrIzAtIoN: Basic proxy-authorization-header-equal-secret",
		"--header", "cOoKiE : built-in-cookie-header-separate-secret",
		"--header=Cookie: built-in-cookie-header-equal-secret",
		"--header", "aUtHoRiZaTiOn: Bearer built-in-authorization-header-separate-secret",
		"--header=Authorization : Bearer built-in-authorization-header-equal-secret",
		"--header", "Proxy-Authorization : Basic built-in-proxy-authorization-header-separate-secret",
		"--header=pRoXy-AuThOrIzAtIoN: Basic built-in-proxy-authorization-header-equal-secret",
		"--proxy", "https://proxy-user:proxy-separate-secret@proxy.example:8443",
		"--proxy=http://proxy-user:proxy-equal-secret@proxy.example:8080",
		"--custom-proxy", "https://custom-user:custom-proxy-separate-secret@proxy.example:8443",
		"--custom-proxy=http://custom-user:custom-proxy-equal-secret@proxy.example:8080",
		"--proxy", "scheme-user:schemeless-proxy-secret@proxy.example:8080",
		"--proxy=http://malformed-user:malformed-proxy-%zz-secret@proxy.example:8080",
		"--add-header", "malformed-add-header-secret",
		"--header", "malformed-built-in-header-secret",
		"--add-header", "User-Agent: MediaGo-Visible",
		"--header=User-Agent: BuiltIn-Visible",
		"--proxy", "https://proxy.example:8443",
		"--proxy=https://proxy.example:8443/path@segment?email=user@example.com",
	}
	before := slices.Clone(original)
	redacted := redactSensitiveArgs(original)

	containsSubstring := func(values []string, substring string) bool {
		for _, value := range values {
			if strings.Contains(value, substring) {
				return true
			}
		}
		return false
	}
	countSubstring := func(values []string, substring string) int {
		count := 0
		for _, value := range values {
			if strings.Contains(value, substring) {
				count++
			}
		}
		return count
	}

	if containsSubstring(redacted, "secret") {
		t.Fatal("sensitive argument remained visible")
	}
	if got := countSubstring(redacted, "[REDACTED]"); got != 23 {
		t.Fatal("sensitive arguments were not redacted exactly once")
	}
	for _, malformedHeader := range []string{"malformed-add-header-secret", "malformed-built-in-header-secret"} {
		index := slices.Index(original, malformedHeader)
		if index == -1 || redacted[index] != "[REDACTED]" {
			t.Fatal("malformed header was not fully redacted")
		}
	}
	if !slices.Contains(redacted, "User-Agent: MediaGo-Visible") {
		t.Fatal("ordinary header was unexpectedly redacted")
	}
	if !slices.Contains(redacted, "--header=User-Agent: BuiltIn-Visible") {
		t.Fatal("ordinary built-in header was unexpectedly redacted")
	}
	if !slices.Contains(redacted, "https://proxy.example:8443") {
		t.Fatal("proxy without credentials was unexpectedly redacted")
	}
	if !slices.Contains(redacted, "--proxy=https://proxy.example:8443/path@segment?email=user@example.com") {
		t.Fatal("proxy with at-sign outside userinfo was unexpectedly redacted")
	}
	if !slices.Equal(original, before) {
		t.Fatal("redaction mutated executable arguments")
	}

	t.Run("scans immutable arguments", func(t *testing.T) {
		malformed := []string{"--cookie", "--proxy", "http://scan-user:scan-proxy-secret@host"}
		malformedBefore := slices.Clone(malformed)
		malformedRedacted := redactSensitiveArgs(malformed)

		if containsSubstring(malformedRedacted, "secret") {
			t.Fatal("sensitive argument remained visible after overlapping flags")
		}
		if !slices.Equal(malformedRedacted, []string{"--cookie", "[REDACTED]", "[REDACTED]"}) {
			t.Fatal("overlapping sensitive flags were not fully redacted")
		}
		if !slices.Equal(malformed, malformedBefore) {
			t.Fatal("redaction mutated malformed executable arguments")
		}
	})
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
