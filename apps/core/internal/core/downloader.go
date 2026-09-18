// Package core contains the downloader service implementation
package core

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"caorushizi.cn/mediago/internal/core/parser"
	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

var (
	ErrUnsupportedType             = errors.New("unsupported download type")
	ErrDownloadOutputMissing       = errors.New("download finished without a media output")
	ErrM3U8OutputMissing           = errors.New("m3u8 download finished without a merged media file")
	ErrXiaohongshuVideoUnavailable = errors.New(
		"xiaohongshu video unavailable: this note has no video, or its signed link/session has expired; reopen the video note and click download again",
	)
)

const ytDLPOutputMarker = "__MEDIAGO_OUTPUT__:"

var completedMediaExtensions = map[string]struct{}{
	".3g2":  {},
	".3gp":  {},
	".aac":  {},
	".avi":  {},
	".f4a":  {},
	".f4b":  {},
	".f4p":  {},
	".f4v":  {},
	".flv":  {},
	".m4a":  {},
	".m4v":  {},
	".mkv":  {},
	".mov":  {},
	".mp3":  {},
	".mp4":  {},
	".mpeg": {},
	".mpg":  {},
	".rmvb": {},
	".ts":   {},
	".webm": {},
	".wmv":  {},
}

type outputFileState struct {
	size    int64
	modTime int64
}

type outputCandidate struct {
	path  string
	state outputFileState
	score int
}

// DownloaderSvc is the downloader service
type DownloaderSvc struct {
	binMap  map[DownloadType]string // mapping from download type to executable path
	runner  Runner                  // command executor
	schemas schema.SchemaList       // schema configuration list
	tracker *parser.ProgressTracker // progress throttler
	cfg     interface{}             // AppConfig
}

// NewDownloader creates a new downloader service instance
func NewDownloader(binMap map[DownloadType]string, runner Runner, schemas schema.SchemaList, cfg interface{}) *DownloaderSvc {
	return &DownloaderSvc{
		binMap:  binMap,
		runner:  runner,
		schemas: schemas,
		tracker: parser.NewTracker(),
		cfg:     cfg,
	}
}

func (d *DownloaderSvc) Config() interface{} {
	return d.cfg
}

