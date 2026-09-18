// Package core contains the core type definitions for the download system
package core

import (
	"context"
	"net/url"
	"strings"
	"time"
)

// DownloadType is the download type enum
type DownloadType string

const (
	TypeM3U8        DownloadType = "m3u8"
	TypeBilibili    DownloadType = "bilibili"
	TypeDirect      DownloadType = "direct"
	TypeMediago     DownloadType = "mediago"
	TypeYoutube     DownloadType = "youtube"
	TypeXiaohongshu DownloadType = "xiaohongshu"
)

// InferDownloadType chooses the existing downloader channel for a URL when a
// caller does not provide an explicit type. Supported social-video pages share
// the youtube wire value because they are handled by yt-dlp.
func InferDownloadType(rawURL string) DownloadType {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return TypeDirect
	}

	hostname := strings.ToLower(parsed.Hostname())
	pathname := strings.ToLower(parsed.EscapedPath())
	switch {
	case hostname == "b23.tv", hostname == "bilibili.com", strings.HasSuffix(hostname, ".bilibili.com"):
		return TypeBilibili
	case hostname == "youtu.be", hostname == "youtube.com", strings.HasSuffix(hostname, ".youtube.com"):
		return TypeYoutube
	case isXStatusURL(hostname, pathname):
		return TypeYoutube
	case isShortVideoURL(hostname, pathname):
		return TypeYoutube
	case isXiaohongshuURL(hostname, pathname):
		return TypeXiaohongshu
	case strings.HasSuffix(pathname, ".m3u8"):
		return TypeM3U8
	default:
		return TypeDirect
	}
}

func isXiaohongshuURL(hostname, pathname string) bool {
	parts := strings.Split(strings.Trim(pathname, "/"), "/")
	if hostname == "xhslink.com" || strings.HasSuffix(hostname, ".xhslink.com") {
		return len(parts) > 0 && parts[0] != ""
	}
	if hostname != "xiaohongshu.com" && !strings.HasSuffix(hostname, ".xiaohongshu.com") {
		return false
	}
	if len(parts) >= 2 && (parts[0] == "explore" || (len(parts) >= 3 && parts[0] == "discovery" && parts[1] == "item")) {
		if parts[0] == "explore" {
			return parts[1] != ""
		}
		return parts[2] != ""
	}
	return len(parts) >= 4 && parts[0] == "user" && parts[1] == "profile" && parts[2] != "" && parts[3] != ""
}

func normalizeXiaohongshuURLForYTDLP(rawURL string) string {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}
	hostname := strings.ToLower(parsed.Hostname())
	if hostname != "xiaohongshu.com" && !strings.HasSuffix(hostname, ".xiaohongshu.com") {
		return rawURL
	}
	parts := strings.Split(strings.Trim(parsed.Path, "/"), "/")
	if len(parts) < 4 || parts[0] != "user" || parts[1] != "profile" || parts[3] == "" {
		return rawURL
	}
	parsed.Path = "/explore/" + parts[3]
	parsed.RawPath = ""
	parsed.Fragment = ""
	return parsed.String()
}

func isShortVideoURL(hostname, pathname string) bool {
	parts := strings.Split(strings.Trim(pathname, "/"), "/")

	switch hostname {
	case "vm.tiktok.com", "vt.tiktok.com", "v.douyin.com":
		return len(parts) > 0 && parts[0] != ""
	case "tiktok.com", "www.tiktok.com", "m.tiktok.com", "tiktokv.com", "www.tiktokv.com":
		if len(parts) >= 3 && strings.HasPrefix(parts[0], "@") && parts[1] == "video" {
			return isNumericPathSegment(parts[2])
		}
		if len(parts) >= 3 && parts[0] == "share" && parts[1] == "video" {
			return isNumericPathSegment(parts[2])
		}
		return len(parts) >= 2 && parts[0] == "t" && parts[1] != ""
	case "douyin.com", "www.douyin.com":
		return len(parts) >= 2 && parts[0] == "video" && isNumericPathSegment(parts[1])
	default:
		return false
	}
}

