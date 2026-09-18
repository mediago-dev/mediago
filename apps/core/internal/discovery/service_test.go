package discovery

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	coreservice "caorushizi.cn/mediago/internal/service"
)

type fakeExecutor struct {
	available   bool
	dispatched  []string
	cancelled   []string
	dispatchErr error
}

type fakeInspector struct {
	calls  int
	result coreservice.SourceInspection
}

func (i *fakeInspector) Inspect(_ context.Context, input coreservice.InspectSourceInput) coreservice.SourceInspection {
	i.calls++
	result := i.result
	result.ID = input.ID
	result.URL = input.URL
	return result
}

func (e *fakeExecutor) Available() bool { return e.available }

func (e *fakeExecutor) Dispatch(_ context.Context, job DiscoveryJob) error {
	e.dispatched = append(e.dispatched, job.ID)
	return e.dispatchErr
}

func (e *fakeExecutor) Cancel(_ context.Context, id string) error {
	e.cancelled = append(e.cancelled, id)
	return nil
}

func TestServiceReturnsJobIdentityWhenExecutorDispatchFails(t *testing.T) {
	executor := &fakeExecutor{available: true, dispatchErr: errors.New("private executor details")}
	svc := NewService(nil, nil, executor)
	t.Cleanup(svc.Close)
	job, err := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/watch", Mode: ModeBrowser})
	if err != nil || job.ID == "" || job.Status != StatusFailed || job.ErrorCode != "discovery_executor_unavailable" {
		t.Fatalf("dispatch failure lost its job: %+v, %v", job, err)
	}
	if _, err := svc.Get(job.ID); err != nil {
		t.Fatal(err)
	}
}

func TestServiceRoutesDirectHLSIntoExistingInspector(t *testing.T) {
	manifest := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1280x720\n720.m3u8\n"))
	}))
	defer manifest.Close()

	now := time.Date(2026, 8, 26, 12, 0, 0, 0, time.UTC)
	store := NewStore(StoreOptions{
		Capacity: 20,
		Now: func() time.Time {
			now = now.Add(time.Millisecond)
			return now
		},
		NewID: func() string { return "inspect-job" },
	})
	inspector := coreservice.NewM3U8Inspector(inspectorTestConfig{})
	svc := NewService(store, inspector, nil)

	job, err := svc.Create(context.Background(), CreateDiscoveryInput{
		URL:  manifest.URL + "/master.m3u8?token=public-result",
		Mode: ModeInspect,
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}
	if job.Status != StatusCompleted || len(job.Sources) != 1 {
		t.Fatalf("unexpected job: %+v", job)
	}
	if job.Sources[0].PlaylistType != PlaylistTypeMaster || job.Sources[0].MaxQuality != "720p" {
		t.Fatalf("unexpected source inspection: %+v", job.Sources[0])
	}
	if job.Input.Mode != ModeInspect || job.Input.TimeoutMS != DefaultTimeoutMS {
		t.Fatalf("input was not normalized: %+v", job.Input)
	}
}

func TestServiceInspectModeAcceptsSuffixlessHTTPURL(t *testing.T) {
	inspector := &fakeInspector{result: coreservice.SourceInspection{
		PlaylistType: "media",
		Variants:     []coreservice.HLSVariant{},
	}}
	svc := NewService(NewStore(StoreOptions{Capacity: 20}), inspector, nil)

	job, err := svc.Create(context.Background(), CreateDiscoveryInput{
		URL:  "https://cdn.example.com/signed/play?id=1",
		Mode: ModeInspect,
	})
	if err != nil {
		t.Fatal(err)
	}
	if inspector.calls != 1 || job.Status != StatusCompleted {
		t.Fatalf("inspector calls = %d, job = %+v", inspector.calls, job)
	}
}

func TestServiceRequiresExecutorForBrowserDiscoveryAndSerializesDispatch(t *testing.T) {
	store := NewStore(StoreOptions{Capacity: 20})
	executor := &fakeExecutor{}
	svc := NewService(store, nil, executor)

	_, err := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/watch"})
	if !errors.Is(err, ErrExecutorUnavailable) {
		t.Fatalf("Create() error = %v, want executor unavailable", err)
	}

	executor.available = true
	first, err := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/1"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/2"})
	if err != nil {
		t.Fatal(err)
	}
	if len(executor.dispatched) != 1 || executor.dispatched[0] != first.ID {
		t.Fatalf("dispatched = %v", executor.dispatched)
	}

	if _, err := svc.Start(first.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.Complete(context.Background(), first.ID, nil, false); err != nil {
		t.Fatal(err)
	}
	if len(executor.dispatched) != 2 || executor.dispatched[1] != second.ID {
		t.Fatalf("queued job was not dispatched: %v", executor.dispatched)
	}
}

