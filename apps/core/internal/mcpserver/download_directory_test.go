package mcpserver

import (
	"context"
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/api/handler"
	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"
)

type directoryCaptureDownloader struct{ params chan core.DownloadParams }

func (d *directoryCaptureDownloader) Download(_ context.Context, p core.DownloadParams, _ core.Callbacks) (core.DownloadResult, error) {
	d.params <- p
	return core.DownloadResult{PrimaryPath: filepath.Join(p.DownloadDir, p.Folder, p.Name+".mp4")}, nil
}
func (*directoryCaptureDownloader) Config() interface{} { return nil }

type directoryConfigStore map[string]any

func (c directoryConfigStore) Get(key string) any              { return c[key] }
func (c directoryConfigStore) Set(key string, value any) error { c[key] = value; return nil }
func (c directoryConfigStore) Update(values map[string]any) error {
	for key, value := range values {
		c[key] = value
	}
	return nil
}
func (c directoryConfigStore) Store() any { return c }

func TestMCPDownloadDirectoryPolicy(t *testing.T) {
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previousLogger, previousSugar })
	for _, toolName := range []string{"create_download", "download_discovered_media"} {
		for _, test := range []struct {
			name                                           string
			desktop, custom, relative, traversal, deferred bool
			wantError                                      string
		}{
			{name: "desktop custom", desktop: true, custom: true},
			{name: "desktop default", desktop: true},
			{name: "server default"},
			{name: "server custom rejected", custom: true, wantError: "only supported by the desktop"},
			{name: "relative override rejected", desktop: true, relative: true, wantError: "absolute directory path"},
			{name: "server traversal rejected", traversal: true, wantError: "relative subdirectory"},
			{name: "desktop deferred", desktop: true, custom: true, deferred: true},
		} {
			if test.deferred && toolName == "create_download" {
				continue
			}
			t.Run(toolName+"/"+test.name, func(t *testing.T) {
				database, err := db.New(filepath.Join(t.TempDir(), "mediago.db"))
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { _ = database.Close() })
				repository := repo.NewVideoRepository(database)
				captured := make(chan core.DownloadParams, 2)
				queue := core.NewTaskQueue(&directoryCaptureDownloader{params: captured}, 1)
				downloads := service.NewDownloadTaskService(repository, queue, nil)
				discoveries := discovery.NewService(nil, mcpDiscoveryInspector{}, nil)
				t.Cleanup(discoveries.Close)
				cfg := &testDownloadConfig{localDir: t.TempDir(), desktop: test.desktop}
				originalRoot := cfg.localDir
				handoff := handler.NewDiscoveryHandler(discoveries, downloads, directoryConfigStore{"local": cfg.localDir}, nil)
				manager := NewManager(downloads, cfg, discoveries, handoff)
				manager.Apply(Settings{Enabled: true, Token: "secret"})
				session := connectTestSession(t, manager)
				arguments := map[string]any{"folder": "courses/chapter1"}
				wantDir := ""
				if test.custom {
					wantDir = filepath.Join(t.TempDir(), "new")
					arguments["downloadDir"] = wantDir
				}
				if test.relative {
					arguments["downloadDir"] = "videos"
				}
				if test.traversal {
					arguments["folder"] = "../outside"
				}
				if toolName == "create_download" {
					arguments["url"] = "https://example.com/video.mp4"
					arguments["name"] = "video"
				} else {
					job, err := discoveries.Create(context.Background(), discovery.CreateDiscoveryInput{URL: "https://example.com/video.m3u8", Mode: discovery.ModeInspect})
					if err != nil {
						t.Fatal(err)
					}
					if len(job.Sources) != 1 {
						t.Fatalf("unexpected discovery: %+v", job)
					}
					arguments["id"] = job.ID
					arguments["sourceIds"] = []string{job.Sources[0].ID}
					arguments["startDownload"] = !test.deferred
				}
				result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: toolName, Arguments: arguments})
				if err != nil {
					t.Fatal(err)
				}
				videos, err := repository.FindAll("ASC")
				if err != nil {
					t.Fatal(err)
				}
				if test.wantError != "" {
					encoded, _ := json.Marshal(result.Content)
					if !result.IsError || !strings.Contains(string(encoded), test.wantError) {
						t.Fatalf("expected %q, got %+v", test.wantError, result)
					}
					if len(videos) != 0 || len(captured) != 0 {
						t.Fatal("rejected request created a download")
					}
					return
				}
				if result.IsError {
					t.Fatalf("tool failed: %+v", result)
				}
				if len(videos) != 1 || videos[0].DownloadDir != wantDir {
					t.Fatalf("unexpected saved downloads: %+v", videos)
				}
				if cfg.localDir != originalRoot {
					t.Fatal("global download directory changed")
				}
				if test.deferred && len(captured) != 0 {
					t.Fatal("deferred download started immediately")
				}
				if !test.deferred {
					assertDirectoryQueueParams(t, captured, queue, wantDir)
				}
				// A new service instance must retrieve the persisted override for
				// deferred starts and retries, independent of the global root.
				restarted := service.NewDownloadTaskService(repository, queue, nil)
				if err := restarted.StartDownload(videos[0].ID, t.TempDir(), false); err != nil {
					t.Fatal(err)
				}
				assertDirectoryQueueParams(t, captured, queue, wantDir)
			})
		}
	}
}

func assertDirectoryQueueParams(t *testing.T, captured <-chan core.DownloadParams, queue *core.TaskQueue, wantDir string) {
	t.Helper()
	select {
	case p := <-captured:
		if p.DownloadDir != wantDir || p.Folder != "courses/chapter1" {
			t.Fatalf("unexpected queue params: %+v", p)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("download did not reach queue")
	}
	deadline := time.Now().Add(3 * time.Second)
	for queue.IsFull() {
		if time.Now().After(deadline) {
			t.Fatal("queue did not finish")
		}
		time.Sleep(time.Millisecond)
	}
}