// buildArgs builds command-line arguments from a Schema
func (d *DownloaderSvc) buildArgs(p DownloadParams, s schema.Schema) []string {
	var out []string

	// pushKV is a helper that expands key-value pairs into the argument list
	pushKV := func(keys []string, val string) {
		for _, k := range keys {
			out = append(out, k, val)
		}
	}

	// iterate over the argument mappings in the Schema
	for key, spec := range s.Args {
		switch key {
		case "url":
			// URL argument: first append the argument name, then the URL value
			if len(spec.ArgsName) > 0 {
				out = append(out, spec.ArgsName...)
			}
			downloadURL := p.URL
			if p.Type == TypeXiaohongshu {
				downloadURL = normalizeXiaohongshuURLForYTDLP(downloadURL)
			}
			out = append(out, downloadURL)

		case "localDir":
			pushKV(spec.ArgsName, d.outputDirectory(p))

		case "name":
			// File-name argument. The task-creation service already
			// runs `SanitizeFilename` before persisting `p.Name`, so
			// this path sees a filesystem-safe value. We sanitize
			// again defensively — cheap, and guards against any future
			// code path that bypasses the service layer.
			name := outputBaseName(p.Name)
			if strings.Contains(spec.Postfix, "%(") {
				// yt-dlp treats percent signs as output-template syntax. Escape
				// literal title percentages before appending our extension field.
				name = strings.ReplaceAll(name, "%", "%%")
			}
			if spec.Postfix == "@@AUTO@@" {
				// automatically infer the file extension
				name = name + "." + guessExtFromURL(p.URL)
			} else if spec.Postfix != "" {
				// append the specified postfix
				name = name + spec.Postfix
			}
			pushKV(spec.ArgsName, name)

		case "headers":
			// HTTP header argument: expand multiple values
			for _, h := range p.Headers {
				// yt-dlp warns that Cookie passed through --add-header is unsafe
				// and scopes it itself. Download writes the same browser cookies to
				// a short-lived Netscape cookie file instead.
				if isYTDLPType(p.Type) && strings.EqualFold(headerNameForLog(h), "Cookie") {
					continue
				}
				for _, k := range spec.ArgsName {
					out = append(out, k, h)
				}
			}

		case "cookie":
			if cookie := headerValue(p.Headers, "Cookie"); cookie != "" {
				pushKV(spec.ArgsName, cookie)
			}

		case "deleteSegments":
			// delete segments argument: explicitly pass true/false
			if d.cfg.(interface{ GetDeleteSegments() bool }).GetDeleteSegments() {
				pushKV(spec.ArgsName, "true")
			} else {
				pushKV(spec.ArgsName, "false")
			}

		case "proxy":
			// proxy argument: only add when proxy is configured
			if d.cfg.(interface{ GetUseProxy() bool }).GetUseProxy() {
				if proxy := d.cfg.(interface{ GetProxy() string }).GetProxy(); proxy != "" {
					pushKV(spec.ArgsName, proxy)
				}
			}

		case "ffmpegBinaryPath":
			if m3u8Binary := d.binMap[TypeM3U8]; m3u8Binary != "" {
				ffmpegName := FFmpegBinaryName
				if strings.EqualFold(filepath.Ext(m3u8Binary), ".exe") {
					ffmpegName += ".exe"
				}
				pushKV(spec.ArgsName, filepath.Join(filepath.Dir(m3u8Binary), ffmpegName))
			}

		case "__common__":
			// common arguments: expand directly
			out = append(out, spec.ArgsName...)
		}
	}

	if p.Type == TypeYoutube {
		if denoPath := d.ytDLPDenoPath(); denoPath != "" {
			out = append(out, "--js-runtimes", "deno:"+denoPath)
		}
	}

	return out
}

func isYTDLPType(downloadType DownloadType) bool {
	return downloadType == TypeYoutube || downloadType == TypeXiaohongshu
}

func appendYTDLPCookieFile(args []string, p DownloadParams) ([]string, func(), error) {
	cookieHeader := headerValue(p.Headers, "Cookie")
	if !isYTDLPType(p.Type) || cookieHeader == "" {
		return args, func() {}, nil
	}

	parsedURL, err := url.Parse(p.URL)
	if err != nil || parsedURL.Hostname() == "" {
		return nil, nil, fmt.Errorf("create yt-dlp cookie file: invalid download URL")
	}

	request := &http.Request{Header: http.Header{"Cookie": []string{cookieHeader}}}
	cookies := request.Cookies()
	if len(cookies) == 0 {
		return args, func() {}, nil
	}

	tempDir, err := os.MkdirTemp("", "mediago-ytdlp-cookies-")
	if err != nil {
		return nil, nil, fmt.Errorf("create yt-dlp cookie directory: %w", err)
	}
	cleanup := func() { _ = os.RemoveAll(tempDir) }

	secure := "FALSE"
	if strings.EqualFold(parsedURL.Scheme, "https") {
		secure = "TRUE"
	}
	var contents strings.Builder
	contents.WriteString("# Netscape HTTP Cookie File\n")
	contents.WriteString("# Generated temporarily by MediaGo.\n")
	for _, cookie := range cookies {
		fmt.Fprintf(
			&contents,
			"%s\tFALSE\t/\t%s\t0\t%s\t%s\n",
			parsedURL.Hostname(),
			secure,
			cookie.Name,
			cookie.Value,
		)
	}

	cookiePath := filepath.Join(tempDir, "cookies.txt")
	if err := os.WriteFile(cookiePath, []byte(contents.String()), 0o600); err != nil {
		cleanup()
		return nil, nil, fmt.Errorf("write yt-dlp cookie file: %w", err)
	}
	return append(args, "--cookies", cookiePath), cleanup, nil
}

