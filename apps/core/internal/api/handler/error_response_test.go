package handler

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

type errorResponsePayload struct {
	Success   bool            `json:"success"`
	Code      json.RawMessage `json:"code"`
	Message   string          `json:"message"`
	ErrorCode string          `json:"errorCode"`
}

func TestDownloadIDRejectsInvalidPositiveDecimalValues(t *testing.T) {
	engine := newIDContractTestRouter(t)
	tests := []struct {
		name string
		id   string
	}{
		{name: "non numeric", id: "not-a-number"},
		{name: "zero", id: "0"},
		{name: "negative", id: "-1"},
		{name: "overflow", id: "9223372036854775808"},
		{name: "fractional", id: "1.5"},
		{name: "leading space", id: "%201"},
		{name: "trailing space", id: "1%20"},
		{name: "explicit plus", id: "+1"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := performRequest(engine, http.MethodGet, "/api/downloads/"+tt.id, "")
			assertErrorResponse(t, response, http.StatusBadRequest, "invalid_id")
		})
	}
}

func TestDownloadIDValidationIsConsistentAcrossEndpoints(t *testing.T) {
	engine := newIDContractTestRouter(t)
	tests := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/downloads/not-a-number"},
		{method: http.MethodPut, path: "/api/downloads/not-a-number"},
		{method: http.MethodDelete, path: "/api/downloads/not-a-number"},
		{method: http.MethodPost, path: "/api/downloads/not-a-number/start"},
		{method: http.MethodPost, path: "/api/downloads/not-a-number/stop"},
		{method: http.MethodPut, path: "/api/downloads/not-a-number/live"},
		{method: http.MethodGet, path: "/api/downloads/not-a-number/logs"},
	}

	for _, tt := range tests {
		t.Run(tt.method+" "+tt.path, func(t *testing.T) {
			response := performRequest(engine, tt.method, tt.path, "")
			assertErrorResponse(t, response, http.StatusBadRequest, "invalid_id")
		})
	}
}

func TestDownloadIDNotFoundHasStableErrorCode(t *testing.T) {
	engine := newIDContractTestRouter(t)
	response := performRequest(engine, http.MethodGet, "/api/downloads/42", "")

	payload := assertErrorResponse(t, response, http.StatusNotFound, "download_not_found")
	if payload.Message != "video with id 42 not found" {
		t.Fatalf("message = %q, want localized download-not-found message", payload.Message)
	}
}

func TestTaskIDUsesOpaqueStringLookup(t *testing.T) {
	engine := newIDContractTestRouter(t)
	for _, id := range []string{
		"custom-queue-id",
		"550e8400-e29b-41d4-a716-446655440000",
	} {
		t.Run(id, func(t *testing.T) {
			response := performRequest(engine, http.MethodGet, "/api/tasks/"+id, "")
			assertErrorResponse(t, response, http.StatusNotFound, "task_not_found")
		})
	}
}

func TestErrorResponseOmitsEmptyErrorCode(t *testing.T) {
	responseType := reflect.TypeOf(dto.ErrorResponse{})
	field, ok := responseType.FieldByName("ErrorCode")
	if !ok {
		t.Fatal("dto.ErrorResponse is missing ErrorCode")
	}
	if got, want := field.Tag.Get("json"), "errorCode,omitempty"; got != want {
		t.Fatalf("ErrorCode json tag = %q, want %q", got, want)
	}

	payload, err := json.Marshal(dto.ErrorResponse{
		Success: false,
		Code:    http.StatusInternalServerError,
		Message: "internal error",
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if strings.Contains(string(payload), "errorCode") {
		t.Fatalf("empty ErrorCode must be omitted, got %s", payload)
	}
}

func newIDContractTestRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	previousLogger := logger.Logger
	previousSugar := logger.Sugar
	logger.Logger = zap.NewNop()
	logger.Sugar = logger.Logger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	database, err := db.New(filepath.Join(t.TempDir(), "mediago.db"))
	if err != nil {
		t.Fatalf("db.New() error = %v", err)
	}
	t.Cleanup(func() {
		if err := database.Close(); err != nil {
			t.Errorf("database.Close() error = %v", err)
		}
	})

	videoRepo := repo.NewVideoRepository(database)
	downloadService := service.NewDownloadTaskService(videoRepo, nil, nil)
	downloadHandler := NewDownloadHandler(downloadService, &recordingConfigStore{}, sse.New())
	taskHandler := NewTaskHandler(core.NewTaskQueue(nil, 1), nil)

	engine := gin.New()
	engine.GET("/api/downloads/:id", downloadHandler.Get)
	engine.PUT("/api/downloads/:id", downloadHandler.Edit)
	engine.DELETE("/api/downloads/:id", downloadHandler.Delete)
	engine.POST("/api/downloads/:id/start", downloadHandler.Start)
	engine.POST("/api/downloads/:id/stop", downloadHandler.Stop)
	engine.PUT("/api/downloads/:id/live", downloadHandler.UpdateIsLive)
	engine.GET("/api/downloads/:id/logs", downloadHandler.Logs)
	engine.GET("/api/tasks/:id", taskHandler.Get)
	return engine
}

func performRequest(engine http.Handler, method, path, body string) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	engine.ServeHTTP(response, request)
	return response
}

func assertErrorResponse(t *testing.T, response *httptest.ResponseRecorder, wantStatus int, wantErrorCode string) errorResponsePayload {
	t.Helper()
	if response.Code != wantStatus {
		t.Fatalf("HTTP status = %d, want %d; body = %s", response.Code, wantStatus, response.Body.String())
	}

	var payload errorResponsePayload
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("json.Unmarshal() error = %v; body = %s", err, response.Body.String())
	}
	if payload.Success {
		t.Fatal("success = true, want false")
	}
	if got, want := string(payload.Code), strconv.Itoa(wantStatus); got != want {
		t.Fatalf("code = %s, want JSON integer %s", got, want)
	}
	if payload.ErrorCode != wantErrorCode {
		t.Fatalf("errorCode = %q, want %q", payload.ErrorCode, wantErrorCode)
	}
	if payload.Message == "" {
		t.Fatal("localized message is empty")
	}
	return payload
}
