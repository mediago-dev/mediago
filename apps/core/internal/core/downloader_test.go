package core

import (
	"slices"
	"testing"

	"caorushizi.cn/mediago/internal/core/schema"
)

func TestBuildArgsUsesStoredBilibiliCookie(t *testing.T) {
	d := &DownloaderSvc{}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"cookie":     {ArgsName: []string{"--cookie"}},
		"__common__": {ArgsName: []string{"--encoding-priority", "avc,hevc,av1"}},
	}}

	args := d.buildArgs(DownloadParams{
		Type:    TypeBilibili,
		Headers: []string{"Referer: https://www.bilibili.com", "cookie: SESSDATA=secret; bili_jct=csrf"},
	}, s)

	cookieIndex := slices.Index(args, "--cookie")
	if cookieIndex == -1 || cookieIndex+1 >= len(args) {
		t.Fatalf("expected --cookie argument, got %v", args)
	}
	if got := args[cookieIndex+1]; got != "SESSDATA=secret; bili_jct=csrf" {
		t.Fatalf("unexpected cookie value %q", got)
	}
	if slices.Contains(args, "--use-app-api") {
		t.Fatalf("APP API must not be forced: %v", args)
	}
}

func TestBuildArgsOmitsMissingCookie(t *testing.T) {
	d := &DownloaderSvc{}
	s := schema.Schema{Args: map[string]schema.ArgSpec{
		"cookie": {ArgsName: []string{"--cookie"}},
	}}

	args := d.buildArgs(DownloadParams{Type: TypeBilibili}, s)
	if slices.Contains(args, "--cookie") {
		t.Fatalf("unexpected cookie argument: %v", args)
	}
}

func TestRedactSensitiveArgs(t *testing.T) {
	original := []string{"BV1xx", "--cookie", "SESSDATA=secret", "--cookie=other-secret"}
	redacted := redactSensitiveArgs(original)

	want := []string{"BV1xx", "--cookie", "[REDACTED]", "--cookie=[REDACTED]"}
	if !slices.Equal(redacted, want) {
		t.Fatalf("redacted args = %v, want %v", redacted, want)
	}
	if original[2] != "SESSDATA=secret" {
		t.Fatal("redaction mutated executable arguments")
	}
}

func TestHeaderValueIsCaseInsensitive(t *testing.T) {
	headers := []string{"COOKIE : SESSDATA=value:with:colons"}
	if got := headerValue(headers, "Cookie"); got != "SESSDATA=value:with:colons" {
		t.Fatalf("headerValue() = %q", got)
	}
}
