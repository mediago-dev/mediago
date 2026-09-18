package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/service"
	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"golang.org/x/net/http/httpguts"
)

const protocolRevision = "2"
const maxPageSize = 100

type emptyInput struct{}
type healthOutput struct {
	Status string `json:"status"`
}

type createDownloadInput struct {
	URL           string   `json:"url" jsonschema:"HTTP or HTTPS video or stream URL"`
	Type          string   `json:"type,omitempty" jsonschema:"download type; inferred from URL when omitted"`
	Name          string   `json:"name,omitempty" jsonschema:"optional output file name"`
	Folder        string   `json:"folder,omitempty" jsonschema:"relative subdirectory within the selected download root"`
	DownloadDir   string   `json:"downloadDir,omitempty" jsonschema:"absolute download root on the desktop machine; Docker/server runtimes reject overrides; omitted uses configured root"`
	Headers       []string `json:"headers,omitempty" jsonschema:"HTTP headers in Name: value form; private headers stay in task memory for 10 minutes and are never returned"`
	StartDownload *bool    `json:"startDownload,omitempty" jsonschema:"start the newly created task immediately; existing tasks are never restarted"`
}
type getDownloadInput struct {
	ID int64 `json:"id" jsonschema:"positive MediaGo download record ID"`
}
type startDownloadInput struct {
	ID      int64    `json:"id" jsonschema:"positive MediaGo download ID; starts ready tasks or retries stopped/failed tasks; active tasks are unchanged"`
	Headers []string `json:"headers,omitempty" jsonschema:"optional fresh headers replacing expired task credentials; never returned"`
}
type listDownloadsInput struct {
	Current  int    `json:"current,omitempty" jsonschema:"page number"`
	PageSize int    `json:"pageSize,omitempty" jsonschema:"records per page, at most 100"`
	Filter   string `json:"filter,omitempty" jsonschema:"all, done (success), or list (not success)"`
}
type discoverMediaInput struct {
	URL               string                  `json:"url" jsonschema:"HTTP or HTTPS page or media URL"`
	Mode              discovery.DiscoveryMode `json:"mode,omitempty" jsonschema:"auto uses inspect for M3U8 URLs and browser otherwise"`
	TimeoutMS         int                     `json:"timeoutMs,omitempty" jsonschema:"browser execution timeout in milliseconds"`
	UseSessionCookies bool                    `json:"useSessionCookies,omitempty" jsonschema:"explicitly opt in to the signed-in desktop browser session"`
	WaitSeconds       *int                    `json:"waitSeconds,omitempty" jsonschema:"wait up to 25 seconds for the job; zero returns after creation"`
}
type discoveryIDInput struct {
	ID string `json:"id" jsonschema:"media discovery job ID"`
}
type downloadDiscoveredMediaInput struct {
	ID            string                               `json:"id" jsonschema:"media discovery job ID"`
	SourceIDs     []string                             `json:"sourceIds,omitempty" jsonschema:"1 to 20 unique source IDs; supply either sourceIds or selections"`
	Selections    []service.DiscoveryDownloadSelection `json:"selections,omitempty" jsonschema:"1 to 20 source selections, optionally selecting an advertised variant URL and file name; alternative to sourceIds"`
	Folder        string                               `json:"folder,omitempty" jsonschema:"relative subdirectory within the selected download root"`
	DownloadDir   string                               `json:"downloadDir,omitempty" jsonschema:"absolute download root on desktop; Docker/server runtimes reject overrides"`
	StartDownload *bool                                `json:"startDownload,omitempty" jsonschema:"start newly created tasks; existing tasks are returned without restarting"`
}

type toolError struct {
	Code        string `json:"code"`
	Message     string `json:"message"`
	Retryable   bool   `json:"retryable"`
	DownloadID  int64  `json:"downloadId,omitempty"`
	DiscoveryID string `json:"discoveryId,omitempty"`
}

func (e *toolError) Error() string { return e.Code + ": " + e.Message }

type errorOutput struct {
	Error *toolError `json:"error"`
}

func invalid(message string) error { return &toolError{Code: "invalid_argument", Message: message} }

