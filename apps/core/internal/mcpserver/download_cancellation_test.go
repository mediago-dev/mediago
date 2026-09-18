package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/discovery"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestMCPCancelledCreationDoesNotPersistOrStart(t *testing.T) {
	for _, deadline := range []bool{false, true} {
		name := "cancel"
		if deadline {
			name = "deadline"
		}
		t.Run(name, func(t *testing.T) {
			d := &recoveryFileDownloader{path: filepath.Join(t.TempDir(), "out.mp4"), calls: make(chan struct{}, 2)}
			f := newProtocolFixture(t, true, d)
			entered, titleStopped, release := make(chan struct{}), make(chan struct{}), make(chan struct{})
			previous := http.DefaultTransport
			http.DefaultTransport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
				defer close(titleStopped)
				close(entered)
				select {
				case <-req.Context().Done():
					return nil, req.Context().Err()
				case <-release:
					return &http.Response{StatusCode: http.StatusOK, Header: make(http.Header), Body: io.NopCloser(strings.NewReader("<title>cancelled title</title>")), Request: req}, nil
				}
			})
			var requests sync.WaitGroup
			client := mcp.NewClient(&mcp.Implementation{Name: "cancellation-test", Version: "1"}, nil)
			session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
				Endpoint: "http://mediago.test/mcp",
				HTTPClient: &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
					request.Header.Set("Authorization", "Bearer secret")
					response := make(chan *http.Response, 1)
					requests.Add(1)
					go func() {
						defer requests.Done()
						recorder := httptest.NewRecorder()
						f.manager.Handler().ServeHTTP(recorder, request)
						response <- recorder.Result()
					}()
					// Match the real HTTP transport: cancellation can return while the
					// server is still unwinding a tool call.
					select {
					case result := <-response:
						return result, nil
					case <-request.Context().Done():
						return nil, request.Context().Err()
					}
				})},
				DisableStandaloneSSE: true,
			}, nil)
			t.Cleanup(func() {
				close(release)
				if session != nil {
					_ = session.Close()
				}
				requests.Wait()
				// Drain creation before restoring globals, including on a test failure.
				_, _ = f.downloads.AddDownloadTasks(nil)
				http.DefaultTransport = previous
			})
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithCancel(context.Background())
			if deadline {
				cancel()
				ctx, cancel = context.WithTimeout(context.Background(), 500*time.Millisecond)
			}
			defer cancel()
			type callResult struct {
				result *mcp.CallToolResult
				err    error
			}
			returned := make(chan callResult, 1)
			go func() {
				result, err := session.CallTool(ctx, &mcp.CallToolParams{Name: "create_download", Arguments: map[string]any{"url": "https://example.com/watch", "type": "bilibili"}})
				returned <- callResult{result, err}
			}()
			select {
			case <-entered:
			case <-time.After(time.Second):
				t.Fatal("title lookup did not start")
			}
			if !deadline {
				cancel()
			}
			select {
			case result := <-returned:
				if result.err != nil {
					if !errors.Is(result.err, ctx.Err()) {
						t.Fatalf("unexpected cancellation error: %v", result.err)
					}
				} else if result.result == nil || !result.result.IsError {
					t.Fatalf("cancelled call succeeded: %+v", result.result)
				}
			case <-time.After(2 * time.Second):
				t.Fatal("MCP call did not finish after cancellation")
			}
			select {
			case <-titleStopped:
			case <-time.After(time.Second):
				t.Fatal("title lookup ignored cancellation")
			}
			// The creation mutex makes this a barrier after the cancelled creator.
			if _, err := f.downloads.AddDownloadTasks(nil); err != nil {
				t.Fatal(err)
			}
			rows, err := f.repo.FindAll("ASC")
			if err != nil || len(rows) != 0 || len(d.calls) != 0 {
				t.Fatalf("cancelled creation had side effects: rows=%d, calls=%d, err=%v", len(rows), len(d.calls), err)
			}
		})
	}
}

func TestMCPBatchCancellationKeepsOnlyAlreadyCreatedItems(t *testing.T) {
	f := newProtocolFixture(t, true, nil)
	job, err := f.discoveries.Create(context.Background(), discovery.CreateDiscoveryInput{URL: "https://example.com/watch", Mode: discovery.ModeBrowser})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.discoveries.MarkRunning(job.ID); err != nil {
		t.Fatal(err)
	}
	_, err = f.discoveries.Complete(context.Background(), job.ID, []discovery.PrivateSource{
		{DiscoverySource: discovery.DiscoverySource{ID: "a", URL: "https://example.com/a.mp4", Title: "first", Type: discovery.SourceTypeDirect}},
		{DiscoverySource: discovery.DiscoverySource{ID: "b", URL: "https://example.com/watch", Type: discovery.SourceTypeBilibili}},
		{DiscoverySource: discovery.DiscoverySource{ID: "c", URL: "https://example.com/c.mp4", Title: "last", Type: discovery.SourceTypeDirect}},
	}, false)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	previous := http.DefaultTransport
	http.DefaultTransport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		cancel()
		return nil, context.Canceled
	})
	t.Cleanup(func() { http.DefaultTransport = previous })
	out, err := f.manager.downloadDiscoveredMedia(ctx, downloadDiscoveredMediaInput{ID: job.ID, SourceIDs: []string{"a", "b", "c"}, StartDownload: ptr(false)})
	if err != nil {
		t.Fatal(err)
	}
	if len(out.Items) != 3 || out.Items[0].Outcome != "created" || out.Items[0].DownloadID == 0 {
		t.Fatalf("completed item lost: %+v", out)
	}
	for _, item := range out.Items[1:] {
		if item.Outcome != "failed" || item.Error == nil || item.Error.Code != "request_cancelled" || item.DownloadID != 0 {
			t.Fatalf("cancelled item created: %+v", item)
		}
	}
	rows, err := f.repo.FindAll("ASC")
	if err != nil || len(rows) != 1 || rows[0].ID != out.Items[0].DownloadID {
		encoded, _ := json.Marshal(out)
		t.Fatalf("unexpected partial creation: rows=%d, err=%v, response=%s", len(rows), err, encoded)
	}
}

type cancelBeforeStartConfig struct {
	testDownloadConfig
	cancel context.CancelFunc
}

func (c cancelBeforeStartConfig) GetDeleteSegments() bool {
	c.cancel()
	return true
}

func TestMCPCancelAfterPersistenceLeavesReadyTaskWithID(t *testing.T) {
	d := &recoveryFileDownloader{path: filepath.Join(t.TempDir(), "out.mp4"), calls: make(chan struct{}, 2)}
	f := newProtocolFixture(t, true, d)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	// Resolving start options is the boundary between persistence and enqueue.
	f.manager.config = cancelBeforeStartConfig{testDownloadConfig: testDownloadConfig{localDir: f.manager.config.GetLocalDir(), desktop: true}, cancel: cancel}
	_, err := f.manager.createDownload(ctx, createDownloadInput{URL: "https://example.com/video", Name: "video", StartDownload: ptr(true)})
	var failure *toolError
	if !errors.As(err, &failure) || failure.Code != "request_cancelled" || failure.DownloadID == 0 {
		t.Fatalf("cancelled creation lost persisted ID: %v", err)
	}
	record, err := f.repo.FindByIDOrFail(failure.DownloadID)
	if err != nil || record.Status != "ready" || f.queue.IsScheduled(core.TaskID(strconv.FormatInt(record.ID, 10))) || len(d.calls) != 0 {
		t.Fatalf("cancelled task was queued: %+v, %v", record, err)
	}
}
