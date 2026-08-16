package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"caorushizi.cn/mediago/internal/core/parser"
	"caorushizi.cn/mediago/internal/core/schema"
)

type parsedContract struct {
	state  parser.ParseState
	ready  bool
	errors []string
}

func loadContractFixture(t *testing.T, name string) []string {
	t.Helper()

	raw, err := os.ReadFile(filepath.Join("testdata", "contracts", name))
	if err != nil {
		t.Fatalf("read fixture %q: %v", name, err)
	}

	var chunks []string
	if err := json.Unmarshal(raw, &chunks); err != nil {
		t.Fatalf("decode fixture %q as []string: %v", name, err)
	}
	return chunks
}

func parseContractFixture(t *testing.T, reg schema.ConsoleReg, chunks []string) parsedContract {
	t.Helper()

	lineParser, err := parser.NewLineParser(reg)
	if err != nil {
		t.Fatalf("create line parser: %v", err)
	}

	var result parsedContract
	for _, chunk := range chunks {
		event, errMsg := lineParser.Parse(strings.TrimSpace(chunk), &result.state)
		if event == "ready" {
			result.ready = true
			result.state.Ready = true
		}
		if errMsg != "" {
			result.errors = append(result.errors, errMsg)
		}
	}
	return result
}

func defaultContractSchema(t *testing.T, downloadType string) schema.Schema {
	t.Helper()

	contractSchema, ok := schema.DefaultSchemas().GetByType(downloadType)
	if !ok {
		t.Fatalf("default schema %q not found", downloadType)
	}
	return contractSchema
}

func TestExternalOutputContracts(t *testing.T) {
	bbdownSchema := defaultContractSchema(t, "bilibili")
	ytDLPschema := defaultContractSchema(t, "youtube")

	t.Run("BBDown progress", func(t *testing.T) {
		chunks := loadContractFixture(t, "bbdown-progress.json")
		if len(chunks) != 2 {
			t.Fatalf("decoded chunks = %d, want 2", len(chunks))
		}
		if got := strings.Count(chunks[1], "\b"); got != 4 {
			t.Fatalf("decoded backspaces = %d, want 4", got)
		}

		result := parseContractFixture(t, bbdownSchema.ConsoleReg, chunks)
		if !result.ready {
			t.Fatal("BBDown fixture did not emit ready")
		}
		if result.state.Percent != 50 {
			t.Fatalf("BBDown percent = %v, want 50", result.state.Percent)
		}
		if result.state.Speed != "1.50 MB/s" {
			t.Fatalf("BBDown speed = %q, want %q", result.state.Speed, "1.50 MB/s")
		}
		if len(result.errors) != 0 {
			t.Fatalf("BBDown progress parser errors = %q, want none", result.errors)
		}
	})

	t.Run("BBDown failure text is not a parser error", func(t *testing.T) {
		result := parseContractFixture(t, bbdownSchema.ConsoleReg, loadContractFixture(t, "bbdown-failure.json"))
		if len(result.errors) != 0 {
			t.Fatalf("BBDown failure parser errors = %q, want none", result.errors)
		}
	})

	t.Run("yt-dlp progress", func(t *testing.T) {
		result := parseContractFixture(t, ytDLPschema.ConsoleReg, loadContractFixture(t, "yt-dlp-progress.json"))
		if !result.ready {
			t.Fatal("yt-dlp fixture did not emit ready")
		}
		if result.state.Percent != 42.1 {
			t.Fatalf("yt-dlp percent = %v, want 42.1", result.state.Percent)
		}
		if result.state.Speed != "2.50MiB/s" {
			t.Fatalf("yt-dlp speed = %q, want %q", result.state.Speed, "2.50MiB/s")
		}
		if len(result.errors) != 0 {
			t.Fatalf("yt-dlp progress parser errors = %q, want none", result.errors)
		}
	})

	t.Run("yt-dlp error", func(t *testing.T) {
		result := parseContractFixture(t, ytDLPschema.ConsoleReg, loadContractFixture(t, "yt-dlp-error.json"))
		if len(result.errors) != 1 {
			t.Fatalf("yt-dlp parser errors = %q, want exactly one", result.errors)
		}
		if result.errors[0] != "ERROR: synthetic contract failure" {
			t.Fatalf("yt-dlp parser error = %q", result.errors[0])
		}
	})
}

func TestExternalSchemaContracts(t *testing.T) {
	t.Run("BBDown", func(t *testing.T) {
		consoleReg := defaultContractSchema(t, "bilibili").ConsoleReg
		if consoleReg.Start != "开始下载" {
			t.Errorf("BBDown start regex = %q, want %q", consoleReg.Start, "开始下载")
		}
		if consoleReg.Error != "" {
			t.Errorf("BBDown error regex = %q, want empty", consoleReg.Error)
		}
		if consoleReg.IsLive != "" {
			t.Errorf("BBDown live regex = %q, want empty", consoleReg.IsLive)
		}
	})

	t.Run("yt-dlp", func(t *testing.T) {
		consoleReg := defaultContractSchema(t, "youtube").ConsoleReg
		if consoleReg.Error != `(?m)^ERROR:` {
			t.Errorf("yt-dlp error regex = %q, want line-anchored ERROR prefix", consoleReg.Error)
		}
		if consoleReg.IsLive != "" {
			t.Errorf("yt-dlp live regex = %q, want empty", consoleReg.IsLive)
		}
	})
}