func (d *DownloaderSvc) ytDLPDenoPath() string {
	ytDLPPath := d.binMap[TypeYoutube]
	if ytDLPPath == "" {
		return ""
	}

	denoName := DenoBinaryName
	if strings.EqualFold(filepath.Ext(ytDLPPath), ".exe") {
		denoName += ".exe"
	}
	return filepath.Join(filepath.Dir(ytDLPPath), denoName)
}

func headerValue(headers []string, name string) string {
	for _, header := range headers {
		key, value, found := strings.Cut(header, ":")
		if found && strings.EqualFold(strings.TrimSpace(key), name) {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

const redactedLogValue = "[REDACTED]"

func headerNameForLog(header string) string {
	name, _, found := strings.Cut(header, ":")
	name = strings.TrimSpace(name)
	if !found || name == "" {
		return redactedLogValue
	}
	for i := 0; i < len(name); i++ {
		char := name[i]
		if (char >= 'a' && char <= 'z') ||
			(char >= 'A' && char <= 'Z') ||
			(char >= '0' && char <= '9') ||
			strings.ContainsRune("!#$%&'*+-.^_`|~", rune(char)) {
			continue
		}
		return redactedLogValue
	}

	return name
}

func headerNamesForLog(headers []string) []string {
	names := make([]string, 0, len(headers))
	for _, header := range headers {
		names = append(names, headerNameForLog(header))
	}
	return names
}

type downloaderProxyConfig interface {
	GetUseProxy() bool
	GetProxy() string
}

func proxyConfiguredForLog(cfg interface{}) bool {
	if cfg == nil {
		return false
	}
	value := reflect.ValueOf(cfg)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice, reflect.UnsafePointer:
		if value.IsNil() {
			return false
		}
	}
	proxyCfg, ok := cfg.(downloaderProxyConfig)
	return ok && proxyCfg.GetUseProxy() && proxyCfg.GetProxy() != ""
}

func urlOriginForLog(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.Opaque != "" {
		return redactedLogValue
	}
	return (&url.URL{Scheme: parsed.Scheme, Host: parsed.Host}).String()
}

func (d *DownloaderSvc) outputDirectory(p DownloadParams) string {
	dir := d.cfg.(interface{ GetLocalDir() string }).GetLocalDir()
	if p.DownloadDir != "" {
		dir = filepath.Clean(p.DownloadDir)
	}
	if p.Folder != "" {
		dir = filepath.Join(dir, p.Folder)
	}
	return dir
}

func outputBaseName(name string) string {
	safeName := SanitizeFilename(name)
	ext := filepath.Ext(safeName)
	if _, ok := completedMediaExtensions[strings.ToLower(ext)]; ok {
		return strings.TrimSuffix(safeName, ext)
	}
	return safeName
}

func captureOutputFiles(dir, downloadName string) (map[string]outputFileState, error) {
	result := make(map[string]outputFileState)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return nil, err
	}

	name := outputBaseName(downloadName)
	for _, entry := range entries {
		if entry.IsDir() {
			if entry.Name() != name {
				continue
			}
			root := filepath.Join(dir, entry.Name())
			walkErr := filepath.WalkDir(root, func(path string, nested os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return walkErr
				}
				if nested.IsDir() {
					return nil
				}
				info, infoErr := nested.Info()
				if infoErr != nil {
					return infoErr
				}
				if !info.Mode().IsRegular() || info.Size() == 0 || !hasCompletedMediaExtension(path) {
					return nil
				}
				relative, relativeErr := filepath.Rel(dir, path)
				if relativeErr != nil {
					return relativeErr
				}
				result[relative] = outputFileState{size: info.Size(), modTime: info.ModTime().UnixNano()}
				return nil
			})
			if walkErr != nil {
				return nil, walkErr
			}
			continue
		}
		if !isOutputFilename(entry.Name(), name) {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		if !info.Mode().IsRegular() || info.Size() == 0 {
			continue
		}
		result[entry.Name()] = outputFileState{
			size:    info.Size(),
			modTime: info.ModTime().UnixNano(),
		}
	}
	return result, nil
}

func isOutputFilename(filename, downloadName string) bool {
	if filename == downloadName {
		return true
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if _, ok := completedMediaExtensions[ext]; !ok {
		return false
	}
	base := strings.TrimSuffix(filename, filepath.Ext(filename))
	return base == downloadName || strings.HasPrefix(base, downloadName+".")
}

func hasCompletedMediaExtension(path string) bool {
	_, ok := completedMediaExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}

func outputCandidateScore(path, downloadName string) int {
	filename := filepath.Base(path)
	if filename == outputBaseName(downloadName) {
		return 350
	}

	switch strings.ToLower(filepath.Ext(filename)) {
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

func changedOutputCandidates(dir, downloadName string, before, after map[string]outputFileState) []outputCandidate {
	candidates := make([]outputCandidate, 0, len(after))
	for relative, state := range after {
		if previous, ok := before[relative]; ok && previous == state {
			continue
		}
		candidates = append(candidates, outputCandidate{
			path:  filepath.Join(dir, relative),
			state: state,
			score: outputCandidateScore(relative, downloadName),
		})
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].score != candidates[j].score {
			return candidates[i].score > candidates[j].score
		}
		if candidates[i].state.size != candidates[j].state.size {
			return candidates[i].state.size > candidates[j].state.size
		}
		return candidates[i].path < candidates[j].path
	})
	return candidates
}

func normalizeReportedOutputPath(outputDir, reported string) string {
	reported = trimMatchingQuotes(reported)
	if reported == "" {
		return ""
	}
	if !filepath.IsAbs(reported) {
		reported = filepath.Join(outputDir, reported)
	}
	absolute, err := filepath.Abs(reported)
	if err != nil {
		return ""
	}
	absoluteDir, err := filepath.Abs(outputDir)
	if err != nil {
		return ""
	}
	relative, err := filepath.Rel(absoluteDir, absolute)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return ""
	}
	info, err := os.Stat(absolute)
	if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
		return ""
	}
	return filepath.Clean(absolute)
}