func publicError(err error) *toolError {
	var known *toolError
	if errors.As(err, &known) {
		copy := *known
		return &copy
	}
	for _, entry := range []struct {
		err       error
		code      string
		retryable bool
	}{
		{repo.ErrVideoNotFound, "download_not_found", false},
		{service.ErrDownloadURLAlreadyExists, "download_exists", false},
		{service.ErrDownloadURLChanged, "download_changed", false},
		{service.ErrRuntimeHeadersExpired, "credentials_expired", false},
		{service.ErrDownloadQueueUnavailable, "download_queue_unavailable", true},
		{service.ErrDiscoveryDownloadUnavailable, "discovery_download_unavailable", true},
		{service.ErrDiscoveryDownloadInvalid, "invalid_argument", false},
		{service.ErrDiscoveryJobNotReady, "discovery_not_ready", true},
		{service.ErrDiscoverySourceNotFound, "discovery_source_not_found", false},
		{core.ErrCustomDownloadDirectory, "custom_directory_unsupported", false},
		{core.ErrInvalidDownloadDirectory, "invalid_directory", false},
		{core.ErrInvalidDownloadFolder, "invalid_folder", false},
		{discovery.ErrNotFound, "discovery_not_found", false},
		{discovery.ErrExecutorUnavailable, "discovery_executor_unavailable", true},
		{discovery.ErrInspectorUnavailable, "discovery_inspector_unavailable", true},
		{discovery.ErrQueueFull, "discovery_queue_full", true},
		{discovery.ErrInvalidTransition, "discovery_invalid_transition", false},
		{discovery.ErrInvalidURL, "invalid_argument", false},
		{discovery.ErrInvalidMode, "invalid_argument", false},
		{context.Canceled, "request_cancelled", true},
		{context.DeadlineExceeded, "request_timeout", true},
	} {
		if errors.Is(err, entry.err) {
			return &toolError{Code: entry.code, Message: entry.err.Error(), Retryable: entry.retryable}
		}
	}
	return &toolError{Code: "internal_error", Message: "MediaGo could not complete the operation; inspect its application log before retrying."}
}

// addTool keeps input failures and domain failures in the same safe error contract.
// Raw schema errors can include submitted header values, so are never returned.
func addTool[In, Out any](server *mcp.Server, tool *mcp.Tool, fn func(context.Context, In) (Out, error)) {
	inputSchema := mustSchema[In]()
	constrainInput(tool.Name, inputSchema)
	input, err := inputSchema.Resolve(&jsonschema.ResolveOptions{ValidateDefaults: true})
	if err != nil {
		panic(err)
	}
	outputSchema := &jsonschema.Schema{Type: "object", AnyOf: []*jsonschema.Schema{mustSchema[Out](), mustSchema[errorOutput]()}}
	output, err := outputSchema.Resolve(nil)
	if err != nil {
		panic(err)
	}
	tool.InputSchema, tool.OutputSchema = inputSchema, outputSchema
	server.AddTool(tool, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		fail := func(err error) (*mcp.CallToolResult, error) { return encodeResult(errorOutput{publicError(err)}, true) }
		arguments := req.Params.Arguments
		if len(arguments) == 0 {
			arguments = json.RawMessage(`{}`)
		}
		var value any
		if json.Unmarshal(arguments, &value) != nil {
			return fail(invalid("Arguments must be a JSON object."))
		}
		if err := input.ApplyDefaults(&value); err != nil {
			return fail(invalid("Arguments do not match this tool's input schema; see tools/list."))
		}
		if err := input.Validate(value); err != nil {
			return fail(invalid("Arguments do not match this tool's input schema; see tools/list for required fields, choices and limits."))
		}
		arguments, _ = json.Marshal(value)
		var in In
		if json.Unmarshal(arguments, &in) != nil {
			return fail(invalid("Arguments have invalid field types."))
		}
		if err := ctx.Err(); err != nil {
			return fail(err)
		}
		out, err := fn(ctx, in)
		if err != nil {
			return fail(err)
		}
		encoded, err := json.Marshal(out)
		if err != nil {
			return fail(err)
		}
		if err = json.Unmarshal(encoded, &value); err != nil {
			return fail(err)
		}
		if err = output.Validate(value); err != nil {
			return fail(err)
		}
		return encodeResult(out, false)
	})
}

func encodeResult(value any, isError bool) (*mcp.CallToolResult, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{IsError: isError, StructuredContent: json.RawMessage(data), Content: []mcp.Content{&mcp.TextContent{Text: string(data)}}}, nil
}
func mustSchema[T any]() *jsonschema.Schema {
	s, err := jsonschema.For[T](nil)
	if err != nil {
		panic(err)
	}
	return s
}
func ptr[T any](value T) *T { return &value }

