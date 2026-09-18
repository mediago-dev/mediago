package mcpserver

import (
	"context"
	"errors"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/service"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type capabilitiesOutput struct {
	ProtocolRevision          string   `json:"protocolRevision"`
	Runtime                   string   `json:"runtime" jsonschema:"desktop or server (including Docker)"`
	CustomDownloadDirectory   bool     `json:"customDownloadDirectory"`
	DefaultDownloadDirectory  string   `json:"defaultDownloadDirectory"`
	DownloadQueueAvailable    bool     `json:"downloadQueueAvailable"`
	BrowserDiscoveryAvailable bool     `json:"browserDiscoveryAvailable"`
	HLSInspectionAvailable    bool     `json:"hlsInspectionAvailable"`
	SessionCookiesSupported   bool     `json:"sessionCookiesSupported"`
	VariantSelection          bool     `json:"variantSelection"`
	DeferredDownloads         bool     `json:"deferredDownloads"`
	MaxPageSize               int      `json:"maxPageSize"`
	MaxBatchSize              int      `json:"maxBatchSize"`
	CredentialTTLSeconds      int      `json:"credentialTtlSeconds"`
	MaxCredentialTasks        int      `json:"maxCredentialTasks"`
	DownloadTypes             []string `json:"downloadTypes" jsonschema:"supported type names; individual downloader binaries may need installation"`
}

