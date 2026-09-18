package mcpserver

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type testDownloadConfig struct {
	localDir string
	desktop  bool
}

func (c testDownloadConfig) GetLocalDir() string   { return c.localDir }
func (testDownloadConfig) GetDeleteSegments() bool { return true }
func (c testDownloadConfig) IsDesktop() bool       { return c.desktop }

func newTestManager(download *service.DownloadTaskService) *Manager {
	return NewManager(download, testDownloadConfig{}, discovery.NewService(nil, nil, nil), nil)
}

type mcpDiscoveryInspector struct{}

func (mcpDiscoveryInspector) Inspect(_ context.Context, input service.InspectSourceInput) service.SourceInspection {
	return service.SourceInspection{
		ID:           input.ID,
		URL:          input.URL,
		PlaylistType: "master",
		MaxQuality:   "1080p",
	}
}

type mcpDiscoveryExecutor struct{}

func (mcpDiscoveryExecutor) Available() bool { return true }
func (mcpDiscoveryExecutor) Dispatch(context.Context, discovery.DiscoveryJob) error {
	return nil
}
func (mcpDiscoveryExecutor) Cancel(context.Context, string) error { return nil }

func TestGenerateToken(t *testing.T) {
	first, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	second, err := GenerateToken()
	if err != nil {
		t.Fatal(err)
	}
	if len(first) != 64 || first == second {
		t.Fatalf("unexpected generated tokens: %q %q", first, second)
	}
}

func TestManagerHandlerStateAndAuthentication(t *testing.T) {
	manager := newTestManager(&service.DownloadTaskService{})

	response := serveManagerRequest(t, manager, http.MethodPost, "")
	if response.Code != http.StatusNotFound {
		t.Fatalf("disabled status = %d, want %d", response.Code, http.StatusNotFound)
	}

	manager.Apply(Settings{Enabled: true, Token: "first-secret"})
	response = serveManagerRequest(t, manager, http.MethodPost, "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("missing token status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	if response.Header().Get("WWW-Authenticate") != "Bearer" {
		t.Fatalf("WWW-Authenticate = %q, want Bearer", response.Header().Get("WWW-Authenticate"))
	}

	manager.Apply(Settings{Enabled: true, Token: "second-secret"})
	response = serveManagerRequest(t, manager, http.MethodPost, "first-secret")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("rotated old token status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	response = serveManagerRequest(t, manager, http.MethodGet, "second-secret")
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("authorized GET status = %d, want %d", response.Code, http.StatusMethodNotAllowed)
	}
	if response.Header().Get("Allow") != http.MethodPost {
		t.Fatalf("Allow = %q, want POST", response.Header().Get("Allow"))
	}

	status := manager.Status()
	if !status.Enabled || !status.Running || status.Endpoint != "/mcp" || status.Error != "" {
		t.Fatalf("unexpected ready status: %+v", status)
	}
}

func TestManagerRejectsEmptyToken(t *testing.T) {
	manager := newTestManager(&service.DownloadTaskService{})
	manager.Apply(Settings{Enabled: true, Token: ""})

	response := serveManagerRequest(t, manager, http.MethodPost, "")
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("empty token status = %d, want %d", response.Code, http.StatusUnauthorized)
	}
	status := manager.Status()
	if status.Running || status.Error != "MCP token is empty" {
		t.Fatalf("unexpected empty-token status: %+v", status)
	}
}

func TestManagerReportsUnavailableDownloadPersistence(t *testing.T) {
	manager := newTestManager(nil)
	manager.Apply(Settings{Enabled: true, Token: "secret"})

	unauthorized := serveManagerRequest(t, manager, http.MethodPost, "wrong")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("invalid token status = %d, want %d", unauthorized.Code, http.StatusUnauthorized)
	}
	authorized := serveManagerRequest(t, manager, http.MethodPost, "secret")
	if authorized.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable persistence status = %d, want %d", authorized.Code, http.StatusServiceUnavailable)
	}

	status := manager.Status()
	if status.Running || status.Error != "download persistence is unavailable" {
		t.Fatalf("unexpected unavailable status: %+v", status)
	}
}

func TestManagerReportsUnavailableDiscoveryService(t *testing.T) {
	manager := NewManager(&service.DownloadTaskService{}, testDownloadConfig{}, nil, nil)
	manager.Apply(Settings{Enabled: true, Token: "secret"})

	response := serveManagerRequest(t, manager, http.MethodPost, "secret")
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("unavailable discovery status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	status := manager.Status()
	if status.Running || status.Error != "discovery service is unavailable" {
		t.Fatalf("unexpected unavailable status: %+v", status)
	}
}

func TestManagerServesAuthenticatedMCPRequest(t *testing.T) {
	manager := newTestManager(&service.DownloadTaskService{})
	manager.Apply(Settings{Enabled: true, Token: "secret"})

	authorizedClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		request.Header.Set("Authorization", "Bearer secret")
		response := httptest.NewRecorder()
		manager.Handler().ServeHTTP(response, request)
		return response.Result(), nil
	})}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:             "http://mediago.test/mcp",
		HTTPClient:           authorizedClient,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: "health_check"})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError || len(result.Content) == 0 {
		t.Fatalf("unexpected health_check result: %+v", result)
	}
}

