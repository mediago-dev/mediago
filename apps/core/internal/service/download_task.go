package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"path/filepath"
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
	repo     *repo.VideoRepository
	queue    *core.TaskQueue
	logs     *tasklog.Manager
	createMu sync.Mutex
}

// NewDownloadTaskService creates a DownloadTaskService.
func NewDownloadTaskService(repo *repo.VideoRepository, queue *core.TaskQueue, logs *tasklog.Manager) *DownloadTaskService {
	return &DownloadTaskService{repo: repo, queue: queue, logs: logs}
}

// AddDownloadTaskInput holds the input for adding a download task.
type AddDownloadTaskInput struct {
	Name    string  `json:"name"`
	Type    string  `json:"type"`
	URL     string  `json:"url"`
	Headers *string `json:"headers"`
	Folder  *string `json:"folder"`
}

// DownloadTaskWithFile is a download task augmented with file existence information.
type DownloadTaskWithFile struct {
	*db.Video
	Exists bool   `json:"exists"`
	File   string `json:"file,omitempty"`
}

// PaginatedResult holds the paginated result.
type PaginatedResult struct {
	Total int64                   `json:"total"`
	List  []*DownloadTaskWithFile `json:"list"`
}

// AddDownloadTask adds a single download task (with automatic title generation and name uniqueness check).
func (s *DownloadTaskService) AddDownloadTask(input *AddDownloadTaskInput) (*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()

	existingURL, err := s.repo.FindByURL(input.URL)
	if err != nil {
		return nil, err
	}
	if existingURL != nil {
		return nil, ErrDownloadURLAlreadyExists
	}

	title := input.Name

	if title == "" && input.Type == "bilibili" {
		title = GetPageTitle(input.URL, "")
	}
	if title == "" {
		title = fmt.Sprintf("untitled-%s", RandomName())
	}

	// Sanitize BEFORE the de-duplication lookup so the value we check
	// against the DB is the same filesystem-safe form we'll later hand
	// to the downloader and use for post-download file-existence
	// checks. Without this a title like "(2) 主页 / X" slips a '/'
	// into the filename, aria2 reads it as a path separator, and the
	// saved file ends up at a different path than the DB row.
	title = core.SanitizeFilename(title)

	existing, err := s.repo.FindByName(title)
	if err != nil {
		return nil, err
	}
	if existing != nil {
		title = fmt.Sprintf("%s-%s", title, RandomName())
	}

	video := &db.Video{
		Name:    title,
		Type:    input.Type,
		URL:     input.URL,
		Headers: input.Headers,
		Folder:  input.Folder,
	}

	return s.repo.Create(video)
}

// AddDownloadTasks adds multiple download tasks in bulk.
func (s *DownloadTaskService) AddDownloadTasks(inputs []*AddDownloadTaskInput) ([]*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()

	videos := make([]*db.Video, 0, len(inputs))
	seenURLs := make(map[string]struct{}, len(inputs))
	for _, input := range inputs {
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

		title := input.Name

		if title == "" && input.Type == "bilibili" {
			title = GetPageTitle(input.URL, "")
		}
		if title == "" {
			title = fmt.Sprintf("untitled-%s", RandomName())
		}

		// Sanitize BEFORE the de-duplication lookup (same rationale
		// as AddDownloadTask above).
		title = core.SanitizeFilename(title)

		existing, err := s.repo.FindByName(title)
		if err != nil {
			return nil, err
		}
		if existing != nil {
			title = fmt.Sprintf("%s-%s", title, RandomName())
		}

		videos = append(videos, &db.Video{
			Name:    title,
			Type:    input.Type,
			URL:     input.URL,
			Headers: input.Headers,
			Folder:  input.Folder,
		})
	}

	return s.repo.CreateMany(videos)
}

// EditDownloadTask edits a download task.
func (s *DownloadTaskService) EditDownloadTask(id int64, data map[string]interface{}) (*db.Video, error) {
	s.createMu.Lock()
	defer s.createMu.Unlock()

	if url, ok := data["url"].(string); ok {
		existingURL, err := s.repo.FindByURL(url)
		if err != nil {
			return nil, err
		}
		if existingURL != nil && existingURL.ID != id {
			return nil, ErrDownloadURLAlreadyExists
		}
	}

	return s.repo.Update(id, data)
}

// GetDownloadTasks retrieves a paginated list of download tasks (including file existence check).
func (s *DownloadTaskService) GetDownloadTasks(current, pageSize int, filter, localPath string) (*PaginatedResult, error) {
	result, err := s.repo.FindWithPagination(current, pageSize, filter)
	if err != nil {
		return nil, err
	}

	list := make([]*DownloadTaskWithFile, 0, len(result.Items))
	for _, item := range result.Items {
		taskWithFile := &DownloadTaskWithFile{
			Video:  item,
			Exists: false,
		}
		if item.Status == "success" && localPath != "" {
			searchDir := localPath
			if item.Folder != nil && *item.Folder != "" {
				searchDir = filepath.Join(localPath, *item.Folder)
			}
			exists, file := CheckFileExists(item.Name, searchDir)
			taskWithFile.Exists = exists
			taskWithFile.File = file
		}
		list = append(list, taskWithFile)
	}

	return &PaginatedResult{Total: result.Total, List: list}, nil
}

// GetDownloadTask retrieves one download task with file existence information.
func (s *DownloadTaskService) GetDownloadTask(id int64, localPath string) (*DownloadTaskWithFile, error) {
	item, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return nil, err
	}

	result := &DownloadTaskWithFile{Video: item}
	if item.Status == "success" && localPath != "" {
		searchDir := localPath
		if item.Folder != nil && *item.Folder != "" {
			searchDir = filepath.Join(localPath, *item.Folder)
		}
		result.Exists, result.File = CheckFileExists(item.Name, searchDir)
	}
	return result, nil
}

// StartDownload starts a download task.
func (s *DownloadTaskService) StartDownload(taskID int64, localPath string, deleteSegments bool) error {
	video, err := s.repo.FindByIDOrFail(taskID)
	if err != nil {
		return err
	}

	// Update status to pending
	if err := s.repo.UpdateStatus([]int64{taskID}, "pending"); err != nil {
		return err
	}

	params := downloadParamsForVideo(video, taskID)

	status := s.queue.Enqueue(params)

	if status == core.StatusDownloading {
		return s.repo.UpdateStatus([]int64{taskID}, "downloading")
	} else if status == core.StatusPending {
		// Keep the pending status
		return nil
	}

	// Enqueue failed
	return s.repo.UpdateStatus([]int64{taskID}, "failed")
}

// StopDownload stops a download task.
func (s *DownloadTaskService) StopDownload(id int64) error {
	return s.queue.Stop(queueTaskIDForDownload(id))
}

// DeleteDownloadTask removes a download task.
func (s *DownloadTaskService) DeleteDownloadTask(id int64) error {
	s.queue.Remove(queueTaskIDForDownload(id))
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
	return s.repo.UpdateStatus(ids, status)
}

// SetIsLive updates the live-stream flag.
func (s *DownloadTaskService) SetIsLive(id int64, isLive bool) (*db.Video, error) {
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

func parseStoredHeaders(raw string) []string {
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
		headers = parseStoredHeaders(*video.Headers)
	}

	return core.DownloadParams{
		ID:      queueTaskIDForDownload(downloadID),
		Type:    core.DownloadType(video.Type),
		URL:     video.URL,
		Name:    video.Name,
		Folder:  folder,
		Headers: headers,
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
