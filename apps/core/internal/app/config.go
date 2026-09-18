package app

import (
	"os"
	"path/filepath"
	"strings"
)

// AppConfig stores startup configuration options passed by flags or environment.
type AppConfig struct {
	GinMode             string `json:"gin_mode"`
	Host                string `json:"host"`
	Port                string `json:"port"`
	LogLevel            string `json:"log_level"`
	LogDir              string `json:"log_dir"`
	SchemaPath          string `json:"schema_path"`
	DepsDir             string `json:"deps_dir"`
	MaxRunner           int    `json:"max_runner"`
	LocalDir            string `json:"local_dir"`
	DeleteSegments      bool   `json:"delete_segments"`
	Proxy               string `json:"proxy"`
	UseProxy            bool   `json:"use_proxy"`
	DBPath              string `json:"db_path"`
	ConfigDir           string `json:"config_dir"`
	EnableAuth          bool   `json:"enable_auth"`
	ElectronBridgeToken string `json:"-"`
}

func DefaultConfig() *AppConfig {
	return &AppConfig{
		GinMode:        "release",
		Host:           "0.0.0.0",
		Port:           "8080",
		LogLevel:       "info",
		LogDir:         "./logs",
		SchemaPath:     "",
		DepsDir:        "",
		MaxRunner:      2,
		LocalDir:       "./downloads",
		DeleteSegments: true,
		Proxy:          "",
		UseProxy:       false,
		ConfigDir:      "",
	}
}

func (c *AppConfig) ApplyEnvAndDefaults() {
	c.GinMode = getEnv("GIN_MODE", c.GinMode)
	c.Host = getEnv("HOST", c.Host)
	c.Port = getEnv("PORT", c.Port)
	c.DBPath = getEnv("DB_PATH", c.DBPath)
	c.DepsDir = getEnv("MEDIAGO_DEPS_DIR", c.DepsDir)
	c.ElectronBridgeToken = getEnv("MEDIAGO_ELECTRON_BRIDGE_TOKEN", c.ElectronBridgeToken)

	if runtimeRoot := os.Getenv("MEDIAGO_RUNTIME_ROOT"); runtimeRoot != "" {
		dataDir := filepath.Join(runtimeRoot, "data")
		c.LogDir = filepath.Join(runtimeRoot, "logs")
		c.LocalDir = filepath.Join(runtimeRoot, "downloads")
		c.DBPath = filepath.Join(dataDir, "mediago.db")
		c.ConfigDir = dataDir
	}

	if c.SchemaPath == "" {
		c.SchemaPath = getDefaultSchemaPath()
	}
	if c.ConfigDir == "" {
		c.ConfigDir = c.LogDir
	}
}

func (c *AppConfig) GetLocalDir() string {
	return c.LocalDir
}

// IsDesktop uses the private startup token supplied by the Electron host.
func (c *AppConfig) IsDesktop() bool {
	return strings.TrimSpace(c.ElectronBridgeToken) != ""
}

func (c *AppConfig) GetDeleteSegments() bool {
	return c.DeleteSegments
}

func (c *AppConfig) GetProxy() string {
	return c.Proxy
}

func (c *AppConfig) GetUseProxy() bool {
	return c.UseProxy
}

func (c *AppConfig) SetLocalDir(dir string) {
	c.LocalDir = dir
}

func (c *AppConfig) SetDeleteSegments(del bool) {
	c.DeleteSegments = del
}

func (c *AppConfig) SetProxy(proxy string) {
	c.Proxy = proxy
}

func (c *AppConfig) SetUseProxy(useProxy bool) {
	c.UseProxy = useProxy
}

func getDefaultSchemaPath() string {
	execPath, _ := os.Executable()
	execDir := filepath.Dir(execPath)
	localConfig := filepath.Join(execDir, "config.json")
	if _, err := os.Stat(localConfig); err == nil {
		return localConfig
	}
	return ""
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