func constrainInput(name string, s *jsonschema.Schema) {
	p := s.Properties
	for _, field := range []string{"url", "downloadDir", "folder", "name", "id"} {
		if v := p[field]; v != nil && v.Type == "string" {
			v.MaxLength = ptr(8192)
		}
	}
	if v := p["url"]; v != nil {
		v.MinLength = ptr(1)
		v.Pattern = `^https?://`
	}
	if v := p["id"]; v != nil {
		if v.Type == "integer" {
			v.Minimum, v.Maximum = ptr(float64(1)), ptr(float64(9007199254740991))
		} else {
			v.MinLength, v.MaxLength = ptr(1), ptr(128)
		}
	}
	if v := p["name"]; v != nil {
		v.MaxLength = ptr(255)
	}
	if v := p["headers"]; v != nil {
		v.Type, v.Types = "array", nil
		v.MaxItems = ptr(64)
		v.Items.MinLength, v.Items.MaxLength = ptr(1), ptr(8192)
	}
	if v := p["startDownload"]; v != nil {
		v.Type, v.Types, v.Default = "boolean", nil, json.RawMessage(`true`)
	}
	if v := p["type"]; v != nil {
		v.Enum = []any{"m3u8", "bilibili", "direct", "mediago", "youtube", "xiaohongshu"}
	}
	switch name {
	case "list_downloads":
		p["current"].Minimum, p["current"].Maximum, p["current"].Default = ptr(float64(1)), ptr(float64(1000000)), json.RawMessage(`1`)
		p["pageSize"].Minimum, p["pageSize"].Maximum, p["pageSize"].Default = ptr(float64(1)), ptr(float64(maxPageSize)), json.RawMessage(`50`)
		p["filter"].Enum, p["filter"].Default = []any{"", "all", "done", "list"}, json.RawMessage(`"all"`)
	case "discover_media":
		p["mode"].Enum, p["mode"].Default = []any{"auto", "browser", "inspect"}, json.RawMessage(`"auto"`)
		p["timeoutMs"].Minimum, p["timeoutMs"].Maximum, p["timeoutMs"].Default = ptr(float64(3000)), ptr(float64(30000)), json.RawMessage(`20000`)
		p["waitSeconds"].Type, p["waitSeconds"].Types = "integer", nil
		p["waitSeconds"].Minimum, p["waitSeconds"].Maximum, p["waitSeconds"].Default = ptr(float64(0)), ptr(float64(25)), json.RawMessage(`20`)
	case "download_discovered_media":
		for _, field := range []string{"sourceIds", "selections"} {
			p[field].Type, p[field].Types = "array", nil
			p[field].MinItems, p[field].MaxItems, p[field].UniqueItems = ptr(1), ptr(20), true
		}
		p["sourceIds"].Items.MinLength, p["sourceIds"].Items.MaxLength = ptr(1), ptr(128)
		selection := p["selections"].Items.Properties
		selection["sourceId"].MinLength, selection["sourceId"].MaxLength = ptr(1), ptr(128)
		selection["variantUrl"].MaxLength = ptr(8192)
		selection["name"].MaxLength = ptr(255)
		s.OneOf = []*jsonschema.Schema{{Required: []string{"sourceIds"}}, {Required: []string{"selections"}}}
	}
}

func validateURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil || strings.ContainsAny(raw, "\r\n\x00") {
		return invalid("url must be an absolute HTTP(S) URL without embedded username or password.")
	}
	return nil
}

func validateHeaders(headers []string) error {
	for _, header := range headers {
		name, value, ok := strings.Cut(header, ":")
		if !ok || !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(value) {
			return invalid("headers must contain valid Name: value entries without control characters.")
		}
	}
	return nil
}

type downloadProgress struct {
	Percent float64 `json:"percent"`
	Speed   string  `json:"speed"`
}
type downloadOutput struct {
	ID                      int64                 `json:"id"`
	Name                    string                `json:"name"`
	Type                    string                `json:"type"`
	URL                     string                `json:"url"`
	Folder                  string                `json:"folder"`
	DownloadDir             string                `json:"downloadDir,omitempty"`
	Status                  string                `json:"status"`
	IsLive                  bool                  `json:"isLive"`
	Exists                  bool                  `json:"exists"`
	File                    string                `json:"file,omitempty"`
	Files                   []string              `json:"files"`
	CreatedDate             time.Time             `json:"createdDate"`
	UpdatedDate             time.Time             `json:"updatedDate"`
	StartedAt               *time.Time            `json:"startedAt,omitempty"`
	Progress                *downloadProgress     `json:"progress,omitempty"`
	LastError               *core.DownloadFailure `json:"lastError,omitempty"`
	HasAuthentication       bool                  `json:"hasAuthentication"`
	AuthenticationAvailable bool                  `json:"authenticationAvailable"`
	AuthenticationExpiresAt *time.Time            `json:"authenticationExpiresAt,omitempty"`
	Outcome                 string                `json:"outcome,omitempty" jsonschema:"create_download only: created or existing; existing tasks are not restarted"`
}
type listDownloadsOutput struct {
	Total    int64            `json:"total"`
	List     []downloadOutput `json:"list"`
	Current  int              `json:"current"`
	PageSize int              `json:"pageSize"`
	HasMore  bool             `json:"hasMore"`
}
type stopDownloadOutput struct {
	ID       int64  `json:"id"`
	Status   string `json:"status"`
	Accepted bool   `json:"accepted"`
}
type batchItem struct {
	SourceID   string          `json:"sourceId"`
	Outcome    string          `json:"outcome" jsonschema:"created, existing, or failed"`
	DownloadID int64           `json:"downloadId,omitempty"`
	Download   *downloadOutput `json:"download,omitempty"`
	Error      *toolError      `json:"error,omitempty"`
}
type batchOutput struct {
	Items []batchItem `json:"items"`
}
