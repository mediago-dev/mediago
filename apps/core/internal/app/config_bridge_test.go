package app

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"
)

func TestAppConfigReadsButNeverSerializesElectronBridgeToken(t *testing.T) {
	t.Setenv("MEDIAGO_ELECTRON_BRIDGE_TOKEN", "sentinel-bridge-token")
	cfg := DefaultConfig()
	cfg.ApplyEnvAndDefaults()
	if cfg.ElectronBridgeToken != "sentinel-bridge-token" {
		t.Fatalf("ElectronBridgeToken = %q", cfg.ElectronBridgeToken)
	}
	encoded, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("sentinel-bridge-token")) {
		t.Fatalf("serialized config leaked bridge token: %s", encoded)
	}
}

func TestAppConfigReadsTaskRuntimeEnvironment(t *testing.T) {
	runtimeRoot := t.TempDir()
	depsDir := filepath.Join(t.TempDir(), "deps")
	t.Setenv("MEDIAGO_RUNTIME_ROOT", runtimeRoot)
	t.Setenv("MEDIAGO_DEPS_DIR", depsDir)

	cfg := DefaultConfig()
	cfg.ApplyEnvAndDefaults()

	dataDir := filepath.Join(runtimeRoot, "data")
	if cfg.LogDir != filepath.Join(runtimeRoot, "logs") {
		t.Fatalf("LogDir = %q", cfg.LogDir)
	}
	if cfg.LocalDir != filepath.Join(runtimeRoot, "downloads") {
		t.Fatalf("LocalDir = %q", cfg.LocalDir)
	}
	if cfg.DBPath != filepath.Join(dataDir, "mediago.db") {
		t.Fatalf("DBPath = %q", cfg.DBPath)
	}
	if cfg.ConfigDir != dataDir {
		t.Fatalf("ConfigDir = %q", cfg.ConfigDir)
	}
	if cfg.DepsDir != depsDir {
		t.Fatalf("DepsDir = %q", cfg.DepsDir)
	}
}

func TestAppConfigOnlyIdentifiesElectronAsDesktop(t *testing.T) {
	for _, test := range []struct {
		token string
		want  bool
	}{{"", false}, {" \t", false}, {"electron-private-token", true}} {
		cfg := DefaultConfig()
		cfg.ElectronBridgeToken = test.token
		if got := cfg.IsDesktop(); got != test.want {
			t.Fatalf("IsDesktop() = %v, want %v", got, test.want)
		}
	}
}
