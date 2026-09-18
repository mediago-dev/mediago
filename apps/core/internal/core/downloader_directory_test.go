package core

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"slices"
	"testing"

	"caorushizi.cn/mediago/internal/core/schema"
)

func TestDownloadUsesCustomDirectoryForArgumentsAndArtifacts(t *testing.T) {
	ensureTestLogger()
	for _, downloadType := range []DownloadType{TypeM3U8, TypeBilibili, TypeDirect, TypeMediago, TypeYoutube, TypeXiaohongshu} {
		t.Run(string(downloadType), func(t *testing.T) {
			defaultDir, customDir := t.TempDir(), t.TempDir()
			bin := filepath.Join(t.TempDir(), "downloader")
			if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
				t.Fatal(err)
			}
			wantDir := filepath.Join(customDir, "courses")
			wantPath := filepath.Join(wantDir, "video.mp4")
			cfg := testDownloaderConfig{localDir: defaultDir, desktop: true}
			downloader := NewDownloader(map[DownloadType]string{downloadType: bin}, runnerFunc(func(_ context.Context, _ string, args []string, _ func(string)) error {
				if !slices.Contains(args, wantDir) {
					t.Errorf("downloader arguments do not use custom directory: %v", args)
				}
				if err := os.MkdirAll(wantDir, 0o755); err != nil {
					return err
				}
				return os.WriteFile(wantPath, []byte("media"), 0o600)
			}), schema.DefaultSchemas(), cfg)
			result, err := downloader.Download(context.Background(), DownloadParams{ID: "custom", Type: downloadType, URL: "https://example.com/video.mp4", Name: "video", Folder: "courses", DownloadDir: customDir}, Callbacks{})
			if err != nil {
				t.Fatal(err)
			}
			if result.PrimaryPath != wantPath || !slices.Equal(result.ArtifactPaths, []string{wantPath}) {
				t.Fatalf("unexpected artifacts: %+v", result)
			}
			if cfg.GetLocalDir() != defaultDir {
				t.Fatal("global directory changed")
			}
		})
	}
}

func TestServerDownloaderRejectsCustomDirectoryBeforeExecution(t *testing.T) {
	ensureTestLogger()
	root := t.TempDir()
	bin := filepath.Join(t.TempDir(), "downloader")
	if err := os.WriteFile(bin, []byte("test"), 0o700); err != nil {
		t.Fatal(err)
	}
	called := false
	downloader := NewDownloader(map[DownloadType]string{TypeDirect: bin}, runnerFunc(func(context.Context, string, []string, func(string)) error {
		called = true
		return nil
	}), schema.DefaultSchemas(), testDownloaderConfig{localDir: root})
	_, err := downloader.Download(context.Background(), DownloadParams{ID: "server", Type: TypeDirect, URL: "https://example.com/video.mp4", DownloadDir: t.TempDir()}, Callbacks{})
	if !errors.Is(err, ErrCustomDownloadDirectory) || called {
		t.Fatalf("err = %v, runner called = %v", err, called)
	}
}
