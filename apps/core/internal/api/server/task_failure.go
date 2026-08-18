package server

import (
	"errors"

	"caorushizi.cn/mediago/internal/core"
)

type taskFailureEventPayload struct {
	ID         string `json:"id"`
	ErrorCode  string `json:"errorCode"`
	Error      string `json:"error"`
	Dependency string `json:"dependency,omitempty"`
}

func taskFailurePayload(id core.TaskID, err error) taskFailureEventPayload {
	var dependencyErr *core.DependencyError
	if errors.As(err, &dependencyErr) {
		return taskFailureEventPayload{
			ID:         string(id),
			ErrorCode:  "dependency_missing",
			Error:      "Required dependency " + dependencyErr.Tool + " is missing",
			Dependency: dependencyErr.Tool,
		}
	}

	return taskFailureEventPayload{
		ID:        string(id),
		ErrorCode: "download_failed",
		Error:     err.Error(),
	}
}
