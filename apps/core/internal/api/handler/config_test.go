package handler

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/logger"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

type recordingConfigStore struct {
	updated map[string]any
}

func (s *recordingConfigStore) Get(string) any        { return nil }
func (s *recordingConfigStore) Set(string, any) error { return nil }
func (s *recordingConfigStore) Store() any            { return nil }
func (s *recordingConfigStore) Update(update map[string]any) error {
	s.updated = update
	return nil
}

func TestConfigUpdateLogsKeysWithoutValues(t *testing.T) {
	gin.SetMode(gin.TestMode)

	observedCore, observedLogs := observer.New(zapcore.DebugLevel)
	observedLogger := zap.New(observedCore)
	previousLogger := logger.Logger
	previousSugar := logger.Sugar
	logger.Logger = observedLogger
	logger.Sugar = observedLogger.Sugar()
	t.Cleanup(func() {
		logger.Logger = previousLogger
		logger.Sugar = previousSugar
	})

	proxyValue := "http://config-proxy-user-f38d:config-proxy-pass-91a2@127.0.0.1:39093"
	apiKeyValue := "config-api-key-b72f6a"
	mcpTokenValue := "config-mcp-token-c81d4e"
	passwordHashValue := "config-password-hash-d93a57"
	body := strings.NewReader(`{"proxy":"` + proxyValue + `","passwordHash":"` + passwordHashValue + `","apiKey":"` + apiKeyValue + `","mcpToken":"` + mcpTokenValue + `"}`)

	store := &recordingConfigStore{}
	configHandler := NewConfigHandler(store, sse.New())
	engine := gin.New()
	engine.POST("/config", configHandler.Update)
	request := httptest.NewRequest(http.MethodPost, "/config", body)
	request.Header.Set("Content-Type", "application/json")
	recorder := httptest.NewRecorder()
	engine.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatal("config update request failed")
	}

	expectedUpdate := map[string]any{
		"proxy":        proxyValue,
		"apiKey":       apiKeyValue,
		"mcpToken":     mcpTokenValue,
		"passwordHash": passwordHashValue,
	}
	payloadUnchanged := reflect.DeepEqual(store.updated, expectedUpdate)
	if !payloadUnchanged {
		t.Fatal("config update payload changed")
	}

	entries := observedLogs.FilterMessage("Config update request received").All()
	if len(entries) != 1 {
		t.Fatal("config update log entry missing")
	}
	context := entries[0].ContextMap()
	if _, present := context["req"]; present {
		t.Fatal("config update log contains request payload")
	}

	loggedKeys, keysValid := configLogKeys(context["keys"])
	expectedKeys := []string{"apiKey", "mcpToken", "passwordHash", "proxy"}
	keysMatch := reflect.DeepEqual(loggedKeys, expectedKeys)
	if !keysValid || !keysMatch {
		t.Fatal("config update log keys changed")
	}
	if _, present := context["clientIP"]; !present {
		t.Fatal("config update client IP missing")
	}

	secretMarkers := []string{
		proxyValue,
		apiKeyValue,
		mcpTokenValue,
		passwordHashValue,
		"config-proxy-user-f38d",
		"config-proxy-pass-91a2",
		"config-api-key-b72f6a",
		"config-mcp-token-c81d4e",
		"config-password-hash-d93a57",
	}
	for _, entry := range observedLogs.All() {
		messageContainsSecret := configLogContainsMarker(entry.Message, secretMarkers)
		contextContainsSecret := configLogContainsMarker(entry.ContextMap(), secretMarkers)
		if messageContainsSecret || contextContainsSecret {
			t.Fatal("config update logs contain secret material")
		}
	}
}

func configLogKeys(value any) ([]string, bool) {
	switch values := value.(type) {
	case []string:
		return values, true
	case []any:
		keys := make([]string, len(values))
		for index, value := range values {
			key, ok := value.(string)
			if !ok {
				return nil, false
			}
			keys[index] = key
		}
		return keys, true
	default:
		return nil, false
	}
}

func configLogContainsMarker(value any, markers []string) bool {
	switch value := value.(type) {
	case string:
		for _, marker := range markers {
			containsMarker := strings.Contains(value, marker)
			if containsMarker {
				return true
			}
		}
	case []string:
		for _, item := range value {
			if configLogContainsMarker(item, markers) {
				return true
			}
		}
	case []any:
		for _, item := range value {
			if configLogContainsMarker(item, markers) {
				return true
			}
		}
	case map[string]any:
		for key, item := range value {
			if configLogContainsMarker(key, markers) || configLogContainsMarker(item, markers) {
				return true
			}
		}
	}
	return false
}