func isNumericPathSegment(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func isXStatusURL(hostname, pathname string) bool {
	isXHost := hostname == "x.com" || strings.HasSuffix(hostname, ".x.com") ||
		hostname == "twitter.com" || strings.HasSuffix(hostname, ".twitter.com")
	if !isXHost {
		return false
	}

	parts := strings.Split(strings.Trim(pathname, "/"), "/")
	if len(parts) < 3 || parts[0] == "" || parts[1] != "status" || parts[2] == "" {
		return false
	}
	return isNumericPathSegment(parts[2])
}

// BinaryNames maps each DownloadType to its executable filename (without extension).
var BinaryNames = map[DownloadType]string{
	TypeM3U8:        "N_m3u8DL-RE",
	TypeBilibili:    "BBDown",
	TypeDirect:      "aria2c",
	TypeMediago:     "mediago",
	TypeYoutube:     "yt-dlp",
	TypeXiaohongshu: "yt-dlp",
}

// FFmpegBinaryName is the filename for the ffmpeg binary (without extension).
const FFmpegBinaryName = "ffmpeg"

// DenoBinaryName is the filename for yt-dlp's JavaScript runtime (without extension).
const DenoBinaryName = "deno"

// TaskID is the unique identifier for a task
type TaskID string

// TaskStatus is the task status enum
type TaskStatus string

const (
	StatusPending     TaskStatus = "pending"     // waiting
	StatusDownloading TaskStatus = "downloading" // downloading
	StatusSuccess     TaskStatus = "success"     // completed successfully
	StatusFailed      TaskStatus = "failed"      // failed
	StatusStopped     TaskStatus = "stopped"     // stopped
)

// DownloadParams holds the parameters for a download task
type DownloadParams struct {
	ID          TaskID       `json:"id"`                    // task ID
	Type        DownloadType `json:"type"`                  // download type
	URL         string       `json:"url"`                   // download URL
	Name        string       `json:"name"`                  // file name
	Folder      string       `json:"folder"`                // subdirectory
	DownloadDir string       `json:"downloadDir,omitempty"` // desktop task download root override
	Headers     []string     `json:"headers"`               // HTTP request headers
}

// ProgressEvent is a progress update event
type ProgressEvent struct {
	ID      TaskID  `json:"id"`      // task ID
	Type    string  `json:"type"`    // event type: "ready" | "progress"
	Percent float64 `json:"percent"` // completion percentage
	Speed   string  `json:"speed"`   // download speed
	IsLive  bool    `json:"isLive"`  // whether this is a live stream
}

// MessageEvent is a message event (console output)
type MessageEvent struct {
	ID      TaskID `json:"id"`      // task ID
	Message string `json:"message"` // message content
}

// TaskInfo holds information about a task
type TaskInfo struct {
	ID            TaskID           `json:"id"`                      // task ID
	Type          DownloadType     `json:"type"`                    // download type
	URL           string           `json:"url"`                     // download URL
	Name          string           `json:"name"`                    // file name
	OutputPath    string           `json:"outputPath,omitempty"`    // verified primary output path
	ArtifactPaths []string         `json:"artifactPaths,omitempty"` // every verified output path
	Status        TaskStatus       `json:"status"`                  // task status
	Percent       float64          `json:"percent"`                 // completion percentage
	Speed         string           `json:"speed"`                   // download speed
	IsLive        bool             `json:"isLive"`                  // whether this is a live stream
	StartedAt     *time.Time       `json:"startedAt,omitempty"`     // actual task execution start time
	StopRequested bool             `json:"stopRequested,omitempty"`
	Failure       *DownloadFailure `json:"failure,omitempty"`
	Error         string           `json:"error,omitempty"` // error message (if any)
}

// DownloadResult identifies every verified artifact produced by a downloader.
// Paths are absolute so changing the configured download directory cannot
// detach a completed task from its files.
type DownloadResult struct {
	PrimaryPath         string   `json:"primaryPath"`
	ArtifactPaths       []string `json:"artifactPaths"`
	FinalizedAfterStop  bool     `json:"finalizedAfterStop,omitempty"`
	RecoveredAfterError bool     `json:"recoveredAfterError,omitempty"`
	RecoveredSegments   bool     `json:"recoveredSegments,omitempty"`
}

// Callbacks is a collection of download callback functions
type Callbacks struct {
	OnProgress func(ProgressEvent) // progress update callback
	OnMessage  func(MessageEvent)  // message output callback
}

// Runner is the interface for a command executor
type Runner interface {
	// Run executes a command and processes stdout/stderr line by line
	Run(ctx context.Context, binPath string, args []string, onStdLine func(line string)) error
}

// RunnerOptions controls cancellation behavior without changing the legacy
// Runner contract used by lightweight integrations and tests.
type RunnerOptions struct {
	ShouldGracefullyStop func() bool
	GracePeriod          time.Duration
}

// ConfigurableRunner supports cooperative process cancellation. Downloaders
// fall back to Runner.Run when an implementation does not provide it.
type ConfigurableRunner interface {
	Runner
	RunWithOptions(ctx context.Context, binPath string, args []string, onStdLine func(line string), options RunnerOptions) error
}

// Downloader is the interface for a downloader
type Downloader interface {
	Download(ctx context.Context, p DownloadParams, cb Callbacks) (DownloadResult, error)
	Config() interface{}
}
