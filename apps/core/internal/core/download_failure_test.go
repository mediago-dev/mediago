package core

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"syscall"
	"testing"
)

func TestDownloadFailureClassificationDoesNotExposeUnderlyingDetails(t *testing.T) {
	for _, tc := range []struct {
		err       error
		code      string
		retryable bool
	}{
		{fmt.Errorf("sentinel: %w", &DependencyError{Tool: "sentinel", ExpectedPath: "sentinel"}), "dependency_missing", false},
		{fmt.Errorf("sentinel: %w", syscall.ENOSPC), "disk_full", false},
		{fmt.Errorf("sentinel: %w", os.ErrPermission), "permission_denied", false},
		{&net.DNSError{Err: "sentinel", IsTimeout: true}, "network_error", true},
		{errors.New("Authorization: sentinel"), "download_failed", false},
	} {
		failure := DescribeDownloadFailure(tc.err)
		if failure.Code != tc.code || failure.Retryable != tc.retryable || strings.Contains(failure.Message, "sentinel") {
			t.Fatalf("unexpected failure: %+v", failure)
		}
		if restored := DownloadFailureFromCode(failure.Code); restored != failure {
			t.Fatalf("restored %+v differs from %+v", restored, failure)
		}
	}
}