func trimMatchingQuotes(value string) string {
	value = strings.TrimSpace(value)
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}

func outputArtifactPaths(outputDir, downloadName, reported string, before, after map[string]outputFileState, topLevelOnly bool) []string {
	artifacts := make([]string, 0)
	seen := make(map[string]struct{})
	appendArtifact := func(candidate string) {
		if candidate == "" {
			return
		}
		candidate = filepath.Clean(candidate)
		if topLevelOnly && !isTopLevelOutputPath(outputDir, candidate) {
			return
		}
		if _, ok := seen[candidate]; ok {
			return
		}
		seen[candidate] = struct{}{}
		artifacts = append(artifacts, candidate)
	}

	appendArtifact(normalizeReportedOutputPath(outputDir, reported))
	for _, candidate := range changedOutputCandidates(outputDir, downloadName, before, after) {
		absolute, err := filepath.Abs(candidate.path)
		if err != nil {
			continue
		}
		appendArtifact(absolute)
	}
	return artifacts
}

func isTopLevelOutputPath(outputDir, candidate string) bool {
	absoluteDir, err := filepath.Abs(outputDir)
	if err != nil {
		return false
	}
	absoluteCandidate, err := filepath.Abs(candidate)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(absoluteDir, absoluteCandidate)
	return err == nil && relative != "." && filepath.Dir(relative) == "."
}

func outputPathFromLine(line string) string {
	markerIndex := strings.LastIndex(line, ytDLPOutputMarker)
	if markerIndex == -1 {
		return ""
	}
	path := line[markerIndex+len(ytDLPOutputMarker):]
	if end := strings.IndexAny(path, "\r\n"); end >= 0 {
		path = path[:end]
	}
	return strings.TrimSpace(path)
}

