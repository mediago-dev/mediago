package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/tasklog"
)

var ErrDownloadURLAlreadyExists = errors.New("download URL already exists")

// DownloadTaskService is the business logic layer for download tasks.
type DownloadTaskService struct {
	repo           *repo.VideoRepository
	queue          *core.TaskQueue
	logs           *tasklog.Manager
	createMu       sync.Mutex
	taskMu         sync.Mutex // coordinates persisted state, credentials and queue publication
	runtimeMu      sync.Mutex
	runtimeHeaders map[int64]runtimeHeaderEntry
}

// NewDownloadTaskService creates a DownloadTaskService.
func NewDownloadTaskService(repo *repo.VideoRepository, queue *core.TaskQueue, logs *tasklog.Manager) *DownloadTaskService {
	return &DownloadTaskService{repo: repo, queue: queue, logs: logs}
}

// AddDownloadTaskInput holds the input for adding a download task.
type AddDownloadTaskInput struct {
	DownloadDir    string   `json:"downloadDir,omitempty"`
	Name           string   `json:"name"`
	Type           string   `json:"type"`
	URL            string   `json:"url"`
	Headers        *string  `json:"headers"`
	Folder         *string  `json:"folder"`
	RuntimeHeaders []string `json:"-"`
}

// DownloadTaskWithFile is a download task augmented with file existence information.
type DownloadTaskWithFile struct {
	*db.Video
	Exists         bool                   `json:"exists"`
	File           string                 `json:"file,omitempty"`
	Files          []string               `json:"files,omitempty"`
	Runtime        *core.TaskInfo         `json:"-"`
	Authentication DownloadAuthentication `json:"-"`
}

// PaginatedResult holds the paginated result.
type PaginatedResult struct {
	Total int64                   `json:"total"`
	List  []*DownloadTaskWithFile `json:"list"`
}

// AddDownloadTask adds a single download task (with automatic title generation and name uniqueness check).
func (s *DownloadTaskService) AddDownloadTask(input *AddDownloadTaskInput) (*db.Video, error) {
	return s.AddDownloadTaskWithContext(context.Background(), input)
}

// AddDownloadTaskWithContext cancels title lookup and checks cancellation before
// publishing a persisted task. Existing callers can use AddDownloadTask.
func (s *DownloadTaskService) AddDownloadTaskWithContext(ctx context.Context, input *AddDownloadTaskInput) (*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	if strings.TrimSpace(input.Type) == "" {
		input.Type = string(core.InferDownloadType(input.URL))
	}

	existingURL, err := s.repo.FindByURL(input.URL)
	if err != nil {
		return nil, err
	}
	if existingURL != nil {
		return nil, ErrDownloadURLAlreadyExists
	}

	title, err := s.prepareDownloadTitle(ctx, input, nil)
	if err != nil {
		return nil, err
	}

	video := &db.Video{
		DownloadDir:            input.DownloadDir,
		Name:                   title,
		Type:                   input.Type,
		URL:                    input.URL,
		Headers:                input.Headers,
		Folder:                 input.Folder,
		RequiresRuntimeHeaders: HasPrivateHeaders(input.RuntimeHeaders),
	}

	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	created, err := s.repo.Create(video)
	if err == nil && len(input.RuntimeHeaders) > 0 {
		s.rememberRuntimeHeaders(created.ID, created.URL, input.RuntimeHeaders)
	}
	return created, err
}