func (m *Manager) registerTools(server *mcp.Server) {
	read := &mcp.ToolAnnotations{ReadOnlyHint: true, OpenWorldHint: ptr(false)}
	localWrite := &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: ptr(false), OpenWorldHint: ptr(false)}
	networkWrite := &mcp.ToolAnnotations{ReadOnlyHint: false, DestructiveHint: ptr(false), OpenWorldHint: ptr(true)}
	addTool(server, &mcp.Tool{Name: "health_check", Description: "Check whether MediaGo MCP is running.", Annotations: read}, func(context.Context, emptyInput) (healthOutput, error) {
		return healthOutput{Status: "ok"}, nil
	})
	addTool(server, &mcp.Tool{Name: "get_capabilities", Description: "Read runtime capabilities and limits before selecting download directories or discovery modes.", Annotations: read}, func(context.Context, emptyInput) (capabilitiesOutput, error) {
		runtime := "server"
		if m.config.IsDesktop() {
			runtime = "desktop"
		}
		browser := m.discovery.ExecutorStatus().Available
		return capabilitiesOutput{
			ProtocolRevision: protocolRevision, Runtime: runtime, CustomDownloadDirectory: m.config.IsDesktop(),
			DefaultDownloadDirectory: m.config.GetLocalDir(), DownloadQueueAvailable: m.download.QueueAvailable(),
			BrowserDiscoveryAvailable: browser, HLSInspectionAvailable: m.discovery.InspectorAvailable(),
			SessionCookiesSupported: m.config.IsDesktop() && browser, VariantSelection: m.discoveryDownloads != nil,
			DeferredDownloads: true, MaxPageSize: maxPageSize, MaxBatchSize: 20,
			CredentialTTLSeconds: int(service.RuntimeHeaderTTL.Seconds()), MaxCredentialTasks: service.MaxRuntimeHeaderTasks,
			DownloadTypes: []string{"m3u8", "bilibili", "direct", "mediago", "youtube", "xiaohongshu"},
		}, nil
	})
	addTool(server, &mcp.Tool{Name: "discover_media", Description: "Discover media from a page or inspect an HLS URL. Browser mode requires an available desktop executor. useSessionCookies explicitly opts in to its signed-in session. Returned jobs never include request headers.", Annotations: networkWrite}, func(ctx context.Context, input discoverMediaInput) (discovery.DiscoveryJob, error) {
		if err := validateURL(input.URL); err != nil {
			return discovery.DiscoveryJob{}, err
		}
		if input.UseSessionCookies && (!m.config.IsDesktop() || !m.discovery.ExecutorStatus().Available) {
			return discovery.DiscoveryJob{}, invalid("useSessionCookies requires an available desktop browser executor.")
		}
		parsed, _ := url.Parse(input.URL)
		usesInspector := input.Mode == discovery.ModeInspect || (input.Mode == discovery.ModeAuto && strings.HasSuffix(strings.ToLower(parsed.Path), ".m3u8"))
		if input.UseSessionCookies && usesInspector {
			return discovery.DiscoveryJob{}, invalid("useSessionCookies is only supported with browser discovery; set mode to browser.")
		}
		job, err := m.discovery.Create(ctx, discovery.CreateDiscoveryInput{URL: input.URL, Mode: input.Mode, TimeoutMS: input.TimeoutMS, UseSessionCookies: input.UseSessionCookies})
		if err != nil {
			return discovery.DiscoveryJob{}, err
		}
		if !terminalDiscoveryStatus(job.Status) && *input.WaitSeconds > 0 {
			job, err = waitForDiscovery(ctx, m.discovery, job.ID, time.Duration(*input.WaitSeconds)*time.Second)
		}
		return safeDiscoveryJob(job), err
	})
	addTool(server, &mcp.Tool{Name: "get_media_discovery", Description: "Get a discovery job, sources and advertised HLS variant URLs; jobs expire after about 10 minutes.", Annotations: read}, func(_ context.Context, input discoveryIDInput) (discovery.DiscoveryJob, error) {
		job, err := m.discovery.Get(strings.TrimSpace(input.ID))
		return safeDiscoveryJob(job), err
	})
	addTool(server, &mcp.Tool{Name: "cancel_media_discovery", Description: "Cancel a queued or running media discovery job.", Annotations: localWrite}, func(ctx context.Context, input discoveryIDInput) (discovery.DiscoveryJob, error) {
		job, err := m.discovery.Cancel(ctx, strings.TrimSpace(input.ID))
		return safeDiscoveryJob(job), err
	})
	addTool(server, &mcp.Tool{Name: "create_download", Description: "Create a persisted download and start it by default. An existing URL returns outcome=existing and its task without restarting or changing it. Headers are never returned. Use start_download to start or retry an existing task.", Annotations: networkWrite}, m.createDownload)
	addTool(server, &mcp.Tool{Name: "download_discovered_media", Description: "Create downloads for sourceIds or selections with advertised variant URLs. Returns one outcome per selection, including existing tasks and partial failures with created IDs. Existing tasks are not restarted; rediscovery refreshes their temporary credentials.", Annotations: networkWrite}, m.downloadDiscoveredMedia)
	addTool(server, &mcp.Tool{Name: "get_download", Description: "Get a download with current queue status, progress, safe failure details and resolved output files. Credentials and raw logs are never returned.", Annotations: read}, func(_ context.Context, input getDownloadInput) (downloadOutput, error) {
		return m.getDownload(input.ID)
	})
	addTool(server, &mcp.Tool{Name: "list_downloads", Description: "List downloads with bounded pagination, current state and safe diagnostics. done selects completed tasks; list selects other persisted states.", Annotations: read}, func(_ context.Context, input listDownloadsInput) (listDownloadsOutput, error) {
		result, err := m.download.GetDownloadTasks(input.Current, input.PageSize, input.Filter, m.config.GetLocalDir())
		if err != nil {
			return listDownloadsOutput{}, err
		}
		out := listDownloadsOutput{Total: result.Total, Current: input.Current, PageSize: input.PageSize, HasMore: int64(input.Current)*int64(input.PageSize) < result.Total, List: make([]downloadOutput, 0, len(result.List))}
		for _, record := range result.List {
			out.List = append(out.List, m.downloadDTO(record))
		}
		return out, nil
	})
	addTool(server, &mcp.Tool{Name: "start_download", Description: "Start a ready task or retry a stopped/failed task. Active tasks and successful tasks with an existing output are returned unchanged; missing outputs are downloaded again. Optional fresh headers restore expired credentials. Use get_download to monitor completion.", Annotations: networkWrite}, m.startDownload)
	addTool(server, &mcp.Tool{Name: "stop_download", Description: "Request cancellation. status=stopping means finalization is still running; poll get_download for the terminal status, which can be success for a finalized live recording. Inactive tasks are returned unchanged.", Annotations: localWrite}, func(_ context.Context, input getDownloadInput) (stopDownloadOutput, error) {
		if _, err := m.download.FindByIDOrFail(input.ID); err != nil {
			return stopDownloadOutput{}, err
		}
		err := m.download.StopDownload(input.ID)
		if err != nil && !errors.Is(err, core.ErrTaskNotFound) {
			return stopDownloadOutput{}, err
		}
		out, queryErr := m.getDownload(input.ID)
		if queryErr != nil {
			e := publicError(queryErr)
			e.DownloadID = input.ID
			return stopDownloadOutput{}, e
		}
		return stopDownloadOutput{ID: input.ID, Status: out.Status, Accepted: err == nil}, nil
	})
}

