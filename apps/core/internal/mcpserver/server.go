// Package mcpserver exposes MediaGo download management as a local MCP server.
package mcpserver

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"net/http"
	"strings"
	"sync"

	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// DownloadConfig exposes the runtime settings used when starting downloads.
type DownloadConfig interface {
	GetLocalDir() string
	GetDeleteSegments() bool
	IsDesktop() bool
}

// DiscoveryDownloader is the credential-safe handoff shared with the HTTP API.
type DiscoveryDownloader interface {
	CreateDownloadBatch(context.Context, string, []service.DiscoveryDownloadSelection, string, string, bool) ([]service.DiscoveryDownloadResult, error)
}

// Settings controls the MCP route exposed by the main HTTP server.
type Settings struct {
	Enabled bool
	Token   string
}

// Status reports the MCP route's current readiness.
type Status struct {
	Enabled  bool   `json:"enabled"`
	Running  bool   `json:"running"`
	Endpoint string `json:"endpoint"`
	Error    string `json:"error,omitempty"`
}

// Manager owns the Streamable HTTP MCP handler and its live settings.
type Manager struct {
	mu                 sync.RWMutex
	download           *service.DownloadTaskService
	config             DownloadConfig
	discovery          *discovery.Service
	discoveryDownloads DiscoveryDownloader
	settings           Settings
	handler            http.Handler
	status             Status
}

// NewManager creates an MCP manager backed by MediaGo's existing task service.
func NewManager(download *service.DownloadTaskService, config DownloadConfig, discoveryService *discovery.Service, discoveryDownloads DiscoveryDownloader) *Manager {
	manager := &Manager{
		download:           download,
		config:             config,
		discovery:          discoveryService,
		discoveryDownloads: discoveryDownloads,
	}
	manager.handler = manager.httpHandler()
	manager.Apply(Settings{})
	return manager
}

// GenerateToken returns a cryptographically random bearer token.
func GenerateToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return hex.EncodeToString(data), nil
}

// Apply updates the live MCP route settings without restarting the HTTP server.
func (m *Manager) Apply(settings Settings) {
	m.mu.Lock()
	defer m.mu.Unlock()

	m.settings = settings
	m.status = Status{
		Enabled:  settings.Enabled,
		Endpoint: "/mcp",
	}

	if !settings.Enabled {
		return
	}
	if strings.TrimSpace(settings.Token) == "" {
		m.status.Error = "MCP token is empty"
		return
	}
	if m.download == nil {
		m.status.Error = "download persistence is unavailable"
		return
	}
	if m.discovery == nil {
		m.status.Error = "discovery service is unavailable"
		return
	}

	m.status.Running = true
}

// Handler returns the MCP HTTP handler mounted by the main Gin server.
func (m *Manager) Handler() http.Handler {
	return http.HandlerFunc(m.serveHTTP)
}

// Status returns a snapshot of the listener state.
func (m *Manager) Status() Status {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.status
}

func (m *Manager) serveHTTP(w http.ResponseWriter, r *http.Request) {
	m.mu.RLock()
	settings := m.settings
	status := m.status
	handler := m.handler
	m.mu.RUnlock()

	if !settings.Enabled {
		http.NotFound(w, r)
		return
	}
	if !hasValidBearerToken(r, settings.Token) {
		w.Header().Set("WWW-Authenticate", "Bearer")
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if !status.Running {
		message := status.Error
		if message == "" {
			message = "MCP server is unavailable"
		}
		http.Error(w, message, http.StatusServiceUnavailable)
		return
	}

	handler.ServeHTTP(w, r)
}

func (m *Manager) httpHandler() http.Handler {
	server := mcp.NewServer(
		&mcp.Implementation{
			Name:    "mediago-downloader",
			Title:   "mediago downloader",
			Version: "3.5.0",
		},
		nil,
	)
	m.registerTools(server)

	streamable := mcp.NewStreamableHTTPHandler(
		func(*http.Request) *mcp.Server { return server },
		&mcp.StreamableHTTPOptions{
			Stateless:                    true,
			JSONResponse:                 true,
			MaxRequestBodyBytes:          1 << 20,
			PropagateRequestCancellation: true,
		},
	)
	protected := http.NewCrossOriginProtection().Handler(streamable)
	return protected
}

func hasValidBearerToken(r *http.Request, token string) bool {
	if strings.TrimSpace(token) == "" {
		return false
	}
	authorization := r.Header.Get("Authorization")
	provided := strings.TrimPrefix(authorization, "Bearer ")
	return strings.HasPrefix(authorization, "Bearer ") &&
		len(provided) == len(token) &&
		subtle.ConstantTimeCompare([]byte(provided), []byte(token)) == 1
}
