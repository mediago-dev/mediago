package server

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

type downloadIdentityConfigStore struct {
	values map[string]any
}

func (s *downloadIdentityConfigStore) Get(key string) any { return s.values[key] }

func (s *downloadIdentityConfigStore) Set(key string, value any) error {
	s.values[key] = value
	return nil
}

func (s *downloadIdentityConfigStore) Update(values map[string]any) error {
	for key, value := range values {
		s.values[key] = value
	}
	return nil
}

func (s *downloadIdentityConfigStore) Store() any { return s.values }

type controlledIdentityDownloader struct {
	started     chan core.DownloadParams
	release     chan struct{}
	finished    chan struct{}
	result      error
	didStart    atomic.Bool
	releaseOnce sync.Once
}

func newControlledIdentityDownloader(result error) *controlledIdentityDownloader {
	return &controlledIdentityDownloader{
		started:  make(chan core.DownloadParams, 1),
		release:  make(chan struct{}),
		finished: make(chan struct{}),
		result:   result,
	}
}

func (d *controlledIdentityDownloader) Download(ctx context.Context, params core.DownloadParams, _ core.Callbacks) error {
	d.didStart.Store(true)
	defer close(d.finished)

	select {
	case d.started <- params:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case <-d.release:
		return d.result
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (*controlledIdentityDownloader) Config() interface{} { return nil }

func (d *controlledIdentityDownloader) Release() {
	d.releaseOnce.Do(func() { close(d.release) })
}

func TestCreateDownloadPreservesIdentityAcrossQueueAndSSE(t *testing.T) {
	previousLogger, previousSugar := logger.Logger, logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	tests := []struct {
		name          string
		result        error
		terminalEvent string
	}{
		{
			name:          "success",
			terminalEvent: "download-success",
		},
		{
			name: "dependency failure",
			result: fmt.Errorf("download command failed: %w", &core.DependencyError{
				Tool:         "BBDown",
				ExpectedPath: "/private/runtime/BBDown",
				Err:          errors.New("permission denied"),
			}),
			terminalEvent: "download-failed",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			database, err := db.New(filepath.Join(t.TempDir(), "downloads.db"))
			if err != nil {
				t.Fatalf("db.New() error = %v", err)
			}
			downloader := newControlledIdentityDownloader(tt.result)
			var (
				queue  *core.TaskQueue
				srv    *Server
				events chan sse.Event
			)
			t.Cleanup(func() {
				downloader.Release()
				waitForIdentityDownloader(t, downloader)
				if queue != nil {
					waitForIdentityQueueCompletion(t, queue)
				}
				if srv != nil && events != nil {
					srv.hub.Unsubscribe(events)
				}
				if err := database.Close(); err != nil {
					t.Errorf("database.Close() error = %v", err)
				}
			})

			queue = core.NewTaskQueue(downloader, 1)
			config := &downloadIdentityConfigStore{values: map[string]any{
				"language":       "en",
				"local":          t.TempDir(),
				"deleteSegments": false,
			}}
			srv = New(queue, nil, database, config)
			events = srv.hub.Subscribe()

			body := []byte(`{"tasks":[{"type":"bilibili","name":"identity-contract","url":"https://www.bilibili.com/video/BV1xx411c7mD"}],"startDownload":true}`)
			request := httptest.NewRequest(http.MethodPost, "/api/downloads", bytes.NewReader(body))
			request.Header.Set("Content-Type", "application/json")
			response := httptest.NewRecorder()
			srv.Engine().ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("POST /api/downloads status = %d, body = %s", response.Code, response.Body.String())
			}
			responseID := decodeCreatedDownloadID(t, response.Body.String())

			var params core.DownloadParams
			select {
			case params = <-downloader.started:
			case <-time.After(2 * time.Second):
				t.Fatal("timed out waiting for downloader to start")
			}
			wantID := strconv.FormatInt(responseID, 10)
			if got := string(params.ID); got != wantID {
				t.Fatalf("DownloadParams.ID = %q, want persisted response ID %q", got, wantID)
			}

			start := receiveIdentityEvent(t, events, "download-start")
			assertIdentityEventID(t, start, wantID)
			downloader.Release()

			terminal := receiveIdentityEvent(t, events, tt.terminalEvent)
			assertIdentityEventID(t, terminal, wantID)
			if tt.terminalEvent == "download-failed" {
				assertDependencyFailureEvent(t, terminal)
			}
		})
	}
}

