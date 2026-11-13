// Rebuild the pinned external download engine with the repository's patched Go toolchain.
// This is distinct from apps/core/cmd/cli, the API client shipped in resources/bin.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const module = "github.com/caorushizi/mediago-core"
const version = "v0.2.1"
const sourceSum = "h1:kzLr0+0+HZu4+Lp7qTcXXuY2YAvyXdVXA9kiGfKlhrY="

func main() {
	output := flag.String("output", "", "Output binary")
	platform := flag.String("platform", "", "GOOS-GOARCH target (x64 and amd64 are accepted)")
	flag.Parse()
	if err := rebuild(*output, *platform); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func rebuild(output, platform string) error {
	parts := strings.Split(platform, "-")
	if output == "" || len(parts) != 2 {
		return fmt.Errorf("output and platform are required")
	}
	targetOS, targetArch := parts[0], parts[1]
	if targetOS == "win32" {
		targetOS = "windows"
	}
	if targetArch == "x64" {
		targetArch = "amd64"
	}
	if (targetOS != "windows" && targetOS != "linux" && targetOS != "darwin") || (targetArch != "amd64" && targetArch != "arm64") {
		return fmt.Errorf("unsupported target %q", platform)
	}
	output, err := filepath.Abs(output)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return err
	}
	work, err := os.MkdirTemp("", "mediago-engine-source-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(work)
	// Keep dependency resolution outside both the app module and any active go.work.
	environment := append(os.Environ(), "GOWORK=off", "GOTOOLCHAIN=go1.27.4", "GOFLAGS=")
	download := exec.Command("go", "mod", "download", "-json", module+"@"+version)
	download.Dir, download.Env = work, environment
	data, err := download.Output()
	if err != nil {
		return fmt.Errorf("resolve pinned engine source: %w", err)
	}
	sourceDir, err := validatedSource(data)
	if err != nil {
		return err
	}
	build := exec.Command("go", "build", "-mod=readonly", "-trimpath", "-buildvcs=false", "-ldflags=-s -w -X main.version="+version, "-o", output, "./cmd/mediago")
	build.Dir = sourceDir
	build.Env = append(environment, "CGO_ENABLED=0", "GOOS="+targetOS, "GOARCH="+targetArch)
	build.Stdout, build.Stderr = os.Stdout, os.Stderr
	if err := build.Run(); err != nil {
		return fmt.Errorf("build pinned engine: %w", err)
	}
	fmt.Printf("Rebuilt %s@%s for %s with Go1.27.4; verified source %s\n", module, version, platform, sourceSum)
	return nil
}

func validatedSource(data []byte) (string, error) {
	var source struct{ Dir, Sum string }
	if err := json.Unmarshal(data, &source); err != nil {
		return "", err
	}
	if source.Sum != sourceSum || source.Dir == "" {
		return "", fmt.Errorf("engine source checksum mismatch")
	}
	return source.Dir, nil
}
