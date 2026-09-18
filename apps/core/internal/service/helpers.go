package service

import (
	"context"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// videoExtensions is the list of video file extensions (aligned with the TypeScript videoPattern).
var videoExtensions = []string{
	"mp4", "flv", "avi", "rmvb", "wmv", "mov", "mkv", "webm",
	"mpeg", "mpg", "m4v", "3gp", "3g2", "f4v", "f4p", "f4a", "f4b",
	"ts", "m4a", "mp3", "aac",
}

var videoExtensionSet = func() map[string]struct{} {
	result := make(map[string]struct{}, len(videoExtensions))
	for _, ext := range videoExtensions {
		result["."+ext] = struct{}{}
	}
	return result
}()

var titleRegexp = regexp.MustCompile(`(?i)<title[^>]*>(.*?)</title>`)

const randomChars = "abcdefghijklmnopqrstuvwxyz0123456789"

// RandomName generates a name in the format "YYYYMMDD-<10 random characters>".
func RandomName() string {
	now := time.Now()
	prefix := now.Format("20060102")
	b := make([]byte, 10)
	for i := range b {
		b[i] = randomChars[rand.Intn(len(randomChars))]
	}
	return fmt.Sprintf("%s-%s", prefix, string(b))
}

// GetPageTitle fetches the page title via an HTTP GET request.
func GetPageTitle(pageURL string, fallback string) string {
	return GetPageTitleWithContext(context.Background(), pageURL, fallback)
}

// GetPageTitleWithContext stops the request when its caller is cancelled.
func GetPageTitleWithContext(ctx context.Context, pageURL string, fallback string) string {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequestWithContext(ctx, "GET", pageURL, nil)
	if err != nil {
		return fallback
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
	req.Header.Set("Referer", pageURL)

	resp, err := client.Do(req)
	if err != nil {
		return fallback
	}
	defer resp.Body.Close()

	// Read only the first 64KB to find the title
	body, err := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	if err != nil {
		return fallback
	}

	matches := titleRegexp.FindSubmatch(body)
	if len(matches) >= 2 {
		title := strings.TrimSpace(string(matches[1]))
		if title != "" {
			return title
		}
	}

	return fallback
}

func hasVideoExtension(path string) bool {
	_, ok := videoExtensionSet[strings.ToLower(filepath.Ext(path))]
	return ok
}

func outputBaseName(name string) string {
	ext := filepath.Ext(name)
	if _, ok := videoExtensionSet[strings.ToLower(ext)]; ok {
		return strings.TrimSuffix(name, ext)
	}
	return name
}

func outputNameMatches(filename, name string) bool {
	expected := outputBaseName(filepath.Base(name))
	if filename == name || filename == expected {
		return true
	}
	ext := filepath.Ext(filename)
	if _, ok := videoExtensionSet[strings.ToLower(ext)]; !ok {
		return false
	}
	stem := strings.TrimSuffix(filename, ext)
	return stem == name || stem == expected || strings.HasPrefix(stem, expected+".")
}

type existingOutputCandidate struct {
	path  string
	score int
	size  int64
}

func mediaCandidateScore(path string) int {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv", ".m4v", ".mpeg", ".mpg", ".wmv", ".rmvb", ".f4v", ".3gp", ".3g2":
		return 300
	case ".m4a", ".mp3", ".aac", ".f4a", ".f4b":
		return 200
	case ".ts":
		return 100
	default:
		return 0
	}
}

// ResolveOutputPath validates a persisted artifact path and, for historical
// directory outputs, resolves the best playable media file inside it.
// Extensionless regular files are valid because older yt-dlp tasks produced
// exactly that shape.
func ResolveOutputPath(path string) (bool, string) {
	if strings.TrimSpace(path) == "" {
		return false, ""
	}
	absolute, err := filepath.Abs(path)
	if err != nil {
		return false, ""
	}
	info, err := os.Stat(absolute)
	if err != nil {
		return false, ""
	}
	if info.Mode().IsRegular() {
		if info.Size() == 0 {
			return false, ""
		}
		return true, filepath.Clean(absolute)
	}
	if !info.IsDir() {
		return false, ""
	}

	candidates := make([]existingOutputCandidate, 0)
	err = filepath.WalkDir(absolute, func(candidatePath string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !hasVideoExtension(candidatePath) {
			return nil
		}
		candidateInfo, infoErr := entry.Info()
		if infoErr != nil {
			return infoErr
		}
		if !candidateInfo.Mode().IsRegular() || candidateInfo.Size() == 0 {
			return nil
		}
		candidates = append(candidates, existingOutputCandidate{
			path:  candidatePath,
			score: mediaCandidateScore(candidatePath),
			size:  candidateInfo.Size(),
		})
		return nil
	})
	if err != nil || len(candidates) == 0 {
		return false, ""
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].size != candidates[j].size {
			return candidates[i].size > candidates[j].size
		}
		return candidates[i].path < candidates[j].path
	})
	return true, filepath.Clean(candidates[0].path)
}

