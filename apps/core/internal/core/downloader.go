// Package core contains the downloader service implementation
package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"caorushizi.cn/mediago/internal/core/parser"
	"caorushizi.cn/mediago/internal/core/schema"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

var (
	ErrUnsupportedType = errors.New("unsupported download type")
)

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
			out = append(out, p.URL)

		case "localDir":
			// local directory argument: may need to join with subdirectory
			final := d.cfg.(interface{ GetLocalDir() string }).GetLocalDir()
			if p.Folder != "" {
				final = filepath.Join(final, p.Folder)
			}
			pushKV(spec.ArgsName, final)

		case "name":
			// File-name argument. The task-creation service already
			// runs `SanitizeFilename` before persisting `p.Name`, so
			// this path sees a filesystem-safe value. We sanitize
			// again defensively — cheap, and guards against any future
			// code path that bypasses the service layer.
			name := SanitizeFilename(p.Name)
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

		case "__common__":
			// common arguments: expand directly
			out = append(out, spec.ArgsName...)
		}
	}

	return out
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

func redactSensitiveArgs(args []string) []string {
	redacted := append([]string(nil), args...)
	for i, arg := range redacted {
		switch {
		case arg == "--cookie" || arg == "-c":
			if i+1 < len(redacted) {
				redacted[i+1] = "[REDACTED]"
			}
		case strings.HasPrefix(arg, "--cookie="):
			redacted[i] = "--cookie=[REDACTED]"
		}
	}
	return redacted
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
func (d *DownloaderSvc) Download(ctx context.Context, p DownloadParams, cb Callbacks) error {
	logger.Info("Starting download task",
		zap.String("id", string(p.ID)),
		zap.String("type", string(p.Type)),
		zap.String("url", p.URL),
		zap.String("name", p.Name))

	// get the Schema for the corresponding download type
	schema, ok := d.schemas.GetByType(string(p.Type))
	if !ok {
		logger.Error("Unsupported download type",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)))
		return fmt.Errorf("%w: %q", ErrUnsupportedType, p.Type)
	}

	// get the executable path for the corresponding download type
	bin, ok := d.binMap[p.Type]
	if !ok || bin == "" {
		logger.Error("Binary not configured for download type",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)))
		return fmt.Errorf("binary not configured for type %q", p.Type)
	}

	// check if the binary file actually exists on disk
	if _, statErr := os.Stat(bin); statErr != nil {
		logger.Error("Binary file not found on disk",
			zap.String("id", string(p.ID)),
			zap.String("type", string(p.Type)),
			zap.String("binary", bin),
			zap.Error(statErr))
		return fmt.Errorf("binary %q not found for type %q: %w", bin, p.Type, statErr)
	}

	logger.Debug("Using downloader binary",
		zap.String("id", string(p.ID)),
		zap.String("binary", bin))

	// create a console line parser
	lp, err := parser.NewLineParser(schema.ConsoleReg)
	if err != nil {
		logger.Error("Failed to create line parser",
			zap.String("id", string(p.ID)),
			zap.Error(err))
		return err
	}

	// build command-line arguments
	args := d.buildArgs(p, schema)
	logger.Debug("Command arguments built",
		zap.String("id", string(p.ID)),
		zap.Strings("args", redactSensitiveArgs(args)))

	// initialize parse state
	st := &parser.ParseState{}

	// process console output line by line
	onLine := func(line string) {
		line = strings.TrimSpace(line)

		// emit message event
		if cb.OnMessage != nil {
			cb.OnMessage(MessageEvent{ID: p.ID, Message: line})
		}

		// parse console output
		evt, errStr := lp.Parse(line, st)
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
	err = d.runner.Run(ctx, bin, args, onLine)

	// clean up progress records
	d.tracker.Remove(parser.TaskID(p.ID))

	if err != nil {
		logger.Error("Download failed",
			zap.String("id", string(p.ID)),
			zap.Error(err))
		return err
	}

	logger.Info("Download completed successfully",
		zap.String("id", string(p.ID)))
	return nil
}
