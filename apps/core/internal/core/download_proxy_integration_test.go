package core_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync/atomic"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/core/runner"
	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

type proxyIntegrationConfig struct{ directory string }

func (c proxyIntegrationConfig) GetLocalDir() string   { return c.directory }
func (proxyIntegrationConfig) IsDesktop() bool         { return true }
func (proxyIntegrationConfig) GetUseProxy() bool       { return false }
func (proxyIntegrationConfig) GetProxy() string        { return "" }
func (proxyIntegrationConfig) GetDeleteSegments() bool { return true }

// Uses the same pinned executables as a local package, without external media.
func TestRealDownloadProxyRouting(t *testing.T) {
	deps := os.Getenv("MEDIAGO_TEST_RUNTIME_DEPS")
	if deps == "" {
		t.Skip("set MEDIAGO_TEST_RUNTIME_DEPS to the bundled executable directory")
	}
	executable := func(name string) string {
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		return filepath.Join(deps, name)
	}
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() { logger.Logger = previousLogger; logger.Sugar = previousSugar })
	mediaDir := t.TempDir()
	command := exec.Command(executable("ffmpeg"), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=blue:s=160x90:d=1", "-c:v", "libx264", "-f", "hls", "-hls_time", "1", "-hls_playlist_type", "vod", filepath.Join(mediaDir, "sample.m3u8"))
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("generate controlled media: %v %s", err, output)
	}
	var proxyCalls atomic.Int32
	origin := httptest.NewServer(http.FileServer(http.Dir(mediaDir)))
	defer origin.Close()
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	defer transport.CloseIdleConnections()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxyCalls.Add(1)
		outgoing := r.Clone(r.Context())
		outgoing.RequestURI = ""
		response, err := transport.RoundTrip(outgoing)
		if err != nil {
			http.Error(w, err.Error(), 502)
			return
		}
		defer response.Body.Close()
		for name, values := range response.Header {
			for _, value := range values {
				w.Header().Add(name, value)
			}
		}
		w.WriteHeader(response.StatusCode)
		_, _ = io.Copy(w, response.Body)
	}))
	defer proxy.Close()
	t.Setenv("HTTP_PROXY", proxy.URL)
	t.Setenv("HTTPS_PROXY", proxy.URL)
	t.Setenv("ALL_PROXY", proxy.URL)
	t.Setenv("NO_PROXY", "")
	for _, kind := range []core.DownloadType{core.TypeDirect, core.TypeM3U8} {
		for _, mode := range []string{core.ProxyCustom, core.ProxyDirect} {
			t.Run(string(kind)+"/"+mode, func(t *testing.T) {
				before := proxyCalls.Load()
				tool, path := "aria2c", "/sample0.ts"
				if kind == core.TypeM3U8 {
					tool, path = "N_m3u8DL-RE", "/sample.m3u8"
				}
				bins := map[core.DownloadType]string{kind: executable(tool)}
				// ffmpeg is resolved adjacent to the download executable.
				downloader := core.NewDownloader(bins, runner.NewExecRunner(), schema.DefaultSchemas(), proxyIntegrationConfig{t.TempDir()})
				ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				defer cancel()
				result, err := downloader.Download(ctx, core.DownloadParams{ID: "route", Name: "sample", URL: origin.URL + path, Type: kind, ProxyMode: mode, ProxyURL: proxy.URL}, core.Callbacks{})
				if err != nil {
					t.Fatalf("real download: %v", err)
				}
				if info, err := os.Stat(result.PrimaryPath); err != nil || info.Size() == 0 {
					t.Fatalf("missing downloaded media: %v", err)
				}
				if mode == core.ProxyCustom && proxyCalls.Load() == before {
					t.Fatal("custom proxy was bypassed")
				}
				if mode == core.ProxyDirect && proxyCalls.Load() != before {
					t.Fatal("direct task used inherited proxy")
				}
			})
		}
	}
}
