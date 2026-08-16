// Package schema contains the Schema configuration loading logic
package schema

import (
	"encoding/json"
	"os"

	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

// ArgSpec defines the specification for a command-line argument
type ArgSpec struct {
	ArgsName []string `json:"argsName"`          // list of command-line argument names
	Postfix  string   `json:"postfix,omitempty"` // postfix (e.g. @@AUTO@@ means auto-infer extension)
}

// ConsoleReg holds the regular expression configuration for console output parsing
type ConsoleReg struct {
	Percent string `json:"percent"` // regex for progress percentage
	Speed   string `json:"speed"`   // regex for download speed
	Error   string `json:"error"`   // regex for error indicator
	Start   string `json:"start"`   // regex for download start indicator
	IsLive  string `json:"isLive"`  // regex for live stream indicator
}

// Schema is the configuration schema for a download type
type Schema struct {
	Type       string             `json:"type"`       // download type
	Args       map[string]ArgSpec `json:"args"`       // argument mapping table
	ConsoleReg ConsoleReg         `json:"consoleReg"` // console parsing rules
}

// SchemaList is a container for a list of Schemas
type SchemaList struct {
	Schemas []Schema `json:"schemas"` // schemas for all download types
}

// GetByType retrieves the Schema corresponding to the given download type
func (sl SchemaList) GetByType(t string) (Schema, bool) {
	for _, s := range sl.Schemas {
		if s.Type == t {
			return s, true
		}
	}
	return Schema{}, false
}

// DefaultSchemas returns the built-in default Schema configuration, kept in sync with the Node.js config.json.
func DefaultSchemas() SchemaList {
	return SchemaList{
		Schemas: []Schema{
			{
				Type: "m3u8",
				Args: map[string]ArgSpec{
					"url":              {ArgsName: []string{}},
					"localDir":         {ArgsName: []string{"--tmp-dir", "--save-dir"}},
					"name":             {ArgsName: []string{"--save-name"}},
					"headers":          {ArgsName: []string{"--header"}},
					"deleteSegments":   {ArgsName: []string{"--del-after-done"}},
					"proxy":            {ArgsName: []string{"--custom-proxy"}},
					"ffmpegBinaryPath": {ArgsName: []string{"--ffmpeg-binary-path"}},
					"__common__":       {ArgsName: []string{"--no-log", "--auto-select", "--ui-language", "zh-CN", "--live-real-time-merge", "--use-ffmpeg-concat-demuxer", "--check-segments-count", "false"}},
				},
				ConsoleReg: ConsoleReg{
					Percent: `([\d.]+)%`,
					Speed:   `([\d.]+[GMK]Bps)`,
					Error:   "ERROR",
					Start:   "保存文件名:",
					IsLive:  "检测到直播流",
				},
			},
			{
				Type: "bilibili",
				Args: map[string]ArgSpec{
					"url":        {ArgsName: []string{}},
					"localDir":   {ArgsName: []string{"--work-dir"}},
					"name":       {ArgsName: []string{"--file-pattern"}},
					"cookie":     {ArgsName: []string{"--cookie"}},
					"__common__": {ArgsName: []string{"--encoding-priority", "avc,hevc,av1"}},
				},
				ConsoleReg: ConsoleReg{
					Percent: `([\d.]+)%`,
					Speed:   `([\d.]+\s[GMK]B/s)`,
					Error:   "",
					Start:   "开始下载",
					IsLive:  "",
				},
			},
			{
				// Direct downloads use the pinned aria2-next release fetched during
				// dependency provisioning. It retains aria2's CLI and output
				// compatibility, including the -x/-s/-k short options below.
				Type: "direct",
				Args: map[string]ArgSpec{
					"localDir": {ArgsName: []string{"-d"}},                      // download directory
					"name":     {ArgsName: []string{"-o"}, Postfix: "@@AUTO@@"}, // output filename
					"url":      {ArgsName: []string{}},
					"__common__": {ArgsName: []string{
						"-x", "16", // max-connection-per-server
						"-s", "16", // split
						"-k", "1M", // min-split-size
						"--console-log-level=info",   // keep readout line above the noise
						"--summary-interval=1",       // emit a progress line every second
						"--allow-overwrite=true",     // re-runs overwrite the previous file
						"--auto-file-renaming=false", // never silently rename when -o conflicts
					}},
				},
				ConsoleReg: ConsoleReg{
					// aria2 summary line looks like:
					//   [#abc 1.5MiB/1.8MiB(83%) CN:2 DL:512KiB ETA:2s]
					Percent: `\((\d+)%\)`,
					Speed:   `DL:(\S+)`, // e.g. "DL:512KiB"; shown as-is in the UI
					Error:   `errorCode=\d+|exception`,
					Start:   `Download (started|Results:)`,
					IsLive:  ``, // direct downloads never have a live-stream phase
				},
			},
			{
				Type: "youtube",
				Args: map[string]ArgSpec{
					"url":        {ArgsName: []string{}},
					"localDir":   {ArgsName: []string{"-P"}},
					"name":       {ArgsName: []string{"-o"}},
					"headers":    {ArgsName: []string{"--add-header"}},
					"proxy":      {ArgsName: []string{"--proxy"}},
					"__common__": {ArgsName: []string{"--no-mtime", "--progress", "--newline", "--no-colors"}},
				},
				ConsoleReg: ConsoleReg{
					Percent: `([\d.]+)%`,
					Speed:   `([\d.]+\s?[MKG]?i?B/s)`,
					Error:   `(?m)^ERROR:`,
					Start:   `\[download\] Destination:`,
					IsLive:  ``,
				},
			},
			{
				Type: "mediago",
				Args: map[string]ArgSpec{
					"url":            {ArgsName: []string{}},
					"localDir":       {ArgsName: []string{"--save-dir", "--tmp-dir"}},
					"name":           {ArgsName: []string{"--save-name"}},
					"headers":        {ArgsName: []string{"--header"}},
					"deleteSegments": {ArgsName: []string{"--del-after-done"}},
					"proxy":          {ArgsName: []string{"--proxy"}},
					"__common__":     {ArgsName: []string{"--auto-select", "--thread-count", "8"}},
				},
				ConsoleReg: ConsoleReg{
					Percent: `([\d.]+)%`,
					Speed:   `([\d.]+\s?[MKG]?B/s)`,
					Error:   `Error:`,
					Start:   `\[download\] \d+ segments`,
					IsLive:  `is_live:\s*true|\[live\]`,
				},
			},
		},
	}
}

// LoadSchemasFromJSON loads Schema configuration from a JSON file.
// If the file does not exist, the built-in defaults are returned.
func LoadSchemasFromJSON(path string) (SchemaList, error) {
	logger.Debug("Loading schemas from file", zap.String("path", path))

	raw, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			logger.Info("Schema file not found, using built-in defaults",
				zap.String("path", path))
			return DefaultSchemas(), nil
		}
		logger.Error("Failed to read schema file",
			zap.String("path", path),
			zap.Error(err))
		return SchemaList{}, err
	}

	var sl SchemaList
	if err := json.Unmarshal(raw, &sl); err != nil {
		logger.Error("Failed to parse schema JSON",
			zap.String("path", path),
			zap.Error(err))
		return SchemaList{}, err
	}

	logger.Info("Schemas loaded successfully",
		zap.String("path", path),
		zap.Int("count", len(sl.Schemas)))

	return sl, nil
}
