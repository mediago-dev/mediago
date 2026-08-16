package core

import (
	"encoding/json"
	"fmt"
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

func assertStandaloneArgCount(t *testing.T, tool, field string, args []string, expected int, arg string) {
	t.Helper()

	actual := 0
	for _, candidate := range args {
		if candidate == arg {
			actual++
		}
	}
	if actual != expected {
		t.Fatalf("%s %s occurrence count: expected %d, actual %d", tool, field, expected, actual)
	}
}

func assertAdjacentArgCount(t *testing.T, tool, field string, args []string, expected int, flag, value string) {
	t.Helper()

	actual := 0
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && args[i+1] == value {
			actual++
		}
	}
	if actual != expected {
		t.Fatalf("%s %s occurrence count: expected %d, actual %d", tool, field, expected, actual)
	}
}

func TestExternalInputContracts(t *testing.T) {
	const (
		unsafeName = "contract:video?"
		safeName   = "contract_video_"
	)

	t.Run("BBDown", func(t *testing.T) {
		const (
			tool      = "BBDown"
			url       = "https://www.bilibili.com/video/BV-contract"
			localDir  = "/downloads"
			folder    = "contracts"
			cookie    = "session=test-only"
			cookieHdr = "cookie : " + cookie
		)
		d := &DownloaderSvc{cfg: testDownloaderConfig{localDir: localDir}}
		args := d.buildArgs(DownloadParams{
			Type:    TypeBilibili,
			URL:     url,
			Name:    unsafeName,
			Folder:  folder,
			Headers: []string{cookieHdr},
		}, defaultContractSchema(t, string(TypeBilibili)))

		assertStandaloneArgCount(t, tool, "URL", args, 1, url)
		assertStandaloneArgCount(t, tool, "work directory flag", args, 1, "--work-dir")
		assertStandaloneArgCount(t, tool, "file pattern flag", args, 1, "--file-pattern")
		assertStandaloneArgCount(t, tool, "cookie flag", args, 1, "--cookie")
		assertStandaloneArgCount(t, tool, "encoding priority flag", args, 1, "--encoding-priority")
		assertAdjacentArgCount(t, tool, "work directory", args, 1, "--work-dir", filepath.Join(localDir, folder))
		assertAdjacentArgCount(t, tool, "file pattern", args, 1, "--file-pattern", safeName)
		assertAdjacentArgCount(t, tool, "cookie", args, 1, "--cookie", cookie)
		assertAdjacentArgCount(t, tool, "encoding priority", args, 1, "--encoding-priority", "avc,hevc,av1")

		argsWithoutCookie := d.buildArgs(DownloadParams{
			Type:    TypeBilibili,
			URL:     url,
			Name:    unsafeName,
			Headers: []string{"User-Agent: MediaGo-Contract-Test"},
		}, defaultContractSchema(t, string(TypeBilibili)))
		assertStandaloneArgCount(t, tool, "cookie without Cookie header", argsWithoutCookie, 0, "--cookie")
	})

	t.Run("yt-dlp", func(t *testing.T) {
		const (
			tool     = "yt-dlp"
			url      = "https://www.youtube.com/watch?v=contract"
			localDir = "/downloads"
			folder   = "contracts"
			proxy    = "http://contract-user:contract-password@proxy.example:8080"
		)
		headers := []string{
			"cookie : session=test-only",
			"aUtHoRiZaTiOn: Bearer test-only",
			"Proxy-Authorization : Basic test-only",
			"User-Agent: MediaGo-Contract-Test",
		}
		d := &DownloaderSvc{cfg: testDownloaderConfig{localDir: localDir, useProxy: true, proxy: proxy}}
		args := d.buildArgs(DownloadParams{
			Type:    TypeYoutube,
			URL:     url,
			Name:    unsafeName,
			Folder:  folder,
			Headers: headers,
		}, defaultContractSchema(t, string(TypeYoutube)))

		assertStandaloneArgCount(t, tool, "URL", args, 1, url)
		assertStandaloneArgCount(t, tool, "output directory flag", args, 1, "-P")
		assertStandaloneArgCount(t, tool, "output template flag", args, 1, "-o")
		assertStandaloneArgCount(t, tool, "header flags", args, len(headers), "--add-header")
		assertStandaloneArgCount(t, tool, "proxy flag", args, 1, "--proxy")
		assertAdjacentArgCount(t, tool, "output directory", args, 1, "-P", filepath.Join(localDir, folder))
		assertAdjacentArgCount(t, tool, "output template", args, 1, "-o", safeName)
		for i, header := range headers {
			assertAdjacentArgCount(t, tool, fmt.Sprintf("header %d", i+1), args, 1, "--add-header", header)
		}
		assertAdjacentArgCount(t, tool, "proxy", args, 1, "--proxy", proxy)
		for _, flag := range []string{"--no-mtime", "--progress", "--newline", "--no-colors"} {
			assertStandaloneArgCount(t, tool, flag, args, 1, flag)
		}

		t.Run("disabled proxy with value", func(t *testing.T) {
			disabled := &DownloaderSvc{cfg: testDownloaderConfig{localDir: localDir, proxy: proxy}}
			disabledArgs := disabled.buildArgs(DownloadParams{Type: TypeYoutube, URL: url, Name: unsafeName}, defaultContractSchema(t, string(TypeYoutube)))
			assertStandaloneArgCount(t, tool, "disabled proxy", disabledArgs, 0, "--proxy")
		})

		t.Run("enabled empty proxy", func(t *testing.T) {
			empty := &DownloaderSvc{cfg: testDownloaderConfig{localDir: localDir, useProxy: true}}
			emptyArgs := empty.buildArgs(DownloadParams{Type: TypeYoutube, URL: url, Name: unsafeName}, defaultContractSchema(t, string(TypeYoutube)))
			assertStandaloneArgCount(t, tool, "empty proxy", emptyArgs, 0, "--proxy")
		})
	})
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