// SanitizeFilename strips or replaces characters that filesystems — chiefly
// Windows — reject or misinterpret when they appear in a filename. It is
// intentionally aggressive enough to be safe across Windows, macOS, and
// Linux:
//
//   - Reserved path / wildcard characters: \ / : * ? " < > |
//   - ASCII control characters (0x00–0x1F)
//   - Trailing dots and spaces (Windows strips them silently at create time,
//     producing a name that doesn't match what was requested)
//
// Illegal characters collapse to a single underscore. The result is never
// empty — if every character was illegal we fall back to "download".
//
// Exported so the task-creation service can sanitize once at persist time;
// buildArgs then sees an already-safe value and the downloader command-line,
// the DB row, and the post-download "file exists?" check all agree on the
// same filename.
func SanitizeFilename(name string) string {
	if name == "" {
		return "download"
	}

	var b strings.Builder
	b.Grow(len(name))
	for _, r := range name {
		switch {
		case r < 0x20:
			// control char → drop
		case r == '\\' || r == '/' || r == ':' || r == '*' || r == '?' ||
			r == '"' || r == '<' || r == '>' || r == '|':
			b.WriteRune('_')
		default:
			b.WriteRune(r)
		}
	}

	cleaned := strings.TrimRight(b.String(), ". ")
	if cleaned == "" {
		return "download"
	}
	return cleaned
}

// guessExtFromURL infers the file extension from a URL
func guessExtFromURL(u string) string {
	l := strings.ToLower(u)
	switch {
	case strings.Contains(l, ".m3u8"):
		return "m3u8"
	case strings.Contains(l, ".mp4"):
		return "mp4"
	case strings.Contains(l, ".flv"):
		return "flv"
	case strings.Contains(l, ".mkv"):
		return "mkv"
	default:
		return "mp4"
	}
}

