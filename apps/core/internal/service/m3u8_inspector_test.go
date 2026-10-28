package service

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type inspectorTestConfig struct {
	values map[string]any
}

func TestM3U8InspectionUsesTaskProxyAndSeparatesCachedRoutes(t *testing.T) {
	var direct, proxied atomic.Int32
	manifest := "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\npart.ts\n#EXT-X-ENDLIST\n"
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { direct.Add(1); _, _ = w.Write([]byte(manifest)) }))
	defer origin.Close()
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		proxied.Add(1)
		if r.Method != http.MethodConnect {
			t.Error("expected pinned CONNECT tunnel")
		}
		conn, buffer, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(3 * time.Second))
		_, _ = buffer.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buffer.Flush()
		if _, err := http.ReadRequest(buffer.Reader); err != nil {
			t.Error(err)
			return
		}
		_, _ = fmt.Fprintf(conn, "HTTP/1.1 200 OK\r\nContent-Length: %d\r\nConnection: close\r\n\r\n%s", len(manifest), manifest)
	}))
	defer proxy.Close()
	inspector := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{"proxy": proxy.URL, "useProxy": true, "downloadProxySwitch": false}})
	for _, input := range []InspectSourceInput{
		{URL: origin.URL + "/video.m3u8", ProxyMode: "custom", ProxyURL: proxy.URL},
		{URL: origin.URL + "/video.m3u8", ProxyMode: "direct"},
		{URL: origin.URL + "/video.m3u8", ProxyMode: "inherit"},
		{URL: origin.URL + "/video.m3u8"},
	} {
		if result := inspector.Inspect(context.Background(), input); result.Error != "" {
			t.Fatal(result.Error)
		}
	}
	if direct.Load() != 1 || proxied.Load() != 1 {
		t.Fatalf("cache crossed proxy routes: direct=%d proxy=%d", direct.Load(), proxied.Load())
	}
}

func (c inspectorTestConfig) Get(key string) any { return c.values[key] }

func TestM3U8InspectorParsesMasterPlaylistAndForwardsHeaders(t *testing.T) {
	var requestCount atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount.Add(1)
		if got := r.Header.Get("Referer"); got != "https://example.com/watch/video" {
			t.Errorf("Referer = %q", got)
		}
		if got := r.Header.Get("User-Agent"); got != "MediaGo-Test" {
			t.Errorf("User-Agent = %q", got)
		}
		if got := r.Header.Get("Accept-Encoding"); strings.Contains(got, "br") {
			t.Errorf("unsupported captured Accept-Encoding was forwarded: %q", got)
		}
		_, _ = w.Write([]byte(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720/index.m3u8?token=test
#EXT-X-STREAM-INF:AVERAGE-BANDWIDTH=4500000,BANDWIDTH=5000000,RESOLUTION=1920x1080
/1080/index.m3u8?token=test
`))
	}))
	defer server.Close()

	inspector := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}})
	input := InspectSourceInput{
		ID:  "source-1",
		URL: server.URL + "/master/index.m3u8",
		Headers: []string{
			"Referer: https://example.com/watch/video",
			"User-Agent: MediaGo-Test",
			"Accept-Encoding: gzip, br",
		},
	}
	result := inspector.Inspect(context.Background(), input)

	if result.Error != "" {
		t.Fatalf("Inspect() error = %q", result.Error)
	}
	if result.PlaylistType != "master" || result.MaxQuality != "1080p" {
		t.Fatalf("unexpected inspection: %+v", result)
	}
	if len(result.Variants) != 2 {
		t.Fatalf("variants = %d, want 2", len(result.Variants))
	}
	if got := result.Variants[0].URL; got != server.URL+"/master/720/index.m3u8?token=test" {
		t.Fatalf("resolved variant URL = %q", got)
	}
	if result.Variants[0].Codecs != "avc1.4d401f,mp4a.40.2" {
		t.Fatalf("codecs = %q", result.Variants[0].Codecs)
	}

	cached := inspector.Inspect(context.Background(), InspectSourceInput{
		ID: "source-2", URL: input.URL, Headers: input.Headers,
	})
	if cached.ID != "source-2" || requestCount.Load() != 1 {
		t.Fatalf("cache result = %+v, requests = %d", cached, requestCount.Load())
	}
}

func TestM3U8InspectorIdentifiesMediaPlaylist(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("\ufeff\n  \n#EXTM3U\n" + `
#EXT-X-TARGETDURATION:6
#EXTINF:6.0,
segment-1.ts
`))
	}))
	defer server.Close()

	inspector := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}})
	result := inspector.Inspect(context.Background(), InspectSourceInput{ID: "media", URL: server.URL + "/signed/play?id=1"})
	if result.Error != "" || result.PlaylistType != "media" || result.MaxQuality != "" {
		t.Fatalf("unexpected inspection: %+v", result)
	}
}

func TestM3U8InspectorUsesFinalRedirectURLForRelativeVariants(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/start", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/cdn/master/index", http.StatusFound)
	})
	mux.HandleFunc("/cdn/master/index", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\nvariants/720\n"))
	})
	server := httptest.NewServer(mux)
	defer server.Close()

	inspector := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}})
	result := inspector.Inspect(context.Background(), InspectSourceInput{ID: "redirect", URL: server.URL + "/start"})
	if result.Error != "" || len(result.Variants) != 1 {
		t.Fatalf("unexpected inspection: %+v", result)
	}
	if got, want := result.Variants[0].URL, server.URL+"/cdn/master/variants/720"; got != want {
		t.Fatalf("variant URL = %q, want %q", got, want)
	}
}

func TestM3U8InspectorClassifiesNonHLSAndBoundedFailures(t *testing.T) {
	t.Run("not hls", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
			_, _ = w.Write([]byte("<html>not a playlist</html>"))
		}))
		defer server.Close()

		result := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}}).Inspect(
			context.Background(),
			InspectSourceInput{ID: "html", URL: server.URL + "/play"},
		)
		if result.ErrorCode != InspectionErrorNotHLS || result.Error == "" {
			t.Fatalf("unexpected result: %+v", result)
		}
	})

	t.Run("too large", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			_, _ = w.Write([]byte("#EXTM3U\n"))
			_, _ = w.Write([]byte(strings.Repeat("#", maxManifestBytes)))
		}))
		defer server.Close()

		result := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}}).Inspect(
			context.Background(),
			InspectSourceInput{ID: "large", URL: server.URL + "/play"},
		)
		if result.ErrorCode != InspectionErrorTooLarge {
			t.Fatalf("unexpected result: %+v", result)
		}
	})

	t.Run("cancelled request", func(t *testing.T) {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			time.Sleep(100 * time.Millisecond)
			_, _ = w.Write([]byte("#EXTM3U\n"))
		}))
		defer server.Close()

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Millisecond)
		defer cancel()
		result := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}}).Inspect(
			ctx,
			InspectSourceInput{ID: "timeout", URL: server.URL + "/play"},
		)
		if result.ErrorCode != InspectionErrorFetch {
			t.Fatalf("unexpected result: %+v", result)
		}
	})
}

func TestM3U8InspectorReturnsPerSourceErrors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte("not a playlist"))
	}))
	defer server.Close()

	inspector := NewM3U8Inspector(inspectorTestConfig{values: map[string]any{}})
	results := inspector.InspectBatch(context.Background(), []InspectSourceInput{
		{ID: "invalid", URL: server.URL},
		{ID: "unsupported", URL: "file:///tmp/video.m3u8"},
	})
	if len(results) != 2 || results[0].Error == "" || results[1].Error == "" {
		t.Fatalf("unexpected results: %+v", results)
	}
}
