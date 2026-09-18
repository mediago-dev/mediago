package discovery

import (
	"context"
	"fmt"
	"net/url"
	"path"
	"strings"
	"sync"
	"time"

	coreservice "caorushizi.cn/mediago/internal/service"
)

type SourceInspector interface {
	Inspect(context.Context, coreservice.InspectSourceInput) coreservice.SourceInspection
}

type BrowserExecutor interface {
	Available() bool
	Dispatch(context.Context, DiscoveryJob) error
	Cancel(context.Context, string) error
}

type Service struct {
	store           *Store
	inspector       SourceInspector
	executor        BrowserExecutor
	timerMu         sync.Mutex
	timers          map[string]*time.Timer
	timeoutDuration func(DiscoveryJob) time.Duration
	closed          bool
}

func NewService(store *Store, inspector SourceInspector, executor BrowserExecutor) *Service {
	if store == nil {
		store = NewStore(StoreOptions{})
	}
	return &Service{
		store:     store,
		inspector: inspector,
		executor:  executor,
		timers:    make(map[string]*time.Timer),
		timeoutDuration: func(job DiscoveryJob) time.Duration {
			return time.Duration(job.Input.TimeoutMS) * time.Millisecond
		},
	}
}

func (s *Service) Create(ctx context.Context, input CreateDiscoveryInput) (DiscoveryJob, error) {
	normalized, parsedURL, execution, err := normalizeInput(input)
	if err != nil {
		return DiscoveryJob{}, err
	}
	if execution == ExecutionBrowser {
		if s.executor == nil || !s.executor.Available() {
			return DiscoveryJob{}, ErrExecutorUnavailable
		}
		job, err := s.store.Create(normalized, execution)
		if err != nil {
			return DiscoveryJob{}, err
		}
		if err := s.dispatchNext(ctx); err != nil {
			// The job has already been stored with a safe failure code. Return
			// its identity so callers can inspect it without creating duplicates.
			return s.mustGet(job.ID), nil
		}
		return s.mustGet(job.ID), nil
	}

	if s.inspector == nil {
		return DiscoveryJob{}, ErrInspectorUnavailable
	}
	job, err := s.store.Create(normalized, execution)
	if err != nil {
		return DiscoveryJob{}, err
	}
	if _, err := s.store.Start(job.ID); err != nil {
		return DiscoveryJob{}, err
	}
	inspection := s.inspector.Inspect(ctx, coreservice.InspectSourceInput{
		ID:  job.ID + "-source-1",
		URL: normalized.URL,
	})
	if inspection.Error != "" {
		failed, failErr := s.store.Fail(
			job.ID,
			"discovery_inspection_failed",
			inspection.Error,
			nil,
			false,
		)
		return failed, failErr
	}
	source := mapInspection(normalized.URL, parsedURL, s.store.Now(), inspection)
	return s.store.Complete(job.ID, []PrivateSource{{DiscoverySource: source}}, false)
}

func (s *Service) Get(id string) (DiscoveryJob, error) {
	job, ok := s.store.Get(id)
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	return job, nil
}

func (s *Service) Start(id string) (DiscoveryJob, error) {
	return s.store.Start(id)
}

func (s *Service) MarkRunning(id string) (DiscoveryJob, error) {
	job, err := s.Start(id)
	if err != nil {
		return DiscoveryJob{}, err
	}
	s.scheduleTimeout(job)
	return job, nil
}

func (s *Service) Complete(ctx context.Context, id string, sources []PrivateSource, partial bool) (DiscoveryJob, error) {
	job, err := s.store.Complete(id, sources, partial)
	if err != nil {
		return DiscoveryJob{}, err
	}
	s.cancelTimeout(id)
	_ = s.dispatchNext(ctx)
	return job, nil
}

func (s *Service) Fail(ctx context.Context, id, code, message string, sources []PrivateSource, partial bool) (DiscoveryJob, error) {
	job, err := s.store.Fail(id, code, message, sources, partial)
	if err != nil {
		return DiscoveryJob{}, err
	}
	s.cancelTimeout(id)
	_ = s.dispatchNext(ctx)
	return job, nil
}

func (s *Service) Cancel(ctx context.Context, id string) (DiscoveryJob, error) {
	active := s.store.IsActive(id)
	job, err := s.store.Cancel(id)
	if err != nil {
		return DiscoveryJob{}, err
	}
	s.cancelTimeout(id)
	if active && s.executor != nil {
		_ = s.executor.Cancel(ctx, id)
	}
	_ = s.dispatchNext(ctx)
	return job, nil
}

func (s *Service) ExecutorStatus() ExecutorStatus {
	available := s.executor != nil && s.executor.Available()
	return ExecutorStatus{
		Available:         available,
		ActiveDiscoveryID: s.store.ActiveID(),
		Queued:            s.store.QueuedCount(),
	}
}

func (s *Service) ExecutorAvailable() bool {
	return s.executor != nil && s.executor.Available()
}

func (s *Service) DispatchPending(ctx context.Context) error {
	return s.dispatchNext(ctx)
}