// AddDownloadTasks adds multiple download tasks in bulk.
func (s *DownloadTaskService) AddDownloadTasks(inputs []*AddDownloadTaskInput) ([]*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()

	videos := make([]*db.Video, 0, len(inputs))
	seenURLs := make(map[string]struct{}, len(inputs))
	reservedTitles := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
		if strings.TrimSpace(input.Type) == "" {
			input.Type = string(core.InferDownloadType(input.URL))
		}
		if _, exists := seenURLs[input.URL]; exists {
			return nil, ErrDownloadURLAlreadyExists
		}
		existingURL, err := s.repo.FindByURL(input.URL)
		if err != nil {
			return nil, err
		}
		if existingURL != nil {
			return nil, ErrDownloadURLAlreadyExists
		}
		seenURLs[input.URL] = struct{}{}

		title, err := s.prepareDownloadTitle(context.Background(), input, reservedTitles)
		if err != nil {
			return nil, err
		}

		videos = append(videos, &db.Video{
			DownloadDir:            input.DownloadDir,
			Name:                   title,
			Type:                   input.Type,
			URL:                    input.URL,
			Headers:                input.Headers,
			Folder:                 input.Folder,
			RequiresRuntimeHeaders: HasPrivateHeaders(input.RuntimeHeaders),
		})
	}

	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	created, err := s.repo.CreateMany(videos)
	if err != nil {
		return nil, err
	}
	for i, video := range created {
		if len(inputs[i].RuntimeHeaders) > 0 {
			s.rememberRuntimeHeaders(video.ID, video.URL, inputs[i].RuntimeHeaders)
		}
	}
	return created, nil
}

func (s *DownloadTaskService) prepareDownloadTitle(ctx context.Context, input *AddDownloadTaskInput, reserved map[string]struct{}) (string, error) {
	title := input.Name
	statusID := ""
	isSocialTitle := false

	normalized, normalizedSocial := normalizeXDownloadTitle(input.Name, input.URL)
	if !normalizedSocial {
		normalized, normalizedSocial = normalizeShortVideoDownloadTitle(input.Name, input.URL)
	}
	if normalizedSocial {
		title = normalized.name
		statusID = normalized.statusID
		isSocialTitle = true
	} else {
		if title == "" && input.Type == "bilibili" {
			title = GetPageTitleWithContext(ctx, input.URL, "")
		}
		if title == "" {
			title = fmt.Sprintf("untitled-%s", RandomName())
		}
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}

	// Sanitize before checking uniqueness so the database name is the same
	// filesystem-safe value later handed to the downloader.
	title = core.SanitizeFilename(title)
	available, err := s.isDownloadTitleAvailable(title, reserved)
	if err != nil {
		return "", err
	}
	if available {
		reserveDownloadTitle(title, reserved)
		return title, nil
	}

	if statusID != "" {
		candidate := core.SanitizeFilename(appendSocialIDSuffix(title, statusID))
		available, err = s.isDownloadTitleAvailable(candidate, reserved)
		if err != nil {
			return "", err
		}
		if available {
			reserveDownloadTitle(candidate, reserved)
			return candidate, nil
		}
	}

	candidate := fmt.Sprintf("%s-%s", title, RandomName())
	if isSocialTitle {
		candidate = truncateUTF8Bytes(candidate, maxSocialTitleBytes)
	}
	reserveDownloadTitle(candidate, reserved)
	return candidate, nil
}

func (s *DownloadTaskService) isDownloadTitleAvailable(title string, reserved map[string]struct{}) (bool, error) {
	if _, exists := reserved[title]; exists {
		return false, nil
	}
	existing, err := s.repo.FindByName(title)
	if err != nil {
		return false, err
	}
	return existing == nil, nil
}

func reserveDownloadTitle(title string, reserved map[string]struct{}) {
	if reserved != nil {
		reserved[title] = struct{}{}
	}
}