func TestMCPDiscoveryToolsAreListedAndReturnRedactedJobs(t *testing.T) {
	discoveryService := discovery.NewService(nil, mcpDiscoveryInspector{}, mcpDiscoveryExecutor{})
	manager := NewManager(&service.DownloadTaskService{}, testDownloadConfig{}, discoveryService, nil)
	manager.Apply(Settings{Enabled: true, Token: "secret"})
	session := connectTestSession(t, manager)

	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	tools := make(map[string]*mcp.Tool, len(listed.Tools))
	for _, tool := range listed.Tools {
		tools[tool.Name] = tool
	}
	for _, name := range []string{
		"discover_media",
		"get_media_discovery",
		"cancel_media_discovery",
		"download_discovered_media",
	} {
		if tools[name] == nil {
			t.Fatalf("missing MCP tool %q", name)
		}
	}
	if annotations := tools["discover_media"].Annotations; annotations == nil || annotations.ReadOnlyHint || annotations.OpenWorldHint == nil || !*annotations.OpenWorldHint {
		t.Fatalf("unexpected discover_media annotations: %+v", annotations)
	}
	if annotations := tools["download_discovered_media"].Annotations; annotations == nil || annotations.ReadOnlyHint {
		t.Fatalf("unexpected download_discovered_media annotations: %+v", annotations)
	}
	for _, name := range []string{"create_download", "download_discovered_media"} {
		encoded, err := json.Marshal(tools[name].InputSchema)
		if err != nil || !strings.Contains(string(encoded), `"downloadDir"`) || !strings.Contains(string(encoded), "Docker/server") {
			t.Fatalf("%s schema does not describe the desktop-only downloadDir: %s (%v)", name, encoded, err)
		}
	}

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "discover_media",
		Arguments: map[string]any{
			"url":         "https://cdn.example.com/master.m3u8",
			"mode":        "inspect",
			"waitSeconds": 1,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.IsError {
		t.Fatalf("discover_media returned an MCP error: %+v", result.Content)
	}
	encoded, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	text := string(encoded)
	if !strings.Contains(text, `"status":"completed"`) || !strings.Contains(text, `"playlistType":"master"`) {
		t.Fatalf("unexpected discover_media output: %s", text)
	}
	for _, forbidden := range []string{"headers", "authorization", "sentinel"} {
		if strings.Contains(strings.ToLower(text), forbidden) {
			t.Fatalf("discover_media output leaked %q: %s", forbidden, text)
		}
	}

	browserJob, err := discoveryService.Create(context.Background(), discovery.CreateDiscoveryInput{
		URL:  "https://example.com/watch",
		Mode: discovery.ModeBrowser,
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := discoveryService.MarkRunning(browserJob.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := discoveryService.Complete(context.Background(), browserJob.ID, []discovery.PrivateSource{{
		DiscoverySource: discovery.DiscoverySource{
			ID:         "private-source",
			URL:        "https://cdn.example.com/private.m3u8",
			PageURL:    "https://example.com/watch",
			Title:      "Private",
			Type:       discovery.SourceTypeM3U8,
			DetectedAt: time.Now().UTC(),
		},
		Headers: []string{"Cookie: sentinel-cookie", "Authorization: Bearer sentinel-auth"},
	}}, false); err != nil {
		t.Fatal(err)
	}
	redacted, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name:      "get_media_discovery",
		Arguments: map[string]any{"id": browserJob.ID},
	})
	if err != nil || redacted.IsError {
		t.Fatalf("get_media_discovery failed: %+v, %v", redacted, err)
	}
	encoded, _ = json.Marshal(redacted.StructuredContent)
	if strings.Contains(strings.ToLower(string(encoded)), "sentinel") || strings.Contains(strings.ToLower(string(encoded)), "headers") {
		t.Fatalf("get_media_discovery leaked private headers: %s", encoded)
	}
}

func TestMCPDiscoverMediaReturnsStableUnavailableExecutorError(t *testing.T) {
	manager := NewManager(
		&service.DownloadTaskService{},
		testDownloadConfig{},
		discovery.NewService(nil, mcpDiscoveryInspector{}, nil),
		nil,
	)
	manager.Apply(Settings{Enabled: true, Token: "secret"})
	session := connectTestSession(t, manager)

	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{
		Name: "discover_media",
		Arguments: map[string]any{
			"url":         "https://example.com/watch",
			"mode":        "browser",
			"waitSeconds": 0,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.IsError {
		t.Fatalf("expected executor-unavailable tool error: %+v", result)
	}
	encoded, _ := json.Marshal(result.Content)
	if !strings.Contains(string(encoded), "discovery_executor_unavailable") {
		t.Fatalf("missing stable error code: %s", encoded)
	}
}

func connectTestSession(t *testing.T, manager *Manager) *mcp.ClientSession {
	t.Helper()
	authorizedClient := &http.Client{Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
		request.Header.Set("Authorization", "Bearer secret")
		response := httptest.NewRecorder()
		manager.Handler().ServeHTTP(response, request)
		return response.Result(), nil
	})}
	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint:             "http://mediago.test/mcp",
		HTTPClient:           authorizedClient,
		DisableStandaloneSSE: true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func serveManagerRequest(t *testing.T, manager *Manager, method, token string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "/mcp", bytes.NewBufferString(`{}`))
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response := httptest.NewRecorder()
	manager.Handler().ServeHTTP(response, request)
	return response
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