func (m *Manager) createDownload(ctx context.Context, input createDownloadInput) (downloadOutput, error) {
	if err := validateURL(input.URL); err != nil {
		return downloadOutput{}, err
	}
	if err := validateHeaders(input.Headers); err != nil {
		return downloadOutput{}, err
	}
	dir, err := m.validateDownloadDirectory(input.DownloadDir, input.Folder)
	if err != nil {
		return downloadOutput{}, err
	}
	var folder *string
	if input.Folder != "" {
		folder = &input.Folder
	}
	record, err := m.download.AddDownloadTaskWithContext(ctx, &service.AddDownloadTaskInput{URL: input.URL, Type: input.Type, Name: input.Name, Folder: folder, DownloadDir: dir, Headers: service.PersistentDiscoveryHeaders(input.Headers), RuntimeHeaders: input.Headers})
	outcome := "created"
	if errors.Is(err, service.ErrDownloadURLAlreadyExists) {
		record, err = m.download.FindByURL(input.URL)
		outcome = "existing"
	}
	if err != nil {
		return downloadOutput{}, err
	}
	if record == nil {
		return downloadOutput{}, errors.New("download disappeared during creation")
	}
	if outcome == "created" && *input.StartDownload {
		if err := m.download.StartDownloadIfNeededWithContext(ctx, record.ID, record.URL, m.config.GetLocalDir(), m.config.GetDeleteSegments(), nil); err != nil {
			e := publicError(err)
			e.DownloadID = record.ID
			return downloadOutput{}, e
		}
	}
	out, err := m.getDownload(record.ID)
	if err != nil {
		e := publicError(err)
		e.DownloadID = record.ID
		return downloadOutput{}, e
	}
	out.Outcome = outcome
	return out, nil
}

func (m *Manager) startDownload(ctx context.Context, input startDownloadInput) (downloadOutput, error) {
	if err := validateHeaders(input.Headers); err != nil {
		return downloadOutput{}, err
	}
	record, err := m.download.FindByIDOrFail(input.ID)
	if err != nil {
		return downloadOutput{}, err
	}
	folder := ""
	if record.Folder != nil {
		folder = *record.Folder
	}
	if _, err := m.validateDownloadDirectory(record.DownloadDir, folder); err != nil {
		return downloadOutput{}, err
	}
	if err := m.download.StartDownloadIfNeededWithContext(ctx, input.ID, record.URL, m.config.GetLocalDir(), m.config.GetDeleteSegments(), input.Headers); err != nil {
		e := publicError(err)
		e.DownloadID = input.ID
		return downloadOutput{}, e
	}
	out, err := m.getDownload(input.ID)
	if err != nil {
		e := publicError(err)
		e.DownloadID = input.ID
		return downloadOutput{}, e
	}
	return out, nil
}

func (m *Manager) downloadDiscoveredMedia(ctx context.Context, input downloadDiscoveredMediaInput) (batchOutput, error) {
	dir, err := m.validateDownloadDirectory(input.DownloadDir, input.Folder)
	if err != nil {
		return batchOutput{}, err
	}
	if m.discoveryDownloads == nil {
		return batchOutput{}, service.ErrDiscoveryDownloadUnavailable
	}
	selections := input.Selections
	for _, id := range input.SourceIDs {
		selections = append(selections, service.DiscoveryDownloadSelection{SourceID: id})
	}
	results, err := m.discoveryDownloads.CreateDownloadBatch(ctx, strings.TrimSpace(input.ID), selections, input.Folder, dir, *input.StartDownload)
	if err != nil {
		e := publicError(err)
		e.DiscoveryID = input.ID
		return batchOutput{}, e
	}
	out := batchOutput{Items: make([]batchItem, 0, len(results))}
	for _, result := range results {
		item := batchItem{SourceID: result.SourceID, Outcome: result.Outcome}
		if result.Video != nil {
			item.DownloadID = result.Video.ID
			download, queryErr := m.getDownload(result.Video.ID)
			if queryErr == nil {
				item.Download = &download
			} else if result.Err == nil {
				result.Err = queryErr
			}
		}
		if result.Err != nil {
			item.Outcome, item.Error = "failed", publicError(result.Err)
			item.Error.DownloadID = item.DownloadID
		}
		out.Items = append(out.Items, item)
	}
	return out, nil
}

