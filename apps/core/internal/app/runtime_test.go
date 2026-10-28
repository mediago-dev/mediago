package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/pkg/conf"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"go.uber.org/zap/zaptest/observer"
)

func TestMigrateLegacyAppStoreDeletesMCPPort(t *testing.T) {
	store, err := conf.New(conf.Options[AppStore]{
		CWD:      t.TempDir(),
		Defaults: DefaultAppStore(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set("mcpPort", 39720); err != nil {
		t.Fatal(err)
	}
	if err := store.Set("proxy", "http://127.0.0.1:7890"); err != nil {
		t.Fatal(err)
	}

	if err := migrateLegacyAppStore(store); err != nil {
		t.Fatal(err)
	}
	if value := store.Get("mcpPort"); value != nil {
		t.Fatalf("mcpPort = %#v, want nil", value)
	}
	if value := store.Get("proxy"); value != "http://127.0.0.1:7890" {
		t.Fatalf("proxy = %#v, want preserved value", value)
	}

	data, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	var persisted map[string]any
	if err := json.Unmarshal(data, &persisted); err != nil {
		t.Fatal(err)
	}
	if _, exists := persisted["mcpPort"]; exists {
		t.Fatal("persisted config still contains mcpPort")
	}
}

func TestMigrateLegacyAppStoreReportsWriteFailure(t *testing.T) {
	store, err := conf.New(conf.Options[AppStore]{
		CWD:      t.TempDir(),
		Defaults: DefaultAppStore(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Set("mcpPort", 39720); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(store.Path()+".tmp", 0o755); err != nil {
		t.Fatal(err)
	}

	err = migrateLegacyAppStore(store)
	if err == nil || !strings.Contains(err.Error(), "remove legacy mcpPort config") {
		t.Fatalf("migration error = %v, want legacy cleanup failure", err)
	}
	if value := store.Get("mcpPort"); value == nil {
		t.Fatal("failed migration did not restore the in-memory legacy value")
	}
}

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
	if err := rt.AppStore.Set("downloadProxySwitch", true); err != nil {
		t.Fatal(err)
	}
	if !cfg.GetUseProxy() {
		t.Fatal("download proxy switch did not reach the downloader")
	}
	if err := rt.AppStore.Set("useProxy", false); err != nil {
		t.Fatal(err)
	}
	if !cfg.GetUseProxy() {
		t.Fatal("browser switch changed the download proxy")
	}
	if err := rt.AppStore.Set("downloadProxySwitch", false); err != nil {
		t.Fatal(err)
	}
	if cfg.GetUseProxy() {
		t.Fatal("download proxy stayed enabled")
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

func TestEnsureDownloadDirCreatesConfiguredDirectory(t *testing.T) {
	tempDir := t.TempDir()
	configDir := filepath.Join(tempDir, "config")
	store, err := conf.New(conf.Options[AppStore]{
		CWD:      configDir,
		Defaults: DefaultAppStore(),
	})
	if err != nil {
		t.Fatal(err)
	}

	localDir := filepath.Join(tempDir, "nested", "downloads")
	cfg := &AppConfig{LocalDir: localDir}
	ensureDownloadDir(store, cfg)

	info, err := os.Stat(localDir)
	if err != nil {
		t.Fatalf("configured download directory was not created: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("configured download path is not a directory: %s", localDir)
	}
	if cfg.LocalDir != localDir {
		t.Fatalf("LocalDir = %q, want %q", cfg.LocalDir, localDir)
	}
	if got := store.Store().Local; got != localDir {
		t.Fatalf("persisted local directory = %q, want %q", got, localDir)
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
