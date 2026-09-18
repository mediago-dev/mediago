package server

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/mcpserver"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpRouteDownloadConfig struct{}

func (mcpRouteDownloadConfig) GetLocalDir() string     { return "" }
func (mcpRouteDownloadConfig) GetDeleteSegments() bool { return true }
func (mcpRouteDownloadConfig) IsDesktop() bool         { return false }

func TestRegisterMCPRoutesUsesMainGinEngine(t *testing.T) {
	gin.SetMode(gin.TestMode)
	manager := mcpserver.NewManager(
		&service.DownloadTaskService{},
		mcpRouteDownloadConfig{},
		discovery.NewService(nil, nil, nil),
		nil,
	)
	manager.Apply(mcpserver.Settings{Enabled: true, Token: "secret"})
	server := &Server{engine: gin.New()}
	server.RegisterMCPRoutes(manager.Handler(), func() any { return manager.Status() })

	client := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil)
	session, err := client.Connect(context.Background(), &mcp.StreamableClientTransport{
		Endpoint: "http://mediago.test/mcp",
		HTTPClient: &http.Client{Transport: mcpRouteRoundTripFunc(func(request *http.Request) (*http.Response, error) {
			request.Header.Set("Authorization", "Bearer secret")
			response := httptest.NewRecorder()
			server.Engine().ServeHTTP(response, request)
			return response.Result(), nil
		})},
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

	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		request := httptest.NewRequest(method, "/mcp", nil)
		request.Header.Set("Authorization", "Bearer secret")
		response := httptest.NewRecorder()
		server.Engine().ServeHTTP(response, request)
		if response.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s /mcp status = %d, want %d", method, response.Code, http.StatusMethodNotAllowed)
		}
		if response.Header().Get("Allow") != http.MethodPost {
			t.Fatalf("%s /mcp Allow = %q, want POST", method, response.Header().Get("Allow"))
		}
	}

	statusRequest := httptest.NewRequest(http.MethodGet, "/api/mcp/status", nil)
	statusResponse := httptest.NewRecorder()
	server.Engine().ServeHTTP(statusResponse, statusRequest)
	var payload dto.SuccessResponse
	if err := json.Unmarshal(statusResponse.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	status, ok := payload.Data.(map[string]any)
	if !ok || status["endpoint"] != "/mcp" || status["running"] != true {
		t.Fatalf("unexpected MCP status payload: %#v", payload.Data)
	}
}

type mcpRouteRoundTripFunc func(*http.Request) (*http.Response, error)

func (fn mcpRouteRoundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return fn(request)
}
