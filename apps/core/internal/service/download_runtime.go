package service

import (
	"errors"
	"slices"
	"strings"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
)

const RuntimeHeaderTTL = 10 * time.Minute
const MaxRuntimeHeaderTasks = 1024

var (
	ErrRuntimeHeadersExpired    = errors.New("task credentials expired or were cleared on restart; rediscover the source or supply fresh headers")
	ErrDownloadQueueUnavailable = errors.New("download queue unavailable")
	ErrDownloadURLChanged       = errors.New("download URL changed; read the task again before supplying credentials")
)

type runtimeHeaderEntry struct {
	url       string
	headers   []string
	expiresAt time.Time
	timer     *time.Timer
}

// HasPrivateHeaders uses an allowlist so custom API key headers stay ephemeral too.
func HasPrivateHeaders(headers []string) bool {
	for _, header := range headers {
		name, _, ok := strings.Cut(header, ":")
		if ok && sensitiveDiscoveryHeader(name) {
			return true
		}
	}
	return false
}

func (s *DownloadTaskService) rememberRuntimeHeaders(id int64, url string, headers []string) {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	if s.runtimeHeaders == nil {
		s.runtimeHeaders = make(map[int64]runtimeHeaderEntry)
	}
	_, replacing := s.runtimeHeaders[id]
	if previous, ok := s.runtimeHeaders[id]; ok {
		previous.timer.Stop()
	}
	if !replacing && len(s.runtimeHeaders) >= MaxRuntimeHeaderTasks {
		var oldestID int64
		var oldest time.Time
		for key, entry := range s.runtimeHeaders {
			if oldest.IsZero() || entry.expiresAt.Before(oldest) {
				oldestID, oldest = key, entry.expiresAt
			}
		}
		s.runtimeHeaders[oldestID].timer.Stop()
		delete(s.runtimeHeaders, oldestID)
	}
	expiresAt := time.Now().UTC().Add(RuntimeHeaderTTL)
	entry := runtimeHeaderEntry{url: url, headers: slices.Clone(headers), expiresAt: expiresAt}
	entry.timer = time.AfterFunc(RuntimeHeaderTTL, func() {
		s.runtimeMu.Lock()
		defer s.runtimeMu.Unlock()
		if current, ok := s.runtimeHeaders[id]; ok && current.expiresAt.Equal(expiresAt) {
			delete(s.runtimeHeaders, id)
		}
	})
	s.runtimeHeaders[id] = entry
}

func (s *DownloadTaskService) forgetRuntimeHeaders(id int64) {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	if entry, ok := s.runtimeHeaders[id]; ok {
		entry.timer.Stop()
		delete(s.runtimeHeaders, id)
	}
}

// SetRuntimeHeaders only refreshes credentials if their source URL still matches.
func (s *DownloadTaskService) SetRuntimeHeaders(id int64, expectedURL string, headers []string) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	video, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return err
	}
	if video.URL != expectedURL {
		return ErrDownloadURLChanged
	}
	return s.setRuntimeHeaders(video, headers)
}

// setRuntimeHeaders requires taskMu to be held and updates the supplied snapshot.
func (s *DownloadTaskService) setRuntimeHeaders(video *db.Video, headers []string) error {
	required, _, _ := s.AuthenticationStatus(video)
	if required && !HasPrivateHeaders(headers) {
		return ErrRuntimeHeadersExpired
	}
	safe := PersistentDiscoveryHeaders(headers)
	if _, err := s.repo.Update(video.ID, map[string]any{"headers": safe, "requiresRuntimeHeaders": HasPrivateHeaders(headers)}); err != nil {
		return err
	}
	video.Headers, video.RequiresRuntimeHeaders = safe, HasPrivateHeaders(headers)
	s.rememberRuntimeHeaders(video.ID, video.URL, headers)
	return nil
}

func (s *DownloadTaskService) runtimeHeadersFor(id int64, url string) ([]string, time.Time, bool) {
	s.runtimeMu.Lock()
	defer s.runtimeMu.Unlock()
	entry, ok := s.runtimeHeaders[id]
	if !ok {
		return nil, time.Time{}, false
	}
	if entry.url != url {
		return nil, time.Time{}, false
	}
	if !time.Now().Before(entry.expiresAt) {
		entry.timer.Stop()
		delete(s.runtimeHeaders, id)
		return nil, time.Time{}, false
	}
	return slices.Clone(entry.headers), entry.expiresAt, true
}

type DownloadAuthentication struct {
	Required  bool
	Available bool
	ExpiresAt *time.Time
}

// captureRuntime is called while taskMu protects the persisted task snapshot.
func (s *DownloadTaskService) captureRuntime(record *DownloadTaskWithFile) {
	record.Runtime, _ = s.RuntimeTask(record.ID)
	record.Authentication.Required, record.Authentication.Available, record.Authentication.ExpiresAt = s.AuthenticationStatus(record.Video)
}

func (s *DownloadTaskService) AuthenticationStatus(video *db.Video) (required, available bool, expiresAt *time.Time) {
	_, expiration, cached := s.runtimeHeadersFor(video.ID, video.URL)
	required = video.RequiresRuntimeHeaders
	if video.Headers != nil && HasPrivateHeaders(ParseStoredHeaders(*video.Headers)) {
		required = true
	}
	available = !video.RequiresRuntimeHeaders || cached
	if cached && required {
		expiresAt = &expiration
	}
	return
}

func (s *DownloadTaskService) RuntimeTask(id int64) (*core.TaskInfo, bool) {
	if s.queue == nil {
		return nil, false
	}
	return s.queue.GetTask(queueTaskIDForDownload(id))
}

func (s *DownloadTaskService) QueueAvailable() bool { return s.queue != nil }

func (s *DownloadTaskService) IsScheduled(id int64) bool {
	return s.queue != nil && s.queue.IsScheduled(queueTaskIDForDownload(id))
}
