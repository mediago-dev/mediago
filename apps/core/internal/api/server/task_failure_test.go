package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/core"
)

func TestTaskFailurePayloadMapsWrappedDependencyError(t *testing.T) {
	cause := errors.New("stat /private/runtime/BBDown: no such file or directory")
	err := fmt.Errorf("download command failed: %w", &core.DependencyError{
		Tool:         "BBDown",
		ExpectedPath: "/private/runtime/BBDown",
		Err:          cause,
	})

	payload := taskFailurePayload(core.TaskID("42"), err)
	encoded, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		t.Fatalf("json.Marshal() error = %v", marshalErr)
	}

	const want = `{"id":"42","errorCode":"dependency_missing","error":"Required dependency BBDown is missing","dependency":"BBDown"}`
	if got := string(encoded); got != want {
		t.Fatalf("taskFailurePayload() JSON = %s, want %s", got, want)
	}
	if strings.Contains(string(encoded), "/private/runtime/BBDown") || strings.Contains(string(encoded), cause.Error()) {
		t.Fatalf("taskFailurePayload() JSON leaks private dependency details: %s", encoded)
	}
}

func TestTaskFailurePayloadPreservesGenericError(t *testing.T) {
	err := errors.New("remote server closed the connection")
	payload := taskFailurePayload(core.TaskID("42"), err)
	encoded, marshalErr := json.Marshal(payload)
	if marshalErr != nil {
		t.Fatalf("json.Marshal() error = %v", marshalErr)
	}

	const want = `{"id":"42","errorCode":"download_failed","error":"remote server closed the connection"}`
	if got := string(encoded); got != want {
		t.Fatalf("taskFailurePayload() JSON = %s, want %s", got, want)
	}
}