// EditDownloadTask edits a download task.
func (s *DownloadTaskService) EditDownloadTask(id int64, data map[string]interface{}) (*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	video, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return nil, err
	}

	if url, ok := data["url"].(string); ok {
		existingURL, err := s.repo.FindByURL(url)
		if err != nil {
			return nil, err
		}
		if existingURL != nil && existingURL.ID != id {
			return nil, ErrDownloadURLAlreadyExists
		}
	}

	// An explicit header edit replaces both persistent and ephemeral headers.
	// Changing the URL without new headers invalidates the old credentials.
	updates := make(map[string]any, len(data)+2)
	for key, value := range data {
		updates[key] = value
	}
	rawHeaders, replaceHeaders := data["headers"].(string)
	url, editURL := data["url"].(string)
	urlChanged := editURL && url != video.URL
	var headers []string
	if replaceHeaders {
		headers = ParseStoredHeaders(rawHeaders)
		updates["headers"] = PersistentDiscoveryHeaders(headers)
		updates["requiresRuntimeHeaders"] = HasPrivateHeaders(headers)
	} else if urlChanged {
		updates["headers"] = nil
		updates["requiresRuntimeHeaders"] = video.RequiresRuntimeHeaders || (video.Headers != nil && HasPrivateHeaders(ParseStoredHeaders(*video.Headers)))
	}
	updated, err := s.repo.Update(id, updates)
	if err != nil {
		return nil, err
	}
	if replaceHeaders || urlChanged {
		s.forgetRuntimeHeaders(id)
		if len(headers) > 0 {
			s.rememberRuntimeHeaders(id, updated.URL, headers)
		}
	}
	return updated, nil
}

// GetDownloadTasks retrieves a paginated list of download tasks (including file existence check).
func (s *DownloadTaskService) GetDownloadTasks(current, pageSize int, filter, localPath string) (*PaginatedResult, error) {
	// File resolution can backfill persisted artifact paths.
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	result, err := s.repo.FindWithPagination(current, pageSize, filter)
	if err != nil {
		return nil, err
	}

	list := make([]*DownloadTaskWithFile, 0, len(result.Items))
	videoIDs := make([]int64, 0, len(result.Items))
	for _, item := range result.Items {
		videoIDs = append(videoIDs, item.ID)
	}
	artifactPaths, err := s.repo.FindArtifactPaths(videoIDs)
	if err != nil {
		return nil, err
	}
	for _, item := range result.Items {
		taskWithFile := &DownloadTaskWithFile{
			Video:  item,
			Exists: false,
		}
		if item.Status == "success" {
			exists, file, files, resolveErr := s.resolveTaskFiles(item, localPath, artifactPaths[item.ID])
			if resolveErr != nil {
				return nil, resolveErr
			}
			taskWithFile.Exists = exists
			taskWithFile.File = file
			taskWithFile.Files = files
		}
		s.captureRuntime(taskWithFile)
		list = append(list, taskWithFile)
	}

	return &PaginatedResult{Total: result.Total, List: list}, nil
}

// GetDownloadTask retrieves one download task with file existence information.
func (s *DownloadTaskService) GetDownloadTask(id int64, localPath string) (*DownloadTaskWithFile, error) {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	return s.getDownloadTask(id, localPath)
}

// getDownloadTask requires taskMu to be held.
func (s *DownloadTaskService) getDownloadTask(id int64, localPath string) (*DownloadTaskWithFile, error) {
	item, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return nil, err
	}

	result := &DownloadTaskWithFile{Video: item}
	if item.Status == "success" {
		artifactPaths, artifactErr := s.repo.FindArtifactPaths([]int64{id})
		if artifactErr != nil {
			return nil, artifactErr
		}
		result.Exists, result.File, result.Files, err = s.resolveTaskFiles(item, localPath, artifactPaths[id])
		if err != nil {
			return nil, err
		}
	}
	s.captureRuntime(result)
	return result, nil
}

