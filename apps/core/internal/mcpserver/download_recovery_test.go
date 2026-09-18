package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
)

type recoveryFileDownloader struct {
	path  string
	calls chan struct{}
}

func (d *recoveryFileDownloader) Config() any { return nil }
func (d *recoveryFileDownloader) Download(_ context.Context, _ core.DownloadParams, _ core.Callbacks) (core.DownloadResult, error) {
	d.calls <- struct{}{}
	if err := os.WriteFile(d.path, []byte("synthetic-media"), 0600); err != nil {
		return core.DownloadResult{}, err
	}
	return core.DownloadResult{PrimaryPath: d.path, ArtifactPaths: []string{d.path}}, nil
}

func TestMCPPublishesSuccessOnlyAfterSavingFiles(t *testing.T) {
	d := &recoveryFileDownloader{path: filepath.Join(t.TempDir(), "out.mp4"), calls: make(chan struct{}, 2)}
	f := newProtocolFixture(t, true, d)
	entered, release := make(chan struct{}), make(chan struct{})
	f.queue.OnComplete(func(id core.TaskID, result core.DownloadResult) error {
		close(entered)
		<-release
		return f.downloads.CompleteDownload(parseTestID(id), result)
	})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	t.Cleanup(unblock)
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video"}, false)
	select {
	case <-entered:
	case <-time.After(time.Second):
		t.Fatal("completion not reached")
	}
	id := int64(created["id"].(float64))
	snapshot, err := f.downloads.GetDownloadTask(id, f.manager.config.GetLocalDir())
	if err != nil {
		t.Fatal(err)
	}
	out := callProtocol(t, f.session, "get_download", map[string]any{"id": id}, false)
	listed := callProtocol(t, f.session, "list_downloads", map[string]any{}, false)
	for _, record := range []map[string]any{out, listed["list"].([]any)[0].(map[string]any)} {
		if record["status"] == "success" {
			t.Fatalf("success published before persistence: %+v", record)
		}
	}
	unblock()
	waitProtocolQueue(t, f.queue)
	// A DTO made from a previously captured record must not mix in newer runtime state.
	if stale := f.manager.downloadDTO(snapshot); stale.Status == "success" {
		t.Fatalf("stale query mixed with newer queue state: %+v", stale)
	}
	final := callProtocol(t, f.session, "get_download", map[string]any{"id": id}, false)
	if final["status"] != "success" || final["exists"] != true || final["file"] != d.path || len(final["files"].([]any)) != 1 {
		t.Fatalf("incomplete success: %+v", final)
	}
}

func TestMCPCompletionPersistenceFailureDoesNotReportSuccess(t *testing.T) {
	d := &recoveryFileDownloader{path: filepath.Join(t.TempDir(), "out.mp4"), calls: make(chan struct{}, 2)}
	f := newProtocolFixture(t, true, d)
	success := make(chan struct{}, 1)
	f.queue.OnComplete(func(core.TaskID, core.DownloadResult) error { return errors.New("synthetic-private-database-error") })
	f.queue.OnSuccess(func(core.TaskID, core.DownloadResult) { success <- struct{}{} })
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video"}, false)
	waitProtocolQueue(t, f.queue)
	out := callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
	failure := out["lastError"].(map[string]any)
	if out["status"] != "failed" || failure["code"] != "result_persistence_failed" || failure["retryable"] != false || strings.Contains(failure["message"].(string), "synthetic-private") {
		t.Fatalf("unsafe or incorrect failure: %+v", out)
	}
	if len(success) != 0 {
		t.Fatal("success notification emitted after failed persistence")
	}
	record, err := f.repo.FindByIDOrFail(int64(created["id"].(float64)))
	if err != nil || core.DownloadFailureFromCode(record.LastErrorCode).Code != "result_persistence_failed" {
		t.Fatalf("persisted failure lost: %+v, %v", record, err)
	}
}

func TestMCPStartRecoversMissingOutputAndRemainsIdempotent(t *testing.T) {
	d := &recoveryFileDownloader{path: filepath.Join(t.TempDir(), "out.mp4"), calls: make(chan struct{}, 64)}
	f := newProtocolFixture(t, true, d)
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video"}, false)
	waitProtocolQueue(t, f.queue)
	id := int64(created["id"].(float64))
	intact := callProtocol(t, f.session, "start_download", map[string]any{"id": id}, false)
	if intact["exists"] != true || len(d.calls) != 1 {
		t.Fatalf("intact download restarted: %+v", intact)
	}
	if err := os.Remove(d.path); err != nil {
		t.Fatal(err)
	}
	duplicate := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video"}, false)
	if duplicate["outcome"] != "existing" || duplicate["exists"] != false || len(d.calls) != 1 {
		t.Fatalf("duplicate creation changed task: %+v", duplicate)
	}
	// Race multiple starts against a downloader that can finish before the next request.
	var wg sync.WaitGroup
	errs := make(chan error, 24)
	for i := 0; i < cap(errs); i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := f.manager.startDownload(context.Background(), startDownloadInput{ID: id})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	waitProtocolQueue(t, f.queue)
	final := callProtocol(t, f.session, "get_download", map[string]any{"id": id}, false)
	if final["status"] != "success" || final["exists"] != true || len(d.calls) != 2 {
		t.Fatalf("missing file recovery was not exactly once: calls=%d, result=%+v", len(d.calls), final)
	}
}

func TestMCPMissingOutputIgnoresResidualFragments(t *testing.T) {
	for _, custom := range []bool{false, true} {
		t.Run(fmt.Sprintf("custom-directory=%v", custom), func(t *testing.T) {
			d := &recoveryFileDownloader{calls: make(chan struct{}, 4)}
			f := newProtocolFixture(t, true, d)
			root := f.manager.config.GetLocalDir()
			args := map[string]any{"url": "https://example.com/video", "name": "video"}
			if custom {
				root = t.TempDir()
				args["downloadDir"] = root
			}
			d.path = filepath.Join(root, "video.mp4")
			created := callProtocol(t, f.session, "create_download", args, false)
			waitProtocolQueue(t, f.queue)
			if err := os.Remove(d.path); err != nil {
				t.Fatal(err)
			}
			for _, name := range []string{"video.f137.mp4", "video.f140.m4a"} {
				if err := os.WriteFile(filepath.Join(root, name), []byte("synthetic fragment"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			out := callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
			listed := callProtocol(t, f.session, "list_downloads", map[string]any{}, false)
			for _, record := range []map[string]any{out, listed["list"].([]any)[0].(map[string]any)} {
				if record["exists"] != false || len(record["files"].([]any)) != 0 || record["file"] != nil {
					t.Fatalf("fragment treated as output: %+v", record)
				}
			}
			stored, err := f.repo.FindByIDOrFail(int64(created["id"].(float64)))
			if err != nil || stored.OutputPath != d.path {
				t.Fatalf("lost original output identity: %+v, %v", stored, err)
			}
			callProtocol(t, f.session, "start_download", map[string]any{"id": created["id"]}, false)
			waitProtocolQueue(t, f.queue)
			final := callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
			if final["status"] != "success" || final["file"] != d.path || len(d.calls) != 2 {
				t.Fatalf("missing output not recovered: %+v, calls=%d", final, len(d.calls))
			}
		})
	}
}