// Download executes a download task
func (d *DownloaderSvc) Download(ctx context.Context, p DownloadParams, cb Callbacks) (DownloadResult, error) {
	logger.Info("Starting download task",
		zap.String("id", string(p.ID)),
		zap.String("type", string(p.Type)),
		zap.String("url_origin", urlOriginForLog(p.URL)))

	// get the Schema for the corresponding download type
	schema, ok := d.schemas.GetByType(string(p.Type))
	if !ok {
		logger.Error("Unsupported download type",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)))
		return DownloadResult{}, fmt.Errorf("%w: %q", ErrUnsupportedType, p.Type)
	}

	// get the executable path for the corresponding download type
	bin, ok := d.binMap[p.Type]
	if !ok || bin == "" {
		logger.Error("Binary not configured for download type",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)))
		return DownloadResult{}, fmt.Errorf("binary not configured for type %q", p.Type)
	}

	// check if the binary file actually exists on disk
	if _, statErr := os.Stat(bin); statErr != nil {
		logger.Error("Binary file not found on disk",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)),
			zap.String("binary", bin),
			zap.Error(statErr))
		tool := filepath.Base(bin)
		if extension := filepath.Ext(tool); strings.EqualFold(extension, ".exe") {
			tool = strings.TrimSuffix(tool, extension)
		}
		return DownloadResult{}, &DependencyError{
			Tool:         tool,
			ExpectedPath: bin,
			Err:          statErr,
		}
	}

	logger.Debug("Using downloader binary",
		zap.String("id", string(p.ID)),
		zap.String("binary", bin))

	desktopConfig, hasDesktopConfig := d.cfg.(interface{ IsDesktop() bool })
	outputDir, err := ResolveDownloadDirectory(
		d.cfg.(interface{ GetLocalDir() string }).GetLocalDir(), p.DownloadDir, p.Folder,
		hasDesktopConfig && desktopConfig.IsDesktop(),
	)
	if err != nil {
		return DownloadResult{}, err
	}
	outputBefore, inspectErr := captureOutputFiles(outputDir, p.Name)
	if inspectErr != nil {
		return DownloadResult{}, fmt.Errorf("inspect output directory before download: %w", inspectErr)
	}

	// create a console line parser
	lp, err := parser.NewLineParser(schema.ConsoleReg)
	if err != nil {
		logger.Error("Failed to create line parser",
			zap.String("id", string(p.ID)),
			zap.Error(err))
		return DownloadResult{}, err
	}

	// build command-line arguments
	args := d.buildArgs(p, schema)
	args, cleanupCookies, err := appendYTDLPCookieFile(args, p)
	if err != nil {
		return DownloadResult{}, err
	}
	defer cleanupCookies()
	logger.Debug("Command arguments built",
		zap.String("id", string(p.ID)),
		zap.Int("arg_count", len(args)),
		zap.String("url_origin", urlOriginForLog(p.URL)),
		zap.Strings("header_names", headerNamesForLog(p.Headers)),
		zap.Bool("proxy_configured", proxyConfiguredForLog(d.cfg)))

	// initialize parse state
	st := &parser.ParseState{}
	var liveDetected atomic.Bool
	var reportedOutput string
	var sawXiaohongshuNoVideoFormats bool
	var reportedOutputMu sync.Mutex

	// process console output line by line
	onLine := func(line string) {
		if output := outputPathFromLine(line); output != "" {
			reportedOutputMu.Lock()
			reportedOutput = output
			reportedOutputMu.Unlock()
		}
		if p.Type == TypeXiaohongshu && strings.Contains(line, "No video formats found") {
			reportedOutputMu.Lock()
			sawXiaohongshuNoVideoFormats = true
			reportedOutputMu.Unlock()
		}
		line = strings.TrimSpace(line)

		// emit message event
		if cb.OnMessage != nil {
			cb.OnMessage(MessageEvent{ID: p.ID, Message: line})
		}

		// parse console output
		evt, errStr := lp.Parse(line, st)
		if st.IsLive {
			liveDetected.Store(true)
		}
		if errStr != "" {
			logger.Warn("Parse error in download output",
				zap.String("id", string(p.ID)),
				zap.String("error", errStr))
		}

		// handle ready event
		if evt == "ready" {
			st.Ready = true
			logger.Info("Download ready",
				zap.String("id", string(p.ID)),
				zap.Bool("isLive", st.IsLive))
			if cb.OnProgress != nil {
				cb.OnProgress(ProgressEvent{
					ID:     p.ID,
					Type:   "ready",
					IsLive: st.IsLive,
				})
			}
		}

		// handle progress updates (applying throttle strategy)
		if st.Ready && (st.Percent > 0 || st.Speed != "") {
			if cb.OnProgress != nil && d.tracker.ShouldUpdate(parser.TaskID(p.ID)) {
				logger.Debug("Download progress",
					zap.String("id", string(p.ID)),
					zap.Float64("percent", st.Percent),
					zap.String("speed", st.Speed))
				cb.OnProgress(ProgressEvent{
					ID:      p.ID,
					Type:    "progress",
					Percent: st.Percent,
					Speed:   st.Speed,
					IsLive:  st.IsLive,
				})
				d.tracker.Update(parser.TaskID(p.ID))
			}
		}
	}

	// execute the command
	logger.Info("Executing download command",
		zap.String("id", string(p.ID)),
		zap.String("binary", bin))
	if configurable, ok := d.runner.(ConfigurableRunner); ok {
		err = configurable.RunWithOptions(ctx, bin, args, onLine, RunnerOptions{
			ShouldGracefullyStop: liveDetected.Load,
			GracePeriod:          8 * time.Second,
		})
	} else {
		err = d.runner.Run(ctx, bin, args, onLine)
	}

	// clean up progress records
	d.tracker.Remove(parser.TaskID(p.ID))

	collectResult := func(recoverLiveSegments bool) (DownloadResult, error) {
		outputAfter, inspectErr := captureOutputFiles(outputDir, p.Name)
		if inspectErr != nil {
			return DownloadResult{}, fmt.Errorf("inspect output directory after download: %w", inspectErr)
		}
		reportedOutputMu.Lock()
		reported := reportedOutput
		reportedOutputMu.Unlock()
		artifactPaths := outputArtifactPaths(outputDir, p.Name, reported, outputBefore, outputAfter, p.Type == TypeM3U8)
		if len(artifactPaths) == 0 {
			if p.Type == TypeM3U8 {
				if recoverLiveSegments {
					recoveredPath, recoverErr := recoverLiveM3U8Segments(outputDir, p.Name)
					if recoverErr == nil {
						return DownloadResult{
							PrimaryPath:       recoveredPath,
							ArtifactPaths:     []string{recoveredPath},
							RecoveredSegments: true,
						}, nil
					}
					if !errors.Is(recoverErr, ErrM3U8OutputMissing) {
						return DownloadResult{}, recoverErr
					}
				}
				return DownloadResult{}, ErrM3U8OutputMissing
			}
			return DownloadResult{}, ErrDownloadOutputMissing
		}
		return DownloadResult{PrimaryPath: artifactPaths[0], ArtifactPaths: artifactPaths}, nil
	}

	if err != nil {
		reportedOutputMu.Lock()
		xiaohongshuVideoUnavailable := sawXiaohongshuNoVideoFormats
		reportedOutputMu.Unlock()
		if xiaohongshuVideoUnavailable {
			logger.Error("Xiaohongshu note did not expose a video stream",
				zap.String("id", string(p.ID)))
			return DownloadResult{}, ErrXiaohongshuVideoUnavailable
		}
		if liveDetected.Load() {
			result, finalizeErr := collectResult(true)
			switch {
			case finalizeErr == nil:
				if errors.Is(err, context.Canceled) {
					logger.Info("Live recording stopped and saved",
						zap.String("id", string(p.ID)),
						zap.Bool("recovered_segments", result.RecoveredSegments))
					result.FinalizedAfterStop = true
				} else {
					logger.Warn("Live downloader exited with an error; saved the completed recording",
						zap.String("id", string(p.ID)),
						zap.Bool("recovered_segments", result.RecoveredSegments),
						zap.Error(err))
					result.RecoveredAfterError = true
				}
				return result, nil
			case errors.Is(err, context.Canceled) && errors.Is(finalizeErr, ErrM3U8OutputMissing):
				logger.Info("Live recording stopped before a media file was created",
					zap.String("id", string(p.ID)))
				return DownloadResult{}, err
			default:
				logger.Error("Live recording finalization failed",
					zap.String("id", string(p.ID)),
					zap.Error(finalizeErr))
				if errors.Is(finalizeErr, ErrM3U8OutputMissing) {
					return DownloadResult{}, err
				}
				if errors.Is(err, context.Canceled) {
					return DownloadResult{}, finalizeErr
				}
				return DownloadResult{}, errors.Join(err, finalizeErr)
			}
		}
		logger.Error("Download failed",
			zap.String("id", string(p.ID)),
			zap.Error(err))
		return DownloadResult{}, err
	}

	result, resultErr := collectResult(liveDetected.Load())
	if resultErr != nil {
		if errors.Is(resultErr, ErrM3U8OutputMissing) {
			logger.Error("M3U8 downloader exited without creating a merged media file",
				zap.String("id", string(p.ID)))
		} else if errors.Is(resultErr, ErrDownloadOutputMissing) {
			logger.Error("Downloader exited without creating a media file",
				zap.String("id", string(p.ID)),
				zap.String("type", string(p.Type)))
		}
		return DownloadResult{}, resultErr
	}

	logger.Info("Download completed successfully",
		zap.String("id", string(p.ID)),
		zap.Bool("recovered_segments", result.RecoveredSegments))
	return result, nil
}