func (s *DownloadTaskService) resolveTaskFiles(item *db.Video, localPath string, storedArtifacts []string) (bool, string, []string, error) {
	files := make([]string, 0, len(storedArtifacts)+1)
	seen := make(map[string]struct{}, len(storedArtifacts)+1)
	appendResolved := func(candidate string) {
		if exists, file := ResolveOutputPath(candidate); exists {
			if _, ok := seen[file]; ok {
				return
			}
			seen[file] = struct{}{}
			files = append(files, file)
		}
	}

	appendResolved(item.OutputPath)
	for _, artifactPath := range storedArtifacts {
		appendResolved(artifactPath)
	}
	if len(files) > 0 {
		primary := files[0]
		if primary != item.OutputPath || !slices.Equal(files, storedArtifacts) {
			if err := s.repo.UpdateResolvedArtifacts(item.ID, primary, files); err != nil {
				return false, "", nil, err
			}
			item.OutputPath = primary
		}
		return true, primary, files, nil
	}
	// A known output that disappeared must not be replaced by a same-name
	// fragment or unrelated file. Fallback is only for records without identity.
	if item.OutputPath != "" || len(storedArtifacts) > 0 {
		return false, "", nil, nil
	}

	searchDir := localPath
	if item.DownloadDir != "" {
		searchDir = item.DownloadDir
	}
	if searchDir != "" && item.Folder != nil && *item.Folder != "" {
		searchDir = filepath.Join(searchDir, *item.Folder)
	}
	if s.logs != nil {
		if content, readErr := s.logs.Read(string(queueTaskIDForDownload(item.ID))); readErr == nil {
			if exists, file := ResolveOutputPathFromLog(content, item.Name, searchDir); exists {
				if err := s.repo.UpdateOutputPath(item.ID, file); err != nil {
					return false, "", nil, err
				}
				item.OutputPath = file
				return true, file, []string{file}, nil
			}
		}
	}

	if searchDir != "" {
		if exists, file := CheckFileExists(item.Name, searchDir); exists {
			if err := s.repo.UpdateOutputPath(item.ID, file); err != nil {
				return false, "", nil, err
			}
			item.OutputPath = file
			return true, file, []string{file}, nil
		}
	}
	return false, "", nil, nil
}

// StartDownload starts a download task.
func (s *DownloadTaskService) StartDownload(taskID int64, localPath string, deleteSegments bool) error {
	return s.startDownload(context.Background(), taskID, "", localPath, deleteSegments, nil, false)
}

// StartDownloadWithRuntimeHeaders starts a task with ephemeral request headers.
// Private headers stay in expiring task memory; only allowlisted headers persist.
func (s *DownloadTaskService) StartDownloadWithRuntimeHeaders(taskID int64, expectedURL, localPath string, deleteSegments bool, runtimeHeaders []string) error {
	return s.startDownload(context.Background(), taskID, expectedURL, localPath, deleteSegments, runtimeHeaders, false)
}

// StartDownloadIfNeeded preserves completed tasks with an existing output and
// retries missing outputs. The check and enqueue are one lifecycle operation.
func (s *DownloadTaskService) StartDownloadIfNeeded(taskID int64, expectedURL, localPath string, deleteSegments bool, runtimeHeaders []string) error {
	return s.StartDownloadIfNeededWithContext(context.Background(), taskID, expectedURL, localPath, deleteSegments, runtimeHeaders)
}

// StartDownloadIfNeededWithContext observes cancellation before accepting work.
// Once queued, the worker has its own lifetime and is stopped with StopDownload.
func (s *DownloadTaskService) StartDownloadIfNeededWithContext(ctx context.Context, taskID int64, expectedURL, localPath string, deleteSegments bool, runtimeHeaders []string) error {
	return s.startDownload(ctx, taskID, expectedURL, localPath, deleteSegments, runtimeHeaders, true)
}