func TestServiceAutoRoutesM3U8WithoutBrowserExecutor(t *testing.T) {
	inspector := &fakeInspector{result: coreservice.SourceInspection{
		PlaylistType: "media",
		Variants:     []coreservice.HLSVariant{},
	}}
	svc := NewService(NewStore(StoreOptions{Capacity: 20}), inspector, nil)

	job, err := svc.Create(context.Background(), CreateDiscoveryInput{
		URL: "https://cdn.example.com/VIDEO.M3U8?token=result-token",
	})
	if err != nil {
		t.Fatal(err)
	}
	if inspector.calls != 1 || job.Status != StatusCompleted {
		t.Fatalf("inspector calls = %d, job = %+v", inspector.calls, job)
	}
	if job.Input.Mode != ModeAuto || job.Sources[0].PlaylistType != PlaylistTypeMedia {
		t.Fatalf("unexpected auto discovery: %+v", job)
	}
}

func TestServiceValidatesModesAndTimeouts(t *testing.T) {
	executor := &fakeExecutor{available: true}
	svc := NewService(NewStore(StoreOptions{Capacity: 20}), nil, executor)

	tests := []struct {
		name  string
		input CreateDiscoveryInput
		want  error
	}{
		{name: "scheme", input: CreateDiscoveryInput{URL: "file:///tmp/video.m3u8"}, want: ErrInvalidURL},
		{name: "missing host", input: CreateDiscoveryInput{URL: "https:///video.m3u8"}, want: ErrInvalidURL},
		{name: "mode", input: CreateDiscoveryInput{URL: "https://example.com", Mode: "headless"}, want: ErrInvalidMode},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := svc.Create(context.Background(), test.input); !errors.Is(err, test.want) {
				t.Fatalf("Create() error = %v, want %v", err, test.want)
			}
		})
	}
}

func TestServiceClampsDiscoveryTimeout(t *testing.T) {
	tests := []struct {
		name      string
		timeoutMS int
		want      int
	}{
		{name: "minimum", timeoutMS: MinTimeoutMS - 1, want: MinTimeoutMS},
		{name: "maximum", timeoutMS: MaxTimeoutMS + 1, want: MaxTimeoutMS},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			executor := &fakeExecutor{available: true}
			svc := NewService(NewStore(StoreOptions{Capacity: 20}), nil, executor)
			job, err := svc.Create(context.Background(), CreateDiscoveryInput{
				URL:       "https://example.com/watch",
				TimeoutMS: test.timeoutMS,
			})
			if err != nil {
				t.Fatal(err)
			}
			if job.Input.TimeoutMS != test.want {
				t.Fatalf("timeoutMs = %d, want %d", job.Input.TimeoutMS, test.want)
			}
		})
	}
}

func TestServiceCancellationMovesToNextJob(t *testing.T) {
	executor := &fakeExecutor{available: true}
	svc := NewService(NewStore(StoreOptions{Capacity: 20}), nil, executor)
	first, _ := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/1"})
	second, _ := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/2"})

	cancelled, err := svc.Cancel(context.Background(), first.ID)
	if err != nil || cancelled.Status != StatusCancelled {
		t.Fatalf("Cancel() = %+v, %v", cancelled, err)
	}
	if len(executor.cancelled) != 1 || executor.cancelled[0] != first.ID {
		t.Fatalf("executor cancelled = %v", executor.cancelled)
	}
	if len(executor.dispatched) != 2 || executor.dispatched[1] != second.ID {
		t.Fatalf("next dispatch = %v", executor.dispatched)
	}
}

type inspectorTestConfig struct{}

func (inspectorTestConfig) Get(string) any { return nil }

type timeoutExecutor struct {
	cancelled chan string
}

func (*timeoutExecutor) Available() bool                              { return true }
func (*timeoutExecutor) Dispatch(context.Context, DiscoveryJob) error { return nil }
func (e *timeoutExecutor) Cancel(_ context.Context, id string) error {
	e.cancelled <- id
	return nil
}

func TestServiceEnforcesRunningBrowserTimeout(t *testing.T) {
	executor := &timeoutExecutor{cancelled: make(chan string, 1)}
	svc := NewService(NewStore(StoreOptions{Capacity: 20}), nil, executor)
	svc.timeoutDuration = func(DiscoveryJob) time.Duration { return 10 * time.Millisecond }
	job, err := svc.Create(context.Background(), CreateDiscoveryInput{URL: "https://example.com/watch"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MarkRunning(job.ID); err != nil {
		t.Fatal(err)
	}
	select {
	case cancelledID := <-executor.cancelled:
		if cancelledID != job.ID {
			t.Fatalf("cancelled ID = %q", cancelledID)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for timeout cancellation")
	}
	failed, err := svc.Get(job.ID)
	if err != nil || failed.Status != StatusFailed || failed.ErrorCode != "discovery_timeout" {
		t.Fatalf("timed out job = %+v, %v", failed, err)
	}
}
