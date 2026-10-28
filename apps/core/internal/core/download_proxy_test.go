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
)

func TestDownloadProxyValidationAndInheritance(t *testing.T) {
	cfg := testDownloaderConfig{useProxy: true, proxy: "http://127.0.0.1:7890"}
	for _, tc := range []struct{ mode, address, want string }{
		{"", "ignored", cfg.proxy}, {ProxyInherit, "ignored", cfg.proxy},
		{ProxyDirect, "ignored", ""}, {ProxyCustom, " http://localhost:1234/ ", "http://localhost:1234"},
		{ProxyCustom, "socks5://[::1]:1080", "socks5://[::1]:1080"},
	} {
		got, err := EffectiveDownloadProxy(tc.mode, tc.address, cfg)
		if err != nil || got != tc.want {
			t.Fatalf("proxy for %q = %q, %v", tc.mode, got, err)
		}
	}
	for _, address := range []string{"", "localhost:7890", "https://localhost:7890", "http://u:p@localhost:7890", "http://localhost:0", "http://localhost:99999", "http://localhost/path", "http://localhost/?token=secret", "http://localhost/#fragment", "http://localhost\n:7890"} {
		if _, _, err := NormalizeDownloadProxy(ProxyCustom, address); !errors.Is(err, ErrInvalidDownloadProxy) {
			t.Errorf("accepted invalid proxy %q", address)
		}
	}
	if err := ValidateDownloadProxyType(ProxyCustom, "socks5://localhost:1080", TypeDirect); !errors.Is(err, ErrInvalidDownloadProxy) {
		t.Fatal("aria2 must reject unsupported SOCKS5")
	}
	if err := ValidateDownloadProxyType(ProxyDirect, "", TypeBilibili); !errors.Is(err, ErrInvalidDownloadProxy) {
		t.Fatal("BBDown direct mode must not make false guarantees")
	}
	cfg.useProxy = false
	if got, _ := EffectiveDownloadProxy(ProxyInherit, "", cfg); got != "" {
		t.Fatal("disabled global proxy was used")
	}
}

func TestDownloadProxyEnvironmentIsIsolated(t *testing.T) {
	t.Setenv("HTTP_PROXY", "http://parent:8080")
	t.Setenv("NO_PROXY", "localhost")
	for _, address := range []string{"", "http://127.0.0.1:9876"} {
		values := map[string]string{}
		for _, entry := range DownloadProxyEnvironment(address) {
			key, value, _ := strings.Cut(entry, "=")
			values[strings.ToUpper(key)] = value
		}
		if values["HTTP_PROXY"] != address || values["ALL_PROXY"] != address {
			t.Fatalf("wrong child proxy: %+v", values)
		}
		if address == "" && values["NO_PROXY"] != "*" {
			t.Fatal("direct task inherited OS proxy discovery")
		}
		if address != "" && values["NO_PROXY"] != "" {
			t.Fatal("custom task inherited bypass list")
		}
	}
	if os.Getenv("HTTP_PROXY") != "http://parent:8080" {
		t.Fatal("parent environment changed")
	}
}

func TestDownloadTaskProxyControlsEveryEngine(t *testing.T) {
	ensureTestLogger()
	for _, kind := range []DownloadType{TypeM3U8, TypeDirect, TypeYoutube, TypeBilibili, TypeXiaohongshu, TypeMediago} {
		for _, mode := range []string{ProxyDirect, ProxyCustom, ProxyInherit} {
			if kind == TypeBilibili && mode == ProxyDirect {
				continue
			}
			t.Run(string(kind)+"/"+mode, func(t *testing.T) {
				dir := t.TempDir()
				bin := filepath.Join(dir, "downloader")
				if err := os.WriteFile(bin, []byte("fixture"), 0600); err != nil {
					t.Fatal(err)
				}
				want := "http://127.0.0.1:9991"
				if mode == ProxyInherit {
					want = "http://127.0.0.1:9992"
				}
				if mode == ProxyDirect {
					want = ""
				}
				called := false
				runner := configurableRunnerFunc(func(_ context.Context, _ string, args []string, _ func(string), options RunnerOptions) error {
					called = true
					if !slices.Contains(options.Environment, "HTTP_PROXY="+want) {
						t.Fatal("engine environment lost task proxy")
					}
					if kind == TypeM3U8 {
						assertAdjacentArgCount(t, string(kind), "disable system proxy", args, 1, "--use-system-proxy", "false")
					}
					if kind == TypeDirect && !slices.Contains(args, "--all-proxy="+want) {
						t.Fatal("aria2 proxy missing")
					}
					if isYTDLPType(kind) {
						assertAdjacentArgCount(t, string(kind), "explicit proxy", args, 1, "--proxy", want)
					}
					return os.WriteFile(filepath.Join(dir, "fixture.mp4"), []byte("media"), 0600)
				})
				d := NewDownloader(map[DownloadType]string{kind: bin}, runner, schema.DefaultSchemas(), testDownloaderConfig{localDir: dir, proxy: "http://127.0.0.1:9992", useProxy: true})
				_, err := d.Download(context.Background(), DownloadParams{ID: "1", Name: "fixture", URL: "https://example.com/video", Type: kind, ProxyMode: mode, ProxyURL: "http://127.0.0.1:9991"}, Callbacks{})
				if err != nil || !called {
					t.Fatalf("download: %v, called=%v", err, called)
				}
			})
		}
	}
}
