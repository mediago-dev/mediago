package discovery

import (
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"
)

type StoreOptions struct {
	Capacity  int
	Retention time.Duration
	Now       func() time.Time
	NewID     func() string
}

type storedJob struct {
	public    DiscoveryJob
	execution ExecutionKind
}

type Store struct {
	mu             sync.Mutex
	jobs           map[string]*storedJob
	privateHeaders map[string]map[string][]string
	queue          []string
	activeID       string
	capacity       int
	retention      time.Duration
	now            func() time.Time
	newID          func() string
}

func NewStore(options StoreOptions) *Store {
	capacity := options.Capacity
	if capacity <= 0 {
		capacity = DefaultCapacity
	}
	retention := options.Retention
	if retention <= 0 {
		retention = DefaultRetention
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	newID := options.NewID
	if newID == nil {
		newID = uuid.NewString
	}
	return &Store{
		jobs:           make(map[string]*storedJob),
		privateHeaders: make(map[string]map[string][]string),
		capacity:       capacity,
		retention:      retention,
		now:            now,
		newID:          newID,
	}
}

func (s *Store) Create(input CreateDiscoveryInput, execution ExecutionKind) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked()

	if execution == ExecutionBrowser && s.browserWorkCountLocked() >= s.capacity {
		return DiscoveryJob{}, ErrQueueFull
	}
	now := s.now().UTC()
	job := DiscoveryJob{
		ID:        s.newID(),
		Input:     input,
		Status:    StatusPending,
		Sources:   []DiscoverySource{},
		CreatedAt: now,
		ExpiresAt: now.Add(time.Duration(input.TimeoutMS)*time.Millisecond + s.retention),
	}
	s.jobs[job.ID] = &storedJob{public: job, execution: execution}
	if execution == ExecutionBrowser {
		s.queue = append(s.queue, job.ID)
	}
	return cloneJob(job), nil
}

func (s *Store) Get(id string) (DiscoveryJob, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, false
	}
	return cloneJob(stored.public), true
}

func (s *Store) ClaimNext() (DiscoveryJob, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked()
	if s.activeID != "" {
		return DiscoveryJob{}, false
	}
	for len(s.queue) > 0 {
		id := s.queue[0]
		s.queue = s.queue[1:]
		stored, ok := s.jobs[id]
		if !ok || stored.public.Status != StatusPending {
			continue
		}
		s.activeID = id
		return cloneJob(stored.public), true
	}
	return DiscoveryJob{}, false
}

func (s *Store) Start(id string) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	if stored.public.Status != StatusPending {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusRunning)
	}
	if stored.execution == ExecutionBrowser && s.activeID != id {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusRunning)
	}
	now := s.now().UTC()
	stored.public.Status = StatusRunning
	stored.public.StartedAt = &now
	return cloneJob(stored.public), nil
}

func (s *Store) RequeueActive(id string) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	if stored.execution != ExecutionBrowser || stored.public.Status != StatusPending || s.activeID != id {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusPending)
	}
	s.activeID = ""
	s.removeQueuedLocked(id)
	s.queue = append([]string{id}, s.queue...)
	return cloneJob(stored.public), nil
}

func (s *Store) Complete(id string, sources []PrivateSource, partial bool) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	if stored.public.Status != StatusRunning {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusCompleted)
	}
	now := s.now().UTC()
	stored.public.Status = StatusCompleted
	stored.public.Sources = publicSources(sources)
	stored.public.Partial = partial
	stored.public.ErrorCode = ""
	stored.public.Error = ""
	stored.public.CompletedAt = &now
	stored.public.ExpiresAt = now.Add(s.retention)
	s.storePrivateHeadersLocked(id, sources)
	s.releaseActiveLocked(id)
	return cloneJob(stored.public), nil
}

func (s *Store) Fail(id, code, message string, sources []PrivateSource, partial bool) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	if stored.public.Status != StatusPending && stored.public.Status != StatusRunning {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusFailed)
	}
	now := s.now().UTC()
	stored.public.Status = StatusFailed
	stored.public.Sources = publicSources(sources)
	stored.public.Partial = partial
	stored.public.ErrorCode = code
	stored.public.Error = message
	stored.public.CompletedAt = &now
	stored.public.ExpiresAt = now.Add(s.retention)
	s.storePrivateHeadersLocked(id, sources)
	s.removeQueuedLocked(id)
	s.releaseActiveLocked(id)
	return cloneJob(stored.public), nil
}

