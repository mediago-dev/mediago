package db

import (
	"path/filepath"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestVideoOutputPathMigrationPreservesLegacyRows(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "downloads.db")
	legacy, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := legacy.Exec(`
		CREATE TABLE video (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			type TEXT NOT NULL DEFAULT 'm3u8',
			url TEXT NOT NULL,
			folder TEXT,
			headers TEXT,
			isLive NUMERIC NOT NULL DEFAULT 0,
			status TEXT NOT NULL DEFAULT 'ready',
			createdDate DATETIME,
			updatedDate DATETIME
		)
	`).Error; err != nil {
		t.Fatal(err)
	}
	if err := legacy.Exec(`CREATE UNIQUE INDEX idx_video_name ON video(name)`).Error; err != nil {
		t.Fatal(err)
	}
	if err := legacy.Exec(`INSERT INTO video (name, type, url, status) VALUES (?, ?, ?, ?)`,
		"legacy", "youtube", "https://example.com/legacy", "success").Error; err != nil {
		t.Fatal(err)
	}
	legacySQL, err := legacy.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := legacySQL.Close(); err != nil {
		t.Fatal(err)
	}

	database, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })
	if !database.DB.Migrator().HasColumn(&Video{}, "outputPath") {
		t.Fatal("video.outputPath column was not added")
	}
	if !database.DB.Migrator().HasColumn(&Video{}, "downloadDir") {
		t.Fatal("video.downloadDir column was not added")
	}
	for _, column := range []string{"requiresRuntimeHeaders", "lastErrorCode"} {
		if !database.DB.Migrator().HasColumn(&Video{}, column) {
			t.Fatalf("video.%s column was not added", column)
		}
	}
	if !database.DB.Migrator().HasTable(&DownloadArtifact{}) {
		t.Fatal("download_artifact table was not created")
	}
	var video Video
	if err := database.DB.First(&video).Error; err != nil {
		t.Fatal(err)
	}
	if video.Name != "legacy" || video.Status != "success" || video.OutputPath != "" || video.DownloadDir != "" || video.RequiresRuntimeHeaders || video.LastErrorCode != "" {
		t.Fatalf("migrated legacy row = %#v", video)
	}
}

func TestVideoDownloadDirectorySurvivesDatabaseReopen(t *testing.T) {
	dbPath, customDir := filepath.Join(t.TempDir(), "downloads.db"), t.TempDir()
	database, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	video := Video{Name: "custom", URL: "https://example.com/video.mp4", DownloadDir: customDir}
	if err := database.DB.Create(&video).Error; err != nil {
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := New(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = reopened.Close() })
	var stored Video
	if err := reopened.DB.First(&stored, video.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.DownloadDir != customDir {
		t.Fatalf("downloadDir = %q, want %q", stored.DownloadDir, customDir)
	}
}