func (m *Manager) getDownload(id int64) (downloadOutput, error) {
	record, err := m.download.GetDownloadTask(id, m.config.GetLocalDir())
	if err != nil {
		return downloadOutput{}, err
	}
	return m.downloadDTO(record), nil
}

func (m *Manager) downloadDTO(record *service.DownloadTaskWithFile) downloadOutput {
	out := downloadOutput{ID: record.ID, Name: record.Name, Type: record.Type, URL: record.URL, DownloadDir: record.DownloadDir, Status: record.Status, IsLive: record.IsLive, Exists: record.Exists, File: record.File, Files: append([]string{}, record.Files...), CreatedDate: record.CreatedDate, UpdatedDate: record.UpdatedDate}
	if record.Folder != nil {
		out.Folder = *record.Folder
	}
	out.HasAuthentication, out.AuthenticationAvailable, out.AuthenticationExpiresAt = record.Authentication.Required, record.Authentication.Available, record.Authentication.ExpiresAt
	runtime := record.Runtime
	if runtime != nil {
		out.Status, out.StartedAt, out.IsLive = string(runtime.Status), runtime.StartedAt, runtime.IsLive || record.IsLive
		if runtime.StopRequested && runtime.Status == core.StatusDownloading {
			out.Status = "stopping"
		}
		out.Progress = &downloadProgress{Percent: runtime.Percent, Speed: runtime.Speed}
		out.LastError = runtime.Failure
	}
	if out.Status == "failed" && out.LastError == nil {
		failure := core.DownloadFailureFromCode(record.LastErrorCode)
		out.LastError = &failure
	}
	if runtime == nil && (out.Status == "pending" || out.Status == "downloading") {
		// A persisted running state without a worker is an interrupted task,
		// typically after restart. Expose recovery rather than endless polling.
		out.Status = "stopped"
		out.LastError = &core.DownloadFailure{Code: "download_interrupted", Message: "The previous worker is no longer running; use start_download to retry.", Retryable: out.AuthenticationAvailable}
	}
	return out
}

func (m *Manager) validateDownloadDirectory(downloadDir, folder string) (string, error) {
	if _, err := core.ResolveDownloadDirectory(m.config.GetLocalDir(), downloadDir, folder, m.config.IsDesktop()); err != nil {
		if errors.Is(err, core.ErrCustomDownloadDirectory) || errors.Is(err, core.ErrInvalidDownloadDirectory) || errors.Is(err, core.ErrInvalidDownloadFolder) {
			return "", err
		}
		return "", &toolError{Code: "invalid_directory", Message: "The download directory cannot be resolved or is not a directory."}
	}
	if downloadDir != "" {
		return filepath.Clean(downloadDir), nil
	}
	return "", nil
}

func waitForDiscovery(ctx context.Context, svc *discovery.Service, id string, timeout time.Duration) (discovery.DiscoveryJob, error) {
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	ticker := time.NewTicker(100 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			e := publicError(ctx.Err())
			e.DiscoveryID = id
			return discovery.DiscoveryJob{}, e
		case <-timer.C:
			job, err := svc.Get(id)
			if err != nil {
				e := publicError(err)
				e.DiscoveryID = id
				return job, e
			}
			return job, nil
		case <-ticker.C:
			job, err := svc.Get(id)
			if err != nil {
				e := publicError(err)
				e.DiscoveryID = id
				return job, e
			}
			if terminalDiscoveryStatus(job.Status) {
				return job, nil
			}
		}
	}
}

func terminalDiscoveryStatus(status discovery.DiscoveryStatus) bool {
	return status == discovery.StatusCompleted || status == discovery.StatusFailed || status == discovery.StatusCancelled
}
func safeDiscoveryJob(job discovery.DiscoveryJob) discovery.DiscoveryJob {
	if job.Sources == nil {
		job.Sources = []discovery.DiscoverySource{}
	}
	if job.Error != "" {
		if job.Status == discovery.StatusCancelled {
			job.Error = "Media discovery was cancelled."
		} else {
			job.Error = "Media discovery failed; use errorCode to choose the next action or inspect MediaGo's application log."
		}
	}
	return job
}