func (s *Store) Cancel(id string) (DiscoveryJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, ErrNotFound
	}
	if stored.public.Status != StatusPending && stored.public.Status != StatusRunning {
		return DiscoveryJob{}, transitionError(id, stored.public.Status, StatusCancelled)
	}
	now := s.now().UTC()
	stored.public.Status = StatusCancelled
	stored.public.ErrorCode = "discovery_cancelled"
	stored.public.Error = "discovery cancelled"
	stored.public.CompletedAt = &now
	stored.public.ExpiresAt = now.Add(s.retention)
	s.removeQueuedLocked(id)
	s.releaseActiveLocked(id)
	return cloneJob(stored.public), nil
}

func (s *Store) PrivateHeaders(jobID, sourceID string) ([]string, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked()
	bySource, ok := s.privateHeaders[jobID]
	if !ok {
		return nil, false
	}
	headers, ok := bySource[sourceID]
	if !ok {
		return nil, false
	}
	return slices.Clone(headers), true
}

// downloadSnapshot prevents expiry between reading public sources and their
// private credentials. The snapshot never crosses a public transport boundary.
func (s *Store) downloadSnapshot(id string) (DiscoveryJob, map[string][]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cleanupExpiredLocked()
	stored, ok := s.jobs[id]
	if !ok {
		return DiscoveryJob{}, nil, ErrNotFound
	}
	headers := make(map[string][]string, len(s.privateHeaders[id]))
	for sourceID, values := range s.privateHeaders[id] {
		headers[sourceID] = slices.Clone(values)
	}
	return cloneJob(stored.public), headers, nil
}

func (s *Store) IsActive(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeID == id
}

func (s *Store) ActiveID() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.activeID
}

func (s *Store) QueuedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.queue)
}

func (s *Store) Now() time.Time {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.now().UTC()
}

func (s *Store) CleanupExpired() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cleanupExpiredLocked()
}

func (s *Store) Clear() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = make(map[string]*storedJob)
	s.privateHeaders = make(map[string]map[string][]string)
	s.queue = nil
	s.activeID = ""
}

func (s *Store) browserWorkCountLocked() int {
	count := len(s.queue)
	if s.activeID != "" {
		count++
	}
	return count
}

func (s *Store) cleanupExpiredLocked() int {
	now := s.now().UTC()
	removed := 0
	for id, stored := range s.jobs {
		if !terminal(stored.public.Status) || now.Before(stored.public.ExpiresAt) {
			continue
		}
		delete(s.jobs, id)
		delete(s.privateHeaders, id)
		s.removeQueuedLocked(id)
		s.releaseActiveLocked(id)
		removed++
	}
	return removed
}

func (s *Store) storePrivateHeadersLocked(jobID string, sources []PrivateSource) {
	delete(s.privateHeaders, jobID)
	for _, source := range sources {
		if len(source.Headers) == 0 {
			continue
		}
		if s.privateHeaders[jobID] == nil {
			s.privateHeaders[jobID] = make(map[string][]string)
		}
		s.privateHeaders[jobID][source.ID] = slices.Clone(source.Headers)
	}
}

func (s *Store) removeQueuedLocked(id string) {
	s.queue = slices.DeleteFunc(s.queue, func(queuedID string) bool {
		return queuedID == id
	})
}

func (s *Store) releaseActiveLocked(id string) {
	if s.activeID == id {
		s.activeID = ""
	}
}

func terminal(status DiscoveryStatus) bool {
	return status == StatusCompleted || status == StatusFailed || status == StatusCancelled
}

func transitionError(id string, from, to DiscoveryStatus) error {
	return fmt.Errorf("%w: %s cannot move from %s to %s", ErrInvalidTransition, id, from, to)
}

func publicSources(sources []PrivateSource) []DiscoverySource {
	public := make([]DiscoverySource, 0, len(sources))
	for _, source := range sources {
		public = append(public, cloneSource(source.DiscoverySource))
	}
	return public
}

func cloneJob(job DiscoveryJob) DiscoveryJob {
	sources := job.Sources
	job.Sources = make([]DiscoverySource, len(sources))
	for index, source := range sources {
		job.Sources[index] = cloneSource(source)
	}
	if job.StartedAt != nil {
		startedAt := *job.StartedAt
		job.StartedAt = &startedAt
	}
	if job.CompletedAt != nil {
		completedAt := *job.CompletedAt
		job.CompletedAt = &completedAt
	}
	return job
}

func cloneSource(source DiscoverySource) DiscoverySource {
	source.Variants = slices.Clone(source.Variants)
	return source
}