func (s *DownloadTaskService) startDownload(ctx context.Context, taskID int64, expectedURL, localPath string, deleteSegments bool, runtimeHeaders []string, preserveCompleted bool) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	if err := ctx.Err(); err != nil {
		return err
	}
	video, err := s.repo.FindByIDOrFail(taskID)
	if err != nil {
		return err
	}
	if (expectedURL != "" || runtimeHeaders != nil) && video.URL != expectedURL {
		return ErrDownloadURLChanged
	}
	if s.queue != nil && s.queue.IsScheduled(queueTaskIDForDownload(taskID)) {
		return nil
	}
	if preserveCompleted && video.Status == "success" {
		record, err := s.getDownloadTask(taskID, localPath)
		if err != nil {
			return err
		}
		if record.Exists {
			return nil
		}
	}
	if s.queue == nil {
		return ErrDownloadQueueUnavailable
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if runtimeHeaders != nil {
		if err := s.setRuntimeHeaders(video, runtimeHeaders); err != nil {
			return err
		}
	}
	runtimeHeaders, _, available := s.runtimeHeadersFor(taskID, video.URL)
	if video.RequiresRuntimeHeaders && !available {
		return ErrRuntimeHeadersExpired
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	// Clear any stale artifact identity before re-running the task.
	if err := s.repo.PrepareDownload(taskID); err != nil {
		return err
	}

	params := downloadParamsForVideo(video, taskID)
	if runtimeHeaders != nil {
		params.Headers = mergeDownloadHeaders(params.Headers, runtimeHeaders)
	}

	status := s.queue.Enqueue(params)

	if status == core.StatusDownloading || status == core.StatusPending {
		// The queue's onStart callback owns the downloading transition. Writing
		// it here could overwrite a task that already completed on another goroutine.
		return nil
	}

	// Enqueue failed
	return s.repo.UpdateStatus([]int64{taskID}, "failed")
}

// PersistentDiscoveryHeaders serializes only headers that are safe to retain.
// Session credentials stay exclusively in discovery/task memory.
func PersistentDiscoveryHeaders(headers []string) *string {
	safe := make([]string, 0, len(headers))
	for _, header := range headers {
		name, _, found := strings.Cut(header, ":")
		if !found || sensitiveDiscoveryHeader(name) {
			continue
		}
		safe = append(safe, header)
	}
	if len(safe) == 0 {
		return nil
	}
	encoded, err := json.Marshal(safe)
	if err != nil {
		return nil
	}
	value := string(encoded)
	return &value
}

// StopDownload stops a download task.
func (s *DownloadTaskService) StopDownload(id int64) error {
	if s.queue == nil {
		return ErrDownloadQueueUnavailable
	}
	return s.queue.Stop(queueTaskIDForDownload(id))
}

// DeleteDownloadTask removes a download task.
func (s *DownloadTaskService) DeleteDownloadTask(id int64) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	s.forgetRuntimeHeaders(id)
	if s.queue != nil {
		s.queue.Remove(queueTaskIDForDownload(id))
	}
	return s.repo.Delete(id)
}

// GetDownloadLog retrieves the download log.
func (s *DownloadTaskService) GetDownloadLog(id int64) (string, error) {
	if s.logs == nil {
		return "", nil
	}
	content, err := s.logs.Read(string(queueTaskIDForDownload(id)))
	if err != nil {
		return "", err
	}
	return content, nil
}

// GetTaskFolders retrieves the list of all folders.
func (s *DownloadTaskService) GetTaskFolders() ([]string, error) {
	return s.repo.FindDistinctFolders()
}

// ExportDownloadList exports the download list as text.
func (s *DownloadTaskService) ExportDownloadList() (string, error) {
	tasks, err := s.repo.FindAll("DESC")
	if err != nil {
		return "", err
	}

	lines := make([]string, 0, len(tasks))
	for _, task := range tasks {
		lines = append(lines, fmt.Sprintf("%s %s", task.URL, task.Name))
	}
	return joinLines(lines), nil
}

// SetStatus updates the download status for multiple tasks in bulk.
func (s *DownloadTaskService) SetStatus(ids []int64, status string) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	return s.repo.UpdateStatus(ids, status)
}

