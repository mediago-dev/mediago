package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestRuntimeLogsDoNotExposeProxyValues(t *testing.T) {
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

	tempDir := t.TempDir()
	localDir := filepath.Join(tempDir, "downloads")
	if err := os.Mkdir(localDir, 0o755); err != nil {
		t.Fatal("runtime test setup failed")
	}

	startupUserMarker := "startup-user-7d2e6f"
	startupPasswordMarker := "startup-pass-a9c413"
	startupProxy := "http://" + startupUserMarker + ":" + startupPasswordMarker + "@127.0.0.1:39091"
	runtimeUserMarker := "runtime-user-b15c84"
	runtimePasswordMarker := "runtime-pass-e30d72"
	runtimeProxy := "http://" + runtimeUserMarker + ":" + runtimePasswordMarker + "@127.0.0.1:39092"

	cfg := &AppConfig{
		LogDir:     filepath.Join(tempDir, "logs"),
		SchemaPath: filepath.Join(tempDir, "missing-schema.json"),
		DepsDir:    filepath.Join(tempDir, "deps"),
		MaxRunner:  1,
		LocalDir:   localDir,
		Proxy:      startupProxy,
		ConfigDir:  filepath.Join(tempDir, "config"),
	}

	rt, err := NewRuntime(cfg)
	if err != nil {
		t.Fatal("runtime initialization failed")
	}
	t.Cleanup(rt.Close)

	if err := rt.AppStore.Set("proxy", runtimeProxy); err != nil {
		t.Fatal("runtime proxy update failed")
	}

	proxyPropagated := cfg.GetProxy() == runtimeProxy
	if !proxyPropagated {
		t.Fatal("runtime proxy propagation changed")
	}

	secretMarkers := []string{
		startupProxy,
		startupUserMarker,
		startupPasswordMarker,
		runtimeProxy,
		runtimeUserMarker,
		runtimePasswordMarker,
	}
	for _, entry := range observedLogs.All() {
		messageContainsSecret := containsAnyRuntimeLogSecret(entry.Message, secretMarkers)
		contextContainsSecret := containsAnyRuntimeLogSecret(fmt.Sprint(entry.ContextMap()), secretMarkers)
		if messageContainsSecret || contextContainsSecret {
			t.Fatal("runtime logs contain a proxy secret")
		}
	}

	updateMessageFound := observedLogs.FilterMessage("proxy updated via config change").Len() > 0
	if !updateMessageFound {
		t.Fatal("runtime proxy update log message missing")
	}
}

func containsAnyRuntimeLogSecret(value string, secrets []string) bool {
	for _, secret := range secrets {
		containsSecret := strings.Contains(value, secret)
		if containsSecret {
			return true
		}
	}
	return false
}