func (s *Service) HandleExecutorDisconnect(id string) {
	if id == "" {
		return
	}
	job, err := s.Get(id)
	if err != nil || terminal(job.Status) {
		return
	}
	if job.Status == StatusPending {
		_, _ = s.store.RequeueActive(id)
		return
	}
	if job.Status == StatusRunning {
		s.cancelTimeout(id)
		_, _ = s.store.Fail(
			id,
			"discovery_executor_disconnected",
			"browser discovery executor disconnected",
			nil,
			false,
		)
	}
}

func (s *Service) Close() {
	s.timerMu.Lock()
	s.closed = true
	for id, timer := range s.timers {
		timer.Stop()
		delete(s.timers, id)
	}
	s.timerMu.Unlock()
	s.store.Clear()
}

func (s *Service) scheduleTimeout(job DiscoveryJob) {
	duration := s.timeoutDuration(job)
	timer := time.AfterFunc(duration, func() {
		s.timerMu.Lock()
		if s.closed {
			s.timerMu.Unlock()
			return
		}
		delete(s.timers, job.ID)
		s.timerMu.Unlock()
		if _, err := s.store.Fail(
			job.ID,
			"discovery_timeout",
			"browser discovery timed out",
			nil,
			false,
		); err != nil {
			return
		}
		if s.executor != nil {
			_ = s.executor.Cancel(context.Background(), job.ID)
		}
		_ = s.dispatchNext(context.Background())
	})
	s.timerMu.Lock()
	if s.closed {
		timer.Stop()
		s.timerMu.Unlock()
		return
	}
	if previous := s.timers[job.ID]; previous != nil {
		previous.Stop()
	}
	s.timers[job.ID] = timer
	s.timerMu.Unlock()
}

func (s *Service) cancelTimeout(id string) {
	s.timerMu.Lock()
	defer s.timerMu.Unlock()
	if timer := s.timers[id]; timer != nil {
		timer.Stop()
		delete(s.timers, id)
	}
}

func (s *Service) PrivateHeaders(jobID, sourceID string) ([]string, bool) {
	return s.store.PrivateHeaders(jobID, sourceID)
}

func (s *Service) InspectorAvailable() bool { return s.inspector != nil }

// DownloadSnapshot is a Core-only handoff; private headers must never be serialized.
func (s *Service) DownloadSnapshot(id string) (DiscoveryJob, map[string][]string, error) {
	return s.store.downloadSnapshot(id)
}

func (s *Service) dispatchNext(ctx context.Context) error {
	if s.executor == nil || !s.executor.Available() {
		return ErrExecutorUnavailable
	}
	job, ok := s.store.ClaimNext()
	if !ok {
		return nil
	}
	if err := s.executor.Dispatch(ctx, job); err != nil {
		safeErr := fmt.Errorf("%w: executor dispatch failed", ErrExecutorUnavailable)
		_, _ = s.store.Fail(job.ID, ErrorCode(safeErr), safeErr.Error(), nil, false)
		return safeErr
	}
	return nil
}

func (s *Service) mustGet(id string) DiscoveryJob {
	job, _ := s.store.Get(id)
	return job
}

func normalizeInput(input CreateDiscoveryInput) (CreateDiscoveryInput, *url.URL, ExecutionKind, error) {
	input.URL = strings.TrimSpace(input.URL)
	parsedURL, err := url.Parse(input.URL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") || parsedURL.Host == "" {
		return CreateDiscoveryInput{}, nil, "", ErrInvalidURL
	}
	if input.Mode == "" {
		input.Mode = ModeAuto
	}
	if input.Mode != ModeAuto && input.Mode != ModeBrowser && input.Mode != ModeInspect {
		return CreateDiscoveryInput{}, nil, "", ErrInvalidMode
	}
	if input.TimeoutMS == 0 {
		input.TimeoutMS = DefaultTimeoutMS
	} else {
		input.TimeoutMS = min(max(input.TimeoutMS, MinTimeoutMS), MaxTimeoutMS)
	}

	isHLS := strings.HasSuffix(strings.ToLower(parsedURL.Path), ".m3u8")
	if input.Mode == ModeInspect || (input.Mode == ModeAuto && isHLS) {
		return input, parsedURL, ExecutionInspect, nil
	}
	return input, parsedURL, ExecutionBrowser, nil
}

func mapInspection(rawURL string, parsedURL *url.URL, detectedAt time.Time, inspection coreservice.SourceInspection) DiscoverySource {
	title := path.Base(parsedURL.Path)
	if title == "." || title == "/" || title == "" {
		title = parsedURL.Hostname()
	}
	variants := make([]HLSVariant, 0, len(inspection.Variants))
	for _, variant := range inspection.Variants {
		variants = append(variants, HLSVariant{
			URL:       variant.URL,
			Quality:   variant.Quality,
			Width:     variant.Width,
			Height:    variant.Height,
			Bandwidth: variant.Bandwidth,
			Codecs:    variant.Codecs,
		})
	}
	playlistType := PlaylistType(inspection.PlaylistType)
	if playlistType != PlaylistTypeMaster && playlistType != PlaylistTypeMedia {
		playlistType = PlaylistTypeUnknown
	}
	return DiscoverySource{
		ID:           inspection.ID,
		URL:          rawURL,
		PageURL:      rawURL,
		Title:        title,
		Type:         SourceTypeM3U8,
		PlaylistType: playlistType,
		MaxQuality:   inspection.MaxQuality,
		Variants:     variants,
		DetectedAt:   detectedAt,
	}
}