func (s *DownloadTaskService) FailDownload(id int64, err error) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	failure := core.DescribeDownloadFailure(err)
	_, updateErr := s.repo.Update(id, map[string]any{"status": "failed", "lastErrorCode": failure.Code})
	return updateErr
}

// CompleteDownload persists the verified primary output and success status in
// one database update.
func (s *DownloadTaskService) CompleteDownload(id int64, result core.DownloadResult) error {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	if _, err := s.repo.FindByIDOrFail(id); err != nil {
		return err
	}
	return s.repo.CompleteDownload(id, result.PrimaryPath, result.ArtifactPaths)
}

// SetIsLive updates the live-stream flag.
func (s *DownloadTaskService) SetIsLive(id int64, isLive bool) (*db.Video, error) {
	s.taskMu.Lock()
	defer s.taskMu.Unlock()
	return s.repo.UpdateIsLive(id, isLive)
}

// FindActiveTasks finds active tasks (pending or downloading).
func (s *DownloadTaskService) FindActiveTasks() ([]*db.Video, error) {
	return s.repo.FindByStatus([]string{"pending", "downloading"})
}

// FindByID looks up a task by ID.
func (s *DownloadTaskService) FindByID(id int64) (*db.Video, error) {
	return s.repo.FindByID(id)
}

// FindByIDOrFail looks up a task by ID, returning an error if not found.
func (s *DownloadTaskService) FindByIDOrFail(id int64) (*db.Video, error) {
	return s.repo.FindByIDOrFail(id)
}

// FindByName looks up a task by name.
func (s *DownloadTaskService) FindByName(name string) (*db.Video, error) {
	return s.repo.FindByName(name)
}

// FindByURL looks up a task by URL.
func (s *DownloadTaskService) FindByURL(url string) (*db.Video, error) {
	return s.repo.FindByURL(url)
}

// ParseStoredHeaders accepts the JSON and legacy newline formats used by
// download creation clients.
func ParseStoredHeaders(raw string) []string {
	var headers []string
	if err := json.Unmarshal([]byte(raw), &headers); err == nil {
		return headers
	}

	lines := strings.Split(strings.ReplaceAll(raw, "\r\n", "\n"), "\n")
	headers = make([]string, 0, len(lines))
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			headers = append(headers, line)
		}
	}
	return headers
}

func downloadParamsForVideo(video *db.Video, downloadID int64) core.DownloadParams {
	folder := ""
	if video.Folder != nil {
		folder = *video.Folder
	}

	var headers []string
	if video.Headers != nil && *video.Headers != "" {
		headers = ParseStoredHeaders(*video.Headers)
	}

	return core.DownloadParams{
		DownloadDir: video.DownloadDir,
		ID:          queueTaskIDForDownload(downloadID),
		Type:        core.DownloadType(video.Type),
		URL:         video.URL,
		Name:        video.Name,
		Folder:      folder,
		Headers:     headers,
	}
}

func mergeDownloadHeaders(stored, runtime []string) []string {
	merged := slices.Clone(stored)
	positions := make(map[string]int, len(merged))
	for index, header := range merged {
		if name, _, found := strings.Cut(header, ":"); found {
			positions[strings.ToLower(strings.TrimSpace(name))] = index
		}
	}
	for _, header := range runtime {
		name, _, found := strings.Cut(header, ":")
		if !found {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(name))
		if index, exists := positions[key]; exists {
			merged[index] = header
			continue
		}
		positions[key] = len(merged)
		merged = append(merged, header)
	}
	return merged
}

func sensitiveDiscoveryHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "user-agent", "referer", "origin", "accept", "accept-language", "accept-encoding", "range":
		return false
	default:
		return true
	}
}

func queueTaskIDForDownload(downloadID int64) core.TaskID {
	return core.TaskID(strconv.FormatInt(downloadID, 10))
}

func joinLines(lines []string) string {
	result := ""
	for i, line := range lines {
		if i > 0 {
			result += "\n"
		}
		result += line
	}
	return result
}
