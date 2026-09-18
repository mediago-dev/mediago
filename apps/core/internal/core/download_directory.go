package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var (
	ErrCustomDownloadDirectory  = errors.New("downloadDir is only supported by the desktop app; Docker/server downloads use the configured download directory")
	ErrInvalidDownloadDirectory = errors.New("downloadDir must be an absolute directory path")
	ErrInvalidDownloadFolder    = errors.New("folder must be a relative subdirectory within the download directory")
)

// ResolveDownloadDirectory validates a task's location without creating it.
// Existing symlinks in folder must stay within the selected download root.
func ResolveDownloadDirectory(defaultDir, downloadDir, folder string, desktop bool) (string, error) {
	root := defaultDir
	if downloadDir != "" {
		if !desktop {
			return "", ErrCustomDownloadDirectory
		}
		if !filepath.IsAbs(downloadDir) || strings.ContainsRune(downloadDir, '\x00') {
			return "", ErrInvalidDownloadDirectory
		}
		root = filepath.Clean(downloadDir)
	}
	// Interpret both separators for validation so Windows-style traversal is
	// also rejected by Linux servers.
	portableFolder := strings.ReplaceAll(folder, "\\", "/")
	if folder != "" && (!filepath.IsLocal(portableFolder) || strings.ContainsAny(portableFolder, ":\x00")) {
		return "", ErrInvalidDownloadFolder
	}
	dir := root
	if folder != "" {
		dir = filepath.Join(root, folder)
	}
	resolvedRoot, err := resolveExistingDirectory(root)
	if err != nil {
		return "", fmt.Errorf("resolve download directory: %w", err)
	}
	resolvedDir, err := resolveExistingDirectory(dir)
	if err != nil {
		return "", fmt.Errorf("resolve download subdirectory: %w", err)
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedDir)
	if err != nil || !filepath.IsLocal(relative) {
		return "", ErrInvalidDownloadFolder
	}
	return dir, nil
}

// Resolve the closest existing ancestor so a new nested directory can be
// validated without losing symlink information from its existing parents.
func resolveExistingDirectory(dir string) (string, error) {
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err == nil {
		info, statErr := os.Stat(resolved)
		if statErr != nil {
			return "", statErr
		}
		if !info.IsDir() {
			return "", errors.New("download location is not a directory")
		}
		return resolved, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	if _, linkErr := os.Lstat(absolute); linkErr == nil {
		return "", err // Reject dangling symlinks.
	}
	parent := filepath.Dir(absolute)
	if parent == absolute {
		return "", err
	}
	resolvedParent, err := resolveExistingDirectory(parent)
	if err != nil {
		return "", err
	}
	return filepath.Join(resolvedParent, filepath.Base(absolute)), nil
}
