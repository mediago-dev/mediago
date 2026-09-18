package service

import (
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

func newLifecycleService(t *testing.T) (*DownloadTaskService, *headerCaptureDownloader, *core.TaskQueue) {
	t.Helper()
	previous, sugar := logger.Logger, logger.Sugar
	logger.Logger, logger.Sugar = zap.NewNop(), zap.NewNop().Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previous, sugar })
	svc, _ := newTestDownloadTaskService(t)
	capture := &headerCaptureDownloader{params: make(chan core.DownloadParams, 128)}
	queue := core.NewTaskQueue(capture, 1)
	svc.queue = queue
	t.Cleanup(func() { waitForRuntimeHeaderQueue(t, queue) })
	return svc, capture, queue
}

func receiveLifecycleDownload(t *testing.T, capture *headerCaptureDownloader, queue *core.TaskQueue) core.DownloadParams {
	t.Helper()
	select {
	case params := <-capture.params:
		waitForRuntimeHeaderQueue(t, queue)
		return params
	case <-time.After(time.Second):
		t.Fatal("download did not start")
		return core.DownloadParams{}
	}
}

func TestEditHeadersReplacesCachedCredentialsAndAllowsExplicitClear(t *testing.T) {
	svc, capture, queue := newLifecycleService(t)
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{URL: "https://example.com/video", RuntimeHeaders: []string{"Cookie: synthetic-old"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.forgetRuntimeHeaders(video.ID) })
	edit := func(raw string) {
		t.Helper()
		updated, err := svc.EditDownloadTask(video.ID, map[string]any{"headers": raw})
		if err != nil {
			t.Fatal(err)
		}
		if updated.Headers != nil && strings.Contains(*updated.Headers, "synthetic-") {
			t.Fatal("private headers persisted")
		}
	}
	start := func(want string) {
		t.Helper()
		if err := svc.StartDownload(video.ID, t.TempDir(), false); err != nil {
			t.Fatal(err)
		}
		params := receiveLifecycleDownload(t, capture, queue)
		joined := strings.Join(params.Headers, "\n")
		if strings.Contains(joined, "synthetic-old") || (want != "" && !strings.Contains(joined, want)) || (want == "" && len(params.Headers) != 0) {
			t.Fatalf("unexpected headers: %v", params.Headers)
		}
	}
	edit(`["Cookie: synthetic-new", "Referer: https://example.com/watch"]`)
	if _, err := svc.EditDownloadTask(video.ID, map[string]any{"name": "renamed"}); err != nil {
		t.Fatal(err)
	}
	start("synthetic-new")
	svc.forgetRuntimeHeaders(video.ID)
	if err := svc.StartDownload(video.ID, t.TempDir(), false); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("expired credentials accepted: %v", err)
	}
	edit("Cookie: synthetic-refreshed")
	start("synthetic-refreshed")
	for _, clear := range []string{"", "[]"} {
		edit(`["Cookie: synthetic-new"]`)
		edit(clear)
		stored, err := svc.FindByIDOrFail(video.ID)
		if err != nil || stored.RequiresRuntimeHeaders || stored.Headers != nil {
			t.Fatalf("clear did not remove authentication: %+v, %v", stored, err)
		}
		start("")
	}
}

func TestCredentialHandoffRejectsEditedURLAndPreservesNewCredentials(t *testing.T) {
	svc, capture, queue := newLifecycleService(t)
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{URL: "https://original.example/video"})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.forgetRuntimeHeaders(video.ID) })
	existing, err := svc.FindByURL(video.URL)
	if err != nil {
		t.Fatal(err)
	}
	const newURL = "https://different.example/video"
	if _, err := svc.EditDownloadTask(video.ID, map[string]any{"url": newURL, "headers": `["Authorization: synthetic-new-site"]`}); err != nil {
		t.Fatal(err)
	}
	staleHeaders := []string{"Authorization: synthetic-original-site"}
	if err := svc.SetRuntimeHeaders(existing.ID, existing.URL, staleHeaders); !errors.Is(err, ErrDownloadURLChanged) {
		t.Fatalf("stale discovery handoff accepted: %v", err)
	}
	if err := svc.StartDownloadWithRuntimeHeaders(existing.ID, existing.URL, t.TempDir(), false, staleHeaders); !errors.Is(err, ErrDownloadURLChanged) {
		t.Fatalf("stale start handoff accepted: %v", err)
	}
	// A stale authentication query must not evict the new URL's cache entry.
	svc.AuthenticationStatus(existing)
	if err := svc.StartDownload(video.ID, t.TempDir(), false); err != nil {
		t.Fatal(err)
	}
	params := receiveLifecycleDownload(t, capture, queue)
	if params.URL != newURL || strings.Join(params.Headers, "\n") != "Authorization: synthetic-new-site" {
		t.Fatalf("credentials rebound: %+v", params)
	}
	// Moving away and back must not restore the original cache or legacy headers.
	for _, url := range []string{video.URL, newURL} {
		if _, err := svc.EditDownloadTask(video.ID, map[string]any{"url": url}); err != nil {
			t.Fatal(err)
		}
	}
	if err := svc.StartDownload(video.ID, t.TempDir(), false); !errors.Is(err, ErrRuntimeHeadersExpired) {
		t.Fatalf("old credentials survived URL edits: %v", err)
	}
}

func TestConcurrentCredentialRefreshEditAndStartKeepURLBinding(t *testing.T) {
	svc, capture, queue := newLifecycleService(t)
	const original = "https://original.example/video"
	const changed = "https://changed.example/video"
	video, err := svc.AddDownloadTask(&AddDownloadTaskInput{URL: original, RuntimeHeaders: []string{"Cookie: original"}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { svc.forgetRuntimeHeaders(video.ID) })
	localDir := t.TempDir()
	for i := 0; i < 30; i++ {
		if _, err := svc.EditDownloadTask(video.ID, map[string]any{"url": original, "headers": `["Cookie: original"]`}); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		wg.Add(3)
		errs := make(chan error, 3)
		go func() {
			defer wg.Done()
			errs <- svc.SetRuntimeHeaders(video.ID, original, []string{"Cookie: original"})
		}()
		go func() {
			defer wg.Done()
			_, err := svc.EditDownloadTask(video.ID, map[string]any{"url": changed, "headers": `["Cookie: changed"]`})
			errs <- err
		}()
		go func() {
			defer wg.Done()
			errs <- svc.StartDownloadWithRuntimeHeaders(video.ID, original, localDir, false, []string{"Cookie: original"})
		}()
		wg.Wait()
		close(errs)
		for err := range errs {
			if err != nil && !errors.Is(err, ErrDownloadURLChanged) {
				t.Fatal(err)
			}
		}
		waitForRuntimeHeaderQueue(t, queue)
		if err := svc.StartDownload(video.ID, localDir, false); err != nil {
			t.Fatal(err)
		}
		waitForRuntimeHeaderQueue(t, queue)
		for len(capture.params) > 0 {
			params := <-capture.params
			want := "Cookie: original"
			if params.URL == changed {
				want = "Cookie: changed"
			}
			if strings.Join(params.Headers, "\n") != want {
				t.Fatalf("cross-URL credentials: %+v", params)
			}
		}
	}
}