func decodeCreatedDownloadID(t *testing.T, body string) int64 {
	t.Helper()
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.UseNumber()
	var response dto.SuccessResponse
	if err := decoder.Decode(&response); err != nil {
		t.Fatalf("decode POST /api/downloads response: %v", err)
	}
	data, ok := response.Data.([]any)
	if !ok || len(data) != 1 {
		t.Fatalf("SuccessResponse.Data = %#v, want one download", response.Data)
	}
	record, ok := data[0].(map[string]any)
	if !ok {
		t.Fatalf("SuccessResponse.Data[0] = %#v, want JSON object", data[0])
	}
	number, ok := record["id"].(json.Number)
	if !ok {
		t.Fatalf("SuccessResponse.Data[0].id = %#v, want JSON number", record["id"])
	}
	id, err := number.Int64()
	if err != nil || id <= 0 {
		t.Fatalf("SuccessResponse.Data[0].id = %q, want positive int64", number)
	}
	return id
}

func receiveIdentityEvent(t *testing.T, events <-chan sse.Event, name string) sse.Event {
	t.Helper()
	timeout := time.After(2 * time.Second)
	for {
		select {
		case event, ok := <-events:
			if !ok {
				t.Fatalf("SSE subscription closed while waiting for %q", name)
			}
			if event.Name == name {
				return event
			}
		case <-timeout:
			t.Fatalf("timed out waiting for SSE event %q", name)
		}
	}
}

func decodeIdentityEvent(t *testing.T, event sse.Event) (map[string]any, string) {
	t.Helper()
	raw := event.JSON()
	decoder := json.NewDecoder(strings.NewReader(raw))
	decoder.UseNumber()
	var payload map[string]any
	if err := decoder.Decode(&payload); err != nil {
		t.Fatalf("decode %q event JSON %q: %v", event.Name, raw, err)
	}
	return payload, raw
}

func assertIdentityEventID(t *testing.T, event sse.Event, wantID string) {
	t.Helper()
	payload, _ := decodeIdentityEvent(t, event)
	if got, ok := payload["id"].(string); !ok || got != wantID {
		t.Fatalf("%s payload id = %#v, want decimal string %q", event.Name, payload["id"], wantID)
	}
}

func assertDependencyFailureEvent(t *testing.T, event sse.Event) {
	t.Helper()
	payload, raw := decodeIdentityEvent(t, event)
	if got := payload["errorCode"]; got != "dependency_missing" {
		t.Fatalf("download-failed errorCode = %#v, want dependency_missing", got)
	}
	if got := payload["dependency"]; got != "BBDown" {
		t.Fatalf("download-failed dependency = %#v, want BBDown", got)
	}
	if got := payload["error"]; got != "Required dependency BBDown is missing" {
		t.Fatalf("download-failed error = %#v, want stable public message", got)
	}
	if strings.Contains(raw, "/private/runtime/BBDown") || strings.Contains(raw, "permission denied") {
		t.Fatalf("download-failed payload leaks private dependency details: %s", raw)
	}
}

func waitForIdentityDownloader(t *testing.T, downloader *controlledIdentityDownloader) {
	t.Helper()
	if !downloader.didStart.Load() {
		return
	}
	select {
	case <-downloader.finished:
	case <-time.After(2 * time.Second):
		t.Errorf("timed out waiting for controlled downloader to finish")
	}
}

func waitForIdentityQueueCompletion(t *testing.T, queue *core.TaskQueue) {
	t.Helper()
	timer := time.NewTimer(2 * time.Second)
	defer timer.Stop()
	ticker := time.NewTicker(time.Millisecond)
	defer ticker.Stop()
	for queue.IsFull() {
		select {
		case <-ticker.C:
		case <-timer.C:
			t.Errorf("timed out waiting for download queue completion")
			return
		}
	}
}
