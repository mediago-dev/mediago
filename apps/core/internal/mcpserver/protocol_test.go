package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"
	"reflect"
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
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"go.uber.org/zap"
)

type protocolFixture struct {
	manager     *Manager
	session     *mcp.ClientSession
	downloads   *service.DownloadTaskService
	discoveries *discovery.Service
	repo        *repo.VideoRepository
	queue       *core.TaskQueue
}

func newProtocolFixture(t *testing.T, desktop bool, downloader core.Downloader) protocolFixture {
	t.Helper()
	previous, sugar := logger.Logger, logger.Sugar
	logger.Logger, logger.Sugar = zap.NewNop(), zap.NewNop().Sugar()
	t.Cleanup(func() { logger.Logger, logger.Sugar = previous, sugar })
	database, err := db.New(filepath.Join(t.TempDir(), "downloads.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	repository := repo.NewVideoRepository(database)
	var queue *core.TaskQueue
	if downloader != nil {
		queue = core.NewTaskQueue(downloader, 1)
	}
	downloads := service.NewDownloadTaskService(repository, queue, nil)
	if queue != nil {
		queue.OnStart(func(id core.TaskID) { _ = downloads.SetStatus([]int64{parseTestID(id)}, "downloading") })
		queue.OnComplete(func(id core.TaskID, result core.DownloadResult) error {
			return downloads.CompleteDownload(parseTestID(id), result)
		})
		queue.OnStopped(func(id core.TaskID) { _ = downloads.SetStatus([]int64{parseTestID(id)}, "stopped") })
		queue.OnFailed(func(id core.TaskID, err error) { _ = downloads.FailDownload(parseTestID(id), err) })
		t.Cleanup(func() {
			for _, task := range queue.GetAllTasks() {
				_ = queue.Stop(task.ID)
			}
			if controlled, ok := downloader.(*controlledProtocolDownloader); ok && controlled.release != nil {
				select {
				case <-controlled.release:
				default:
					close(controlled.release)
				}
			}
			waitProtocolQueue(t, queue)
		})
	}
	discoveries := discovery.NewService(nil, mcpDiscoveryInspector{}, mcpDiscoveryExecutor{})
	t.Cleanup(discoveries.Close)
	config := testDownloadConfig{localDir: t.TempDir(), desktop: desktop}
	handoff := handler.NewDiscoveryHandler(discoveries, downloads, directoryConfigStore{"local": config.localDir}, nil)
	manager := NewManager(downloads, config, discoveries, handoff)
	manager.Apply(Settings{Enabled: true, Token: "secret"})
	return protocolFixture{manager, connectTestSession(t, manager), downloads, discoveries, repository, queue}
}

func parseTestID(id core.TaskID) int64 {
	var value int64
	_ = json.Unmarshal([]byte(id), &value)
	return value
}
func waitProtocolQueue(t *testing.T, queue *core.TaskQueue) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for queue.IsFull() {
		if time.Now().After(deadline) {
			t.Fatal("queue did not finish")
		}
		time.Sleep(time.Millisecond)
	}
}

func callProtocol(t *testing.T, session *mcp.ClientSession, name string, args any, wantError bool) map[string]any {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError != wantError {
		t.Fatalf("%s isError=%v, want %v: %+v", name, result.IsError, wantError, result)
	}
	data, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	if err := json.Unmarshal(data, &out); err != nil {
		t.Fatalf("%s result not an object: %s", name, data)
	}
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range listed.Tools {
		if tool.Name != name {
			continue
		}
		schemaJSON, _ := json.Marshal(tool.OutputSchema)
		var schema jsonschema.Schema
		if err := json.Unmarshal(schemaJSON, &schema); err != nil {
			t.Fatal(err)
		}
		resolved, err := schema.Resolve(nil)
		if err != nil {
			t.Fatal(err)
		}
		if err := resolved.Validate(out); err != nil {
			t.Fatalf("%s output violates declared schema: %v\n%s", name, err, data)
		}
	}
	var textValue any
	if len(result.Content) != 1 || json.Unmarshal([]byte(result.Content[0].(*mcp.TextContent).Text), &textValue) != nil || !reflect.DeepEqual(textValue, out) {
		t.Fatalf("text and structured outputs differ: %+v", result)
	}
	return out
}

func TestMCPRejectsInvalidInputsBeforeSideEffects(t *testing.T) {
	f := newProtocolFixture(t, true, nil)
	for _, tc := range []struct {
		tool string
		args map[string]any
	}{
		{"discover_media", map[string]any{"url": "https://example.com/watch", "waitSeconds": -1}},
		{"discover_media", map[string]any{"url": "https://example.com/watch", "waitSeconds": 26}},
		{"discover_media", map[string]any{"url": "https://example.com/watch", "timeoutMs": 1}},
		{"discover_media", map[string]any{"url": "https://example.com/watch", "mode": "unknown"}},
		{"discover_media", map[string]any{"url": "https://example.com/master.m3u8", "useSessionCookies": true}},
		{"create_download", map[string]any{"url": "file:///secret"}},
		{"create_download", map[string]any{"url": "https://user:sentinel-secret@example.com/video"}},
		{"create_download", map[string]any{"url": "https://example.com/video", "type": "unknown"}},
		{"create_download", map[string]any{"url": "https://example.com/video", "headers": []string{"Authorization: sentinel-secret\r\nInjected: true"}}},
		{"create_download", map[string]any{"url": "https://example.com/video", "headers": map[string]string{"Authorization": "sentinel-secret"}}},
		{"create_download", map[string]any{"url": "https://example.com/video", "Authorization": "sentinel-secret"}},
		{"list_downloads", map[string]any{"pageSize": 101}},
		{"list_downloads", map[string]any{"current": 0}},
		{"list_downloads", map[string]any{"filter": "failed"}},
		{"get_download", map[string]any{"id": 0}},
		{"start_download", map[string]any{"id": -1}},
		{"stop_download", map[string]any{"id": 9007199254740992}},
		{"download_discovered_media", map[string]any{"id": "job", "sourceIds": []string{"a", "a"}}},
		{"download_discovered_media", map[string]any{"id": "job", "sourceIds": []string{"a"}, "selections": []map[string]string{{"sourceId": "a"}}}},
	} {
		out := callProtocol(t, f.session, tc.tool, tc.args, true)
		encoded, _ := json.Marshal(out)
		if out["error"].(map[string]any)["code"] != "invalid_argument" || strings.Contains(string(encoded), "sentinel-secret") {
			t.Fatalf("unsafe/unstable validation error: %s", encoded)
		}
	}
	status := f.discoveries.ExecutorStatus()
	if status.ActiveDiscoveryID != "" || status.Queued != 0 {
		t.Fatalf("invalid input created discovery: %+v", status)
	}
	records, err := f.repo.FindAll("ASC")
	if err != nil || len(records) != 0 {
		t.Fatalf("invalid input persisted downloads: %+v, %v", records, err)
	}
}

func TestMCPDownloadResponsesNeverReturnHeaders(t *testing.T) {
	f := newProtocolFixture(t, true, nil)
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video.mp4", "startDownload": false, "headers": []string{"Authorization: Bearer sentinel-new", "Cookie: sentinel-new", "X-Api-Key: sentinel-new"}}, false)
	legacyHeaders := `["Authorization: Bearer sentinel-old","Cookie: sentinel-old"]`
	legacy, err := f.downloads.AddDownloadTask(&service.AddDownloadTaskInput{URL: "https://example.com/legacy", Headers: &legacyHeaders})
	if err != nil {
		t.Fatal(err)
	}
	outputs := []map[string]any{created,
		callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false),
		callProtocol(t, f.session, "get_download", map[string]any{"id": legacy.ID}, false),
		callProtocol(t, f.session, "list_downloads", map[string]any{}, false),
	}
	for _, output := range outputs {
		encoded, _ := json.Marshal(output)
		if strings.Contains(string(encoded), "sentinel-") || strings.Contains(string(encoded), `"headers"`) {
			t.Fatalf("leaked headers: %s", encoded)
		}
	}
	stored, err := f.repo.FindByIDOrFail(int64(created["id"].(float64)))
	if err != nil || stored.Headers != nil || !stored.RequiresRuntimeHeaders {
		t.Fatalf("new credentials persisted: %+v, %v", stored, err)
	}
	duplicate := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video.mp4", "name": "changed"}, false)
	if duplicate["outcome"] != "existing" || duplicate["id"] != created["id"] || duplicate["name"] != created["name"] {
		t.Fatalf("duplicate changed the task: %+v", duplicate)
	}
}

