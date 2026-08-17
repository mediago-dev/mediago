package app

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"

	"github.com/google/uuid"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/core/runner"
	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/tasklog"
	"caorushizi.cn/mediago/pkg/conf"
)

type Runtime struct {
	Config     *AppConfig
	AppStore   *conf.Conf[AppStore]
	Downloader *core.DownloaderSvc
	Queue      *core.TaskQueue
	TaskLogs   *tasklog.Manager
	Database   *db.Database
}

func InitLogger(cfg *AppConfig) error {
	logCfg := logger.DefaultConfig()
	logCfg.Level = cfg.LogLevel
	logCfg.LogDir = cfg.LogDir

	if err := logger.Init(logCfg); err != nil {
		return fmt.Errorf("failed to initialize logger: %w", err)
	}
	return nil
}

func NewRuntime(cfg *AppConfig) (*Runtime, error) {
	logger.Info("MediaGo Downloader Core Starting...")

	appStore, err := conf.New(conf.Options[AppStore]{
		ConfigName: "config",
		CWD:        cfg.ConfigDir,
		Defaults:   DefaultAppStore(),
	})
	if err != nil {
		return nil, fmt.Errorf("failed to initialize app store: %w", err)
	}
	logger.Infof("App store initialized at: %s", appStore.Path())

	if appStore.Store().MachineId == "" {
		newId := uuid.New().String()
		_ = appStore.Set("machineId", newId)
		logger.Infof("Generated new machineId: %s", newId)
	}

	syncAppStoreToCfg(appStore, cfg)
	ensureDownloadDir(appStore, cfg)

	logger.Infof("Loading schemas from: %s", cfg.SchemaPath)
	schemas, err := schema.LoadSchemasFromJSON(cfg.SchemaPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load schemas: %w", err)
	}
	logger.Infof("Loaded %d download schemas", len(schemas.Schemas))

	binMap := getBinaryMap(cfg)
	for dt, binPath := range binMap {
		logger.Infof("%s downloader: %s", dt, binPath)
		if binPath == "" {
			continue
		}
		if info, err := os.Stat(binPath); err != nil {
			logger.Warnf("%s binary not found: %v", dt, err)
		} else if info.Mode()&0o111 == 0 {
			logger.Warnf("%s binary is not executable: %s", dt, binPath)
		}
	}

	r := runner.NewPTYRunner()
	downloader := core.NewDownloader(binMap, r, schemas, cfg)
	queue := core.NewTaskQueue(downloader, cfg.MaxRunner)
	taskLogs := tasklog.NewManager(filepath.Join(cfg.LogDir, "tasks"))

	logger.Infof("Task queue initialized (maxRunner=%d)", cfg.MaxRunner)
	logger.Infof("Task logs will be stored in %s", filepath.Join(cfg.LogDir, "tasks"))

	appStore.OnDidChange("maxRunner", func(newVal, oldVal any) {
		if v, ok := toInt(newVal); ok {
			queue.SetMaxRunner(v)
			logger.Infof("maxRunner updated to %d via config change", v)
		}
	})
	appStore.OnDidChange("proxy", func(newVal, oldVal any) {
		if v, ok := newVal.(string); ok {
			cfg.SetProxy(v)
			logger.Info("proxy updated via config change")
		}
	})
	appStore.OnDidChange("useProxy", func(newVal, oldVal any) {
		if v, ok := newVal.(bool); ok {
			cfg.SetUseProxy(v)
			logger.Infof("useProxy updated to %v via config change", v)
		}
	})
	appStore.OnDidChange("deleteSegments", func(newVal, oldVal any) {
		if v, ok := newVal.(bool); ok {
			cfg.SetDeleteSegments(v)
			logger.Infof("deleteSegments updated to %v via config change", v)
		}
	})
	appStore.OnDidChange("local", func(newVal, oldVal any) {
		if v, ok := newVal.(string); ok {
			cfg.SetLocalDir(v)
			logger.Infof("localDir updated to %q via config change", v)
		}
	})

	var database *db.Database
	if cfg.DBPath != "" {
		if dir := filepath.Dir(cfg.DBPath); dir != "" {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("failed to create database directory %s: %w", dir, err)
			}
		}
		var dbErr error
		database, dbErr = db.New(cfg.DBPath)
		if dbErr != nil {
			return nil, fmt.Errorf("failed to open database: %w", dbErr)
		}
		logger.Infof("Database opened: %s", cfg.DBPath)
	} else {
		logger.Info("No database path provided, running without persistence")
	}

	return &Runtime{
		Config:     cfg,
		AppStore:   appStore,
		Downloader: downloader,
		Queue:      queue,
		TaskLogs:   taskLogs,
		Database:   database,
	}, nil
}

func (rt *Runtime) Close() {
	if rt.Database != nil {
		_ = rt.Database.Close()
	}
}

func syncAppStoreToCfg(store *conf.Conf[AppStore], cfg *AppConfig) {
	s := store.Store()
	cliLocalDir := cfg.LocalDir
	cliExplicit := cliLocalDir != "" && cliLocalDir != "./downloads"

	if cliExplicit {
		_ = store.Set("local", cliLocalDir)
	} else if s.Local != "" {
		cfg.LocalDir = s.Local
	}
	cfg.Proxy = s.Proxy
	cfg.UseProxy = s.UseProxy
	cfg.DeleteSegments = s.DeleteSegments
	if s.MaxRunner > 0 {
		cfg.MaxRunner = s.MaxRunner
	}
}

func ensureDownloadDir(store *conf.Conf[AppStore], cfg *AppConfig) {
	needDefault := cfg.LocalDir == "" || cfg.LocalDir == "./downloads"
	if !needDefault {
		if info, err := os.Stat(cfg.LocalDir); err != nil || !info.IsDir() {
			needDefault = true
		}
	}
	if needDefault {
		sysDownloads := getSystemDownloadsDir()
		logger.Infof("Download dir %q unavailable, using system default: %s", cfg.LocalDir, sysDownloads)
		cfg.LocalDir = sysDownloads
	}
	if store.Store().Local == "" {
		_ = store.Set("local", cfg.LocalDir)
	}
}

func getSystemDownloadsDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "."
	}
	downloads := filepath.Join(home, "Downloads")
	if info, err := os.Stat(downloads); err == nil && info.IsDir() {
		return downloads
	}
	return home
}

func exeExt() string {
	if runtime.GOOS == "windows" {
		return ".exe"
	}
	return ""
}

func getBinaryMap(cfg *AppConfig) map[core.DownloadType]string {
	ext := exeExt()
	m := make(map[core.DownloadType]string, len(core.BinaryNames))
	for dt, name := range core.BinaryNames {
		m[dt] = filepath.Join(cfg.DepsDir, name+ext)
	}
	return m
}

func FFmpegBinPath(cfg *AppConfig) string {
	return filepath.Join(cfg.DepsDir, core.FFmpegBinaryName+exeExt())
}

func toInt(v any) (int, bool) {
	switch n := v.(type) {
	case float64:
		return int(n), true
	case int:
		return n, true
	case int64:
		return int(n), true
	}
	return 0, false
}
