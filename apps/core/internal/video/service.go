package video

import (
	"fmt"
	"mime"
	"path/filepath"
	"strconv"

	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/service"
	"caorushizi.cn/mediago/internal/tasklog"
)

// Service provides video-related operations backed by the download database
type Service interface {
	GetVideoFiles() ([]Video, error)
	GetVideoByID(id int64) (*Video, error)
	GetVideoFilePath(id int64) (string, error)
}

type dbService struct {
	repo      *repo.VideoRepository
	localPath string
	logs      *tasklog.Manager
}

// NewService creates a video service backed by the download database
func NewService(repo *repo.VideoRepository, localPath string, logs *tasklog.Manager) Service {
	return &dbService{
		repo:      repo,
		localPath: localPath,
		logs:      logs,
	}
}

// resolveFilePath finds the actual file path for a download record.
func (s *dbService) resolveFilePath(rec *db.Video) (string, error) {
	if exists, filePath := service.ResolveOutputPath(rec.OutputPath); exists {
		if filePath != rec.OutputPath {
			_ = s.repo.UpdateOutputPath(rec.ID, filePath)
			rec.OutputPath = filePath
		}
		return filePath, nil
	}

	searchDir := s.localPath
	if rec.DownloadDir != "" {
		searchDir = rec.DownloadDir
	}
	if rec.Folder != nil && *rec.Folder != "" {
		searchDir = filepath.Join(searchDir, *rec.Folder)
	}
	if s.logs != nil {
		if content, readErr := s.logs.Read(strconv.FormatInt(rec.ID, 10)); readErr == nil {
			if exists, filePath := service.ResolveOutputPathFromLog(content, rec.Name, searchDir); exists {
				_ = s.repo.UpdateOutputPath(rec.ID, filePath)
				rec.OutputPath = filePath
				return filePath, nil
			}
		}
	}

	exists, filePath := service.CheckFileExists(rec.Name, searchDir)
	if !exists {
		return "", fmt.Errorf("video file not found")
	}
	_ = s.repo.UpdateOutputPath(rec.ID, filePath)
	rec.OutputPath = filePath

	return filePath, nil
}

// GetVideoFiles returns all successfully downloaded videos that exist on disk
func (s *dbService) GetVideoFiles() ([]Video, error) {
	records, err := s.repo.FindByStatus([]string{"success"})
	if err != nil {
		return nil, fmt.Errorf("failed to query download records: %w", err)
	}

	var videos []Video
	for _, rec := range records {
		filePath, err := s.resolveFilePath(rec)
		if err != nil {
			continue
		}

		videos = append(videos, Video{
			ID:       rec.ID,
			Title:    rec.Name,
			URL:      fmt.Sprintf("/videos/%d", rec.ID),
			MimeType: mimeFromPath(filePath),
		})
	}

	return videos, nil
}

// GetVideoByID returns a single video by its download task ID
func (s *dbService) GetVideoByID(id int64) (*Video, error) {
	rec, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return nil, err
	}

	if rec.Status != "success" {
		return nil, fmt.Errorf("download task %d is not completed", id)
	}

	filePath, err := s.resolveFilePath(rec)
	if err != nil {
		return nil, fmt.Errorf("video file not found for task %d", id)
	}

	return &Video{
		ID:       rec.ID,
		Title:    rec.Name,
		URL:      fmt.Sprintf("/videos/%d", rec.ID),
		MimeType: mimeFromPath(filePath),
	}, nil
}

// GetVideoFilePath returns the absolute file path for a video by its task ID
func (s *dbService) GetVideoFilePath(id int64) (string, error) {
	rec, err := s.repo.FindByIDOrFail(id)
	if err != nil {
		return "", err
	}

	if rec.Status != "success" {
		return "", fmt.Errorf("download task %d is not completed", id)
	}

	return s.resolveFilePath(rec)
}

// mimeFromPath returns the MIME type for a file path based on its extension
func mimeFromPath(filePath string) string {
	ext := filepath.Ext(filePath)
	if mimeType := mime.TypeByExtension(ext); mimeType != "" {
		return mimeType
	}
	return "video/mp4"
}