// CheckFileExists locates a historical task by its display name. It scans
// literal directory entries instead of using filepath.Glob, so names that
// contain brackets or other glob metacharacters are handled correctly.
func CheckFileExists(name, localPath string) (bool, string) {
	if strings.TrimSpace(localPath) == "" {
		return false, ""
	}
	name = filepath.Base(name)
	expected := outputBaseName(name)
	exactNames := []string{name}
	if expected != name {
		exactNames = append(exactNames, expected)
	}
	for _, exactName := range exactNames {
		if exists, path := ResolveOutputPath(filepath.Join(localPath, exactName)); exists {
			return true, path
		}
	}

	entries, err := os.ReadDir(localPath)
	if err != nil {
		return false, ""
	}
	candidates := make([]existingOutputCandidate, 0)
	for _, entry := range entries {
		if entry.IsDir() || !outputNameMatches(entry.Name(), name) {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			continue
		}
		score := mediaCandidateScore(entry.Name())
		stem := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		if stem == name || stem == expected {
			score += 100
		}
		candidates = append(candidates, existingOutputCandidate{
			path:  filepath.Join(localPath, entry.Name()),
			score: score,
			size:  info.Size(),
		})
	}
	if len(candidates) == 0 {
		return false, ""
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].size != candidates[j].size {
			return candidates[i].size > candidates[j].size
		}
		return candidates[i].path < candidates[j].path
	})
	absolute, err := filepath.Abs(candidates[0].path)
	if err != nil {
		return false, ""
	}
	return true, filepath.Clean(absolute)
}

func trimLoggedPath(value string) string {
	value = strings.TrimSpace(value)
	value = strings.TrimPrefix(value, "[download] ")
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

func loggedOutputPath(line string) string {
	if marker := strings.LastIndex(line, "__MEDIAGO_OUTPUT__:"); marker >= 0 {
		return trimLoggedPath(line[marker+len("__MEDIAGO_OUTPUT__:"):])
	}
	for _, label := range []string{"Merging formats into ", "Destination: ", "保存文件名:", "保存文件名："} {
		if index := strings.LastIndex(line, label); index >= 0 {
			return trimLoggedPath(line[index+len(label):])
		}
	}
	if end := strings.LastIndex(line, " has already been downloaded"); end >= 0 {
		return trimLoggedPath(line[:end])
	}
	return ""
}

func loggedPathMatchesTask(path, name string) bool {
	name = filepath.Base(name)
	base := filepath.Base(path)
	if outputNameMatches(base, name) {
		return true
	}
	parent := filepath.Base(filepath.Dir(path))
	return parent == name || parent == outputBaseName(name)
}

// ResolveOutputPathFromLog recovers the artifact identity of a historical
// task from downloader diagnostics. Lines are scanned newest-first so a final
// merged yt-dlp path wins over earlier temporary destinations.
func ResolveOutputPathFromLog(content, name, fallbackDir string) (bool, string) {
	lines := strings.Split(strings.ReplaceAll(content, "\r\n", "\n"), "\n")
	for index := len(lines) - 1; index >= 0; index-- {
		candidate := loggedOutputPath(lines[index])
		if candidate == "" {
			continue
		}
		if !filepath.IsAbs(candidate) {
			if fallbackDir == "" {
				continue
			}
			candidate = filepath.Join(fallbackDir, candidate)
		}
		if !loggedPathMatchesTask(candidate, name) {
			continue
		}
		if exists, path := ResolveOutputPath(candidate); exists {
			return true, path
		}
	}

	return false, ""
}
