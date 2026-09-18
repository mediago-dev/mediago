package service

import (
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

func TestTaskCredentialsSurviveDeferredStartAndRetryButNotRestartOrExpiry(t *testing.T) {
	previous, sugar := logger.Logger, logger.Sugar
	logger.Logger, logger.Sugar = zap.NewNop(), zap.NewNop().Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previous, sugar })
	database, err := db.New(filepath.Join(t.TempDir(), "downloads.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	repository := repo.NewVideoRepository(database)
	downloader := &headerCaptureDownloader{params: make(chan core.DownloadParams, 4)}
	queue := core.NewTaskQueue(downloader, 1)
	svc := NewDownloadTaskService(repository, queue, nil)
	private := []string{"Cookie: sentinel-cookie", "X-Api-Key: sentinel-key", "Referer: https://example.com/watch"}
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{URL: "https://example.com/video.mp4", Type: "direct", RuntimeHeaders: private, Headers: PersistentDiscoveryHeaders(private)})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.forgetRuntimeHeaders(video.ID) })
	if !video.RequiresRuntimeHeaders || video.Headers == nil || strings.Contains(*video.Headers, "sentinel-") {
		t.Fatalf("credentials persisted or requirement lost: %+v", video)
	}
	start := func(service *DownloadTaskService) {
		t.Helper()
		if err := service.StartDownload(video.ID, t.TempDir(), false); err != nil {
			t.Fatal(err)
		}
		select {
		case params := <-downloader.params:
			if !strings.Contains(strings.Join(params.Headers, "\n"), "sentinel-key") {
				t.Fatalf("credentials lost: %+v", params)
			}
		case <-time.After(time.Second):
			t.Fatal("download not started")
		}
		waitForRuntimeHeaderQueue(t, queue)
	}
	start(svc)
	start(svc)
	restarted := NewDownloadTaskService(repository, queue, nil)
	if err := restarted.StartDownload(video.ID, t.TempDir(), false); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("restart should require credentials: %v", err)
	}
	if err := svc.SetRuntimeHeaders(video.ID, video.URL, []string{"Referer: https://example.com/watch"}); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("partial refresh erased credential requirement: %v", err)
	}
	svc.runtimeMu.Lock()
	entry := svc.runtimeHeaders[video.ID]
	entry.expiresAt = time.Now().Add(-time.Second)
	svc.runtimeHeaders[video.ID] = entry
	svc.runtimeMu.Unlock()
	if err := svc.StartDownload(video.ID, t.TempDir(), false); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("expired credentials used: %v", err)
	}
	if err := svc.SetRuntimeHeaders(video.ID, video.URL, private); err != nil {
		t.Fatal(err)
	}
	start(svc)
	if _, err := svc.EditDownloadTask(video.ID, map[string]any{"url": "https://other.example/video.mp4"}); err != nil {
		t.Fatal(err)
	}
	if err := svc.StartDownload(video.ID, t.TempDir(), false); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("credentials reused at another URL: %v", err)
	}
}

func TestPersistedFailureCodeIsSafeAndClearedBeforeRetry(t *testing.T) {
	svc, repository := newTestDownloadTaskService(t)
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{URL: "https://example.com/video"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.FailDownload(video.ID, &core.DependencyError{Tool: "private-token", ExpectedPath: "private-path"}); err != nil {
		t.Fatal(err)
	}
	stored, err := repository.FindByIDOrFail(video.ID)
	if err != nil || stored.Status != "failed" || stored.LastErrorCode != "dependency_missing" {
		t.Fatalf("failure not persisted safely: %+v, %v", stored, err)
	}
	if err := repository.PrepareDownload(video.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ = repository.FindByIDOrFail(video.ID)
	if stored.LastErrorCode != "" {
		t.Fatal("retry kept stale error")
	}
}
