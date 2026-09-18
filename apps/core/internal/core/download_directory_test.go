package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveDownloadDirectory(t *testing.T) {
	root := t.TempDir()
	custom := filepath.Join(t.TempDir(), "new", "videos")
	for _, test := range []struct {
		name, downloadDir, folder, want string
		desktop, wantError              bool
	}{
		{name: "server default", want: root},
		{name: "server subdirectory", folder: "courses/chapter1", want: filepath.Join(root, "courses", "chapter1")},
		{name: "desktop default", desktop: true, want: root},
		{name: "desktop custom", desktop: true, downloadDir: custom, want: custom},
		{name: "desktop custom subdirectory", desktop: true, downloadDir: custom, folder: "courses", want: filepath.Join(custom, "courses")},
		{name: "server custom forbidden", downloadDir: custom, wantError: true},
		{name: "server explicit root forbidden", downloadDir: root, wantError: true},
		{name: "relative override", desktop: true, downloadDir: "videos", wantError: true},
		{name: "tilde override", desktop: true, downloadDir: "~/videos", wantError: true},
		{name: "null override", desktop: true, downloadDir: custom + "\x00", wantError: true},
		{name: "absolute folder", folder: custom, wantError: true},
		{name: "parent folder", folder: "../outside", wantError: true},
		{name: "nested escape", folder: "courses/../../outside", wantError: true},
		{name: "windows parent folder", folder: `..\outside`, wantError: true},
		{name: "windows absolute folder", folder: `C:\outside`, wantError: true},
		{name: "null folder", folder: "courses\x00", wantError: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			got, err := ResolveDownloadDirectory(root, test.downloadDir, test.folder, test.desktop)
			if test.wantError {
				if err == nil {
					t.Fatalf("expected error, got %q", got)
				}
				return
			}
			if err != nil || got != test.want {
				t.Fatalf("got %q, %v; want %q", got, err, test.want)
			}
		})
	}
	if _, err := os.Stat(custom); !os.IsNotExist(err) {
		t.Fatalf("validation created directory: %v", err)
	}
}

func TestResolveDownloadDirectoryChecksSymlinks(t *testing.T) {
	root, outside := t.TempDir(), t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "escape")); err != nil {
		t.Skipf("symlinks unavailable: %v", err)
	}
	for _, folder := range []string{"escape", "escape/not-created"} {
		if got, err := ResolveDownloadDirectory(root, "", folder, false); err == nil {
			t.Fatalf("symlink escape accepted: %q", got)
		}
	}
	inside := filepath.Join(root, "inside")
	if err := os.Mkdir(inside, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(inside, filepath.Join(root, "alias")); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveDownloadDirectory(root, "", "alias/new", false); err != nil {
		t.Fatalf("contained symlink rejected: %v", err)
	}
	rootAlias := filepath.Join(t.TempDir(), "downloads")
	if err := os.Symlink(root, rootAlias); err != nil {
		t.Fatal(err)
	}
	if _, err := ResolveDownloadDirectory(rootAlias, "", "inside/new", false); err != nil {
		t.Fatalf("configured root symlink rejected: %v", err)
	}
}
