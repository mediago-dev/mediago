package service

import (
	"slices"
	"testing"
)

func TestParseStoredHeadersMultiline(t *testing.T) {
	raw := "Referer:https://www.bilibili.com/video/BV1xx\r\nCookie:SESSDATA=secret\r\n\r\n"
	want := []string{
		"Referer:https://www.bilibili.com/video/BV1xx",
		"Cookie:SESSDATA=secret",
	}

	if got := parseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("parseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersJSON(t *testing.T) {
	raw := `["Referer:https://www.bilibili.com","Cookie:SESSDATA=secret"]`
	want := []string{
		"Referer:https://www.bilibili.com",
		"Cookie:SESSDATA=secret",
	}

	if got := parseStoredHeaders(raw); !slices.Equal(got, want) {
		t.Fatalf("parseStoredHeaders() = %v, want %v", got, want)
	}
}

func TestParseStoredHeadersEmpty(t *testing.T) {
	if got := parseStoredHeaders("\r\n \n"); len(got) != 0 {
		t.Fatalf("parseStoredHeaders() = %v, want empty", got)
	}
}
