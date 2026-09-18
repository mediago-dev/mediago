package db

import (
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// Database 封装 GORM 数据库连接。
type Database struct {
	DB *gorm.DB
}

// New 打开 SQLite 数据库连接并自动建表。
func New(dbPath string) (*Database, error) {
	db, err := gorm.Open(sqlite.Open(dbPath), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	// SQLite table rebuilds can fail when GORM adds a new NOT NULL column to
	// the legacy video table. Migrate that existing table explicitly and avoid
	// asking AutoMigrate to rebuild it. New databases still receive the full
	// model schema.
	videoTableExists := db.Migrator().HasTable(&Video{})
	if videoTableExists && !db.Migrator().HasColumn(&Video{}, "outputPath") {
		if err := db.Exec(`ALTER TABLE "video" ADD COLUMN "outputPath" TEXT NOT NULL DEFAULT ''`).Error; err != nil {
			return nil, err
		}
	}
	if videoTableExists && !db.Migrator().HasColumn(&Video{}, "downloadDir") {
		if err := db.Exec(`ALTER TABLE "video" ADD COLUMN "downloadDir" TEXT NOT NULL DEFAULT ''`).Error; err != nil {
			return nil, err
		}
	}

	if !videoTableExists {
		if err := db.AutoMigrate(&Video{}); err != nil {
			return nil, err
		}
	}
	for _, column := range []struct{ name, definition string }{
		{"requiresRuntimeHeaders", `INTEGER NOT NULL DEFAULT 0`},
		{"lastErrorCode", `TEXT NOT NULL DEFAULT ''`},
	} {
		if videoTableExists && !db.Migrator().HasColumn(&Video{}, column.name) {
			if err := db.Exec(`ALTER TABLE "video" ADD COLUMN "` + column.name + `" ` + column.definition).Error; err != nil {
				return nil, err
			}
		}
	}
	if err := db.AutoMigrate(&Favorite{}, &Conversion{}, &DownloadArtifact{}); err != nil {
		return nil, err
	}

	// Migrate legacy "watting" status to "pending"
	if err := db.Exec(`UPDATE video SET status = 'pending' WHERE status = 'watting'`).Error; err != nil {
		return nil, err
	}

	// Existing favorites predate iconStatus. Preserve valid stored icons and
	// leave empty rows unresolved so Core can derive them from their original
	// URL when a client asks for resolution.
	if err := db.Exec(`
		UPDATE favorite
		SET iconStatus = CASE
			WHEN icon IS NOT NULL AND TRIM(icon) <> '' THEN 'ready'
			ELSE 'unresolved'
		END
		WHERE iconStatus IS NULL
			OR iconStatus = ''
			OR iconStatus NOT IN ('unresolved', 'ready', 'missing', 'retryable')
			OR (iconStatus = 'unresolved' AND icon IS NOT NULL AND TRIM(icon) <> '')
			OR (iconStatus = 'ready' AND (icon IS NULL OR TRIM(icon) = ''))
	`).Error; err != nil {
		return nil, err
	}

	return &Database{DB: db}, nil
}

// Close 关闭数据库连接。
func (d *Database) Close() error {
	sqlDB, err := d.DB.DB()
	if err != nil {
		return err
	}
	return sqlDB.Close()
}