func TestMCPCapabilitiesAndAllSchemas(t *testing.T) {
	for _, desktop := range []bool{true, false} {
		f := newProtocolFixture(t, desktop, nil)
		out := callProtocol(t, f.session, "get_capabilities", map[string]any{}, false)
		if out["customDownloadDirectory"] != desktop || out["protocolRevision"] != "2" || out["maxPageSize"] != float64(100) {
			t.Fatalf("unexpected capabilities: %+v", out)
		}
		listed, err := f.session.ListTools(context.Background(), nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(listed.Tools) != 11 {
			t.Fatalf("tool count = %d", len(listed.Tools))
		}
		for _, tool := range listed.Tools {
			if tool.InputSchema == nil || tool.OutputSchema == nil {
				t.Fatalf("missing schemas: %s", tool.Name)
			}
			if tool.Name == "create_download" || tool.Name == "start_download" || tool.Name == "download_discovered_media" {
				if tool.Annotations.ReadOnlyHint || !*tool.Annotations.OpenWorldHint {
					t.Fatalf("wrong network mutation annotations: %s", tool.Name)
				}
			}
		}
		callProtocol(t, f.session, "health_check", nil, false)
	}
}

type controlledProtocolDownloader struct {
	params          chan core.DownloadParams
	release         chan struct{}
	finishAfterStop bool
	failure         error
}

func (d *controlledProtocolDownloader) Config() any { return nil }
func (d *controlledProtocolDownloader) Download(ctx context.Context, p core.DownloadParams, cb core.Callbacks) (core.DownloadResult, error) {
	cb.OnProgress(core.ProgressEvent{ID: p.ID, Percent: 42, Speed: "2 MB/s", IsLive: d.finishAfterStop})
	d.params <- p
	if d.failure != nil {
		return core.DownloadResult{}, d.failure
	}
	<-ctx.Done()
	<-d.release
	if d.finishAfterStop {
		return core.DownloadResult{FinalizedAfterStop: true}, nil
	}
	return core.DownloadResult{}, ctx.Err()
}

func TestMCPReportsLiveProgressAndAsynchronousStop(t *testing.T) {
	for _, finalSuccess := range []bool{false, true} {
		d := &controlledProtocolDownloader{params: make(chan core.DownloadParams, 2), release: make(chan struct{}), finishAfterStop: finalSuccess}
		f := newProtocolFixture(t, true, d)
		created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/video.mp4"}, false)
		if created["status"] != "downloading" {
			t.Fatalf("stale creation status: %+v", created)
		}
		<-d.params
		out := callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
		if out["progress"].(map[string]any)["percent"] != float64(42) {
			t.Fatalf("missing runtime progress: %+v", out)
		}
		callProtocol(t, f.session, "start_download", map[string]any{"id": created["id"]}, false)
		if len(d.params) != 0 {
			t.Fatal("active task started twice")
		}
		stop := callProtocol(t, f.session, "stop_download", map[string]any{"id": created["id"]}, false)
		if stop["status"] != "stopping" || stop["accepted"] != true {
			t.Fatalf("stop claimed completion: %+v", stop)
		}
		close(d.release)
		waitProtocolQueue(t, f.queue)
		out = callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
		want := "stopped"
		if finalSuccess {
			want = "success"
		}
		if out["status"] != want {
			t.Fatalf("terminal status=%v, want %s", out["status"], want)
		}
		stop = callProtocol(t, f.session, "stop_download", map[string]any{"id": created["id"]}, false)
		if stop["accepted"] != false || stop["status"] != want {
			t.Fatalf("inactive task status changed: %+v", stop)
		}
	}
}

func completeProtocolDiscovery(t *testing.T, f protocolFixture) discovery.DiscoveryJob {
	t.Helper()
	job, err := f.discoveries.Create(context.Background(), discovery.CreateDiscoveryInput{URL: "https://example.com/watch", Mode: discovery.ModeBrowser})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.discoveries.MarkRunning(job.ID); err != nil {
		t.Fatal(err)
	}
	job, err = f.discoveries.Complete(context.Background(), job.ID, []discovery.PrivateSource{
		{DiscoverySource: discovery.DiscoverySource{ID: "a", URL: "https://cdn.example.com/master.m3u8", Type: discovery.SourceTypeM3U8, Title: "A", Variants: []discovery.HLSVariant{{URL: "https://cdn.example.com/720.m3u8", Quality: "720p"}}}, Headers: []string{"Cookie: sentinel-private"}},
		{DiscoverySource: discovery.DiscoverySource{ID: "b", URL: "https://cdn.example.com/b.mp4", Type: discovery.SourceTypeDirect, Title: "B"}},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	return job
}

func TestMCPBatchVariantsDuplicatesAndDeferredCredentials(t *testing.T) {
	d := &directoryCaptureDownloader{params: make(chan core.DownloadParams, 2)}
	f := newProtocolFixture(t, true, d)
	job := completeProtocolDiscovery(t, f)
	bad := callProtocol(t, f.session, "download_discovered_media", map[string]any{"id": job.ID, "selections": []map[string]string{{"sourceId": "b"}, {"sourceId": "a", "variantUrl": "https://other.example/steal"}}}, true)
	if bad["error"].(map[string]any)["code"] != "invalid_argument" {
		t.Fatalf("wrong variant error: %+v", bad)
	}
	rows, _ := f.repo.FindAll("ASC")
	if len(rows) != 0 {
		t.Fatal("invalid batch partially persisted")
	}
	out := callProtocol(t, f.session, "download_discovered_media", map[string]any{"id": job.ID, "startDownload": false, "selections": []map[string]string{{"sourceId": "a", "variantUrl": "https://cdn.example.com/720.m3u8", "name": "selected"}}}, false)
	item := out["items"].([]any)[0].(map[string]any)
	download := item["download"].(map[string]any)
	if item["outcome"] != "created" || download["url"] != "https://cdn.example.com/720.m3u8" || download["name"] != "selected" || download["authenticationAvailable"] != true {
		t.Fatalf("wrong selection: %+v", item)
	}
	if len(d.params) != 0 {
		t.Fatal("deferred task started")
	}
	callProtocol(t, f.session, "start_download", map[string]any{"id": item["downloadId"]}, false)
	select {
	case params := <-d.params:
		if params.URL != "https://cdn.example.com/720.m3u8" || !strings.Contains(strings.Join(params.Headers, "\n"), "sentinel-private") {
			t.Fatalf("handoff lost variant or credentials: %+v", params)
		}
	case <-time.After(time.Second):
		t.Fatal("deferred task not started")
	}
	waitProtocolQueue(t, f.queue)
	out = callProtocol(t, f.session, "download_discovered_media", map[string]any{"id": job.ID, "startDownload": false, "selections": []map[string]string{{"sourceId": "a", "variantUrl": "https://cdn.example.com/720.m3u8"}, {"sourceId": "b"}}}, false)
	items := out["items"].([]any)
	if len(items) != 2 || items[0].(map[string]any)["outcome"] != "existing" || items[0].(map[string]any)["downloadId"] != item["downloadId"] || items[1].(map[string]any)["outcome"] != "created" {
		t.Fatalf("batch lost correspondence: %+v", out)
	}
	if len(d.params) != 0 {
		t.Fatal("duplicate task restarted")
	}
}

func TestMCPBatchStartFailuresRetainCreatedIDs(t *testing.T) {
	f := newProtocolFixture(t, true, nil)
	job := completeProtocolDiscovery(t, f)
	out := callProtocol(t, f.session, "download_discovered_media", map[string]any{"id": job.ID, "sourceIds": []string{"a", "b"}}, false)
	items := out["items"].([]any)
	if len(items) != 2 {
		t.Fatalf("lost batch items: %+v", out)
	}
	for _, entry := range items {
		item := entry.(map[string]any)
		if item["outcome"] != "failed" || item["downloadId"] == nil || item["error"].(map[string]any)["code"] != "download_queue_unavailable" {
			t.Fatalf("lost created identity: %+v", item)
		}
	}
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/start-failed"}, true)
	if created["error"].(map[string]any)["downloadId"] == nil {
		t.Fatalf("lost single creation ID: %+v", created)
	}
}

func TestMCPFailureDiagnosticsDoNotExposeRawErrors(t *testing.T) {
	d := &controlledProtocolDownloader{params: make(chan core.DownloadParams, 1), failure: errors.New("process failed with Authorization: sentinel-error")}
	f := newProtocolFixture(t, false, d)
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/failure"}, false)
	<-d.params
	waitProtocolQueue(t, f.queue)
	out := callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
	encoded, _ := json.Marshal(out)
	if strings.Contains(string(encoded), "sentinel-error") || out["lastError"].(map[string]any)["code"] != "download_failed" {
		t.Fatalf("unsafe diagnostics: %s", encoded)
	}
	restarted := service.NewDownloadTaskService(f.repo, nil, nil)
	f.manager.download = restarted
	out = callProtocol(t, f.session, "get_download", map[string]any{"id": created["id"]}, false)
	if out["status"] != "failed" || out["lastError"].(map[string]any)["code"] != "download_failed" {
		t.Fatalf("lost persisted failure: %+v", out)
	}
}

func TestMCPStartRecoversInterruptedTaskAndExpiredCredentials(t *testing.T) {
	d := &directoryCaptureDownloader{params: make(chan core.DownloadParams, 2)}
	f := newProtocolFixture(t, true, d)
	created := callProtocol(t, f.session, "create_download", map[string]any{"url": "https://example.com/restart", "startDownload": false, "headers": []string{"Cookie: sentinel-first"}}, false)
	id := int64(created["id"].(float64))
	if err := f.downloads.SetStatus([]int64{id}, "downloading"); err != nil {
		t.Fatal(err)
	}
	// Simulate a Core restart: persisted task remains; its private cache does not.
	f.manager.download = service.NewDownloadTaskService(f.repo, f.queue, nil)
	out := callProtocol(t, f.session, "get_download", map[string]any{"id": id}, false)
	if out["status"] != "stopped" || out["authenticationAvailable"] != false || out["lastError"].(map[string]any)["code"] != "download_interrupted" {
		t.Fatalf("interrupted task looks active: %+v", out)
	}
	failure := callProtocol(t, f.session, "start_download", map[string]any{"id": id}, true)
	if failure["error"].(map[string]any)["code"] != "credentials_expired" {
		t.Fatalf("missing recovery error: %+v", failure)
	}
	callProtocol(t, f.session, "start_download", map[string]any{"id": id, "headers": []string{"Cookie: sentinel-fresh"}}, false)
	select {
	case params := <-d.params:
		if !strings.Contains(strings.Join(params.Headers, "\n"), "sentinel-fresh") {
			t.Fatalf("fresh credentials not used: %+v", params)
		}
	case <-time.After(time.Second):
		t.Fatal("interrupted task not restarted")
	}
	waitProtocolQueue(t, f.queue)
}

func TestMCPPaginationAndDiscoveryLifecycleHaveTypedOutputs(t *testing.T) {
	f := newProtocolFixture(t, true, nil)
	for _, url := range []string{"https://example.com/a", "https://example.com/b"} {
		callProtocol(t, f.session, "create_download", map[string]any{"url": url, "startDownload": false}, false)
	}
	first := callProtocol(t, f.session, "list_downloads", map[string]any{"pageSize": 1}, false)
	second := callProtocol(t, f.session, "list_downloads", map[string]any{"pageSize": 1, "current": 2}, false)
	if first["total"] != float64(2) || first["hasMore"] != true || second["hasMore"] != false {
		t.Fatalf("wrong pagination: %+v %+v", first, second)
	}
	job := callProtocol(t, f.session, "discover_media", map[string]any{"url": "https://example.com/watch", "waitSeconds": 0}, false)
	callProtocol(t, f.session, "get_media_discovery", map[string]any{"id": job["id"]}, false)
	cancelled := callProtocol(t, f.session, "cancel_media_discovery", map[string]any{"id": job["id"]}, false)
	if cancelled["status"] != "cancelled" {
		t.Fatalf("cancelled job=%+v", cancelled)
	}
	callProtocol(t, f.session, "discover_media", map[string]any{"url": "https://example.com/master.m3u8", "mode": "inspect"}, false)
}
