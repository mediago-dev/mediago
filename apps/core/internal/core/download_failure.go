package core

import (
	"errors"
	"net"
	"os"
	"syscall"
)

var ErrResultPersistence = errors.New("download result could not be saved")

// DownloadFailure deliberately excludes raw process output, URLs and headers.
type DownloadFailure struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	Retryable bool   `json:"retryable"`
}

func DescribeDownloadFailure(err error) DownloadFailure {
	var dependency *DependencyError
	var network net.Error
	switch {
	case errors.Is(err, ErrResultPersistence):
		return DownloadFailure{"result_persistence_failed", "The media was downloaded but its result could not be saved; inspect MediaGo before retrying.", false}
	case errors.As(err, &dependency):
		return DownloadFailure{"dependency_missing", "A required downloader dependency is unavailable; repair dependencies before retrying.", false}
	case errors.Is(err, syscall.ENOSPC):
		return DownloadFailure{"disk_full", "The download disk is full; free space before retrying.", false}
	case errors.Is(err, os.ErrPermission):
		return DownloadFailure{"permission_denied", "The downloader cannot access a required file or directory.", false}
	case errors.As(err, &network):
		return DownloadFailure{"network_error", "A network operation failed.", true}
	default:
		return DownloadFailure{"download_failed", "The downloader failed; inspect the task log in MediaGo before retrying.", false}
	}
}

// DownloadFailureFromCode restores only known, sanitized diagnostics from disk.
func DownloadFailureFromCode(code string) DownloadFailure {
	switch code {
	case "result_persistence_failed":
		return DescribeDownloadFailure(ErrResultPersistence)
	case "dependency_missing":
		return DescribeDownloadFailure(&DependencyError{})
	case "disk_full":
		return DescribeDownloadFailure(syscall.ENOSPC)
	case "permission_denied":
		return DescribeDownloadFailure(os.ErrPermission)
	case "network_error":
		return DownloadFailure{"network_error", "A network operation failed.", true}
	default:
		return DescribeDownloadFailure(nil)
	}
}
