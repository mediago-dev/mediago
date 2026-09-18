package handler

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/db"
	"caorushizi.cn/mediago/internal/discovery"
	"caorushizi.cn/mediago/internal/i18n"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	maxDiscoveryRequestBodyBytes = 64 << 10
	maxDiscoveryURLBytes         = 8 << 10
	maxDiscoveryDownloadSources  = 20
)

var (
	ErrDiscoveryDownloadUnavailable = service.ErrDiscoveryDownloadUnavailable
	ErrDiscoveryDownloadInvalid     = service.ErrDiscoveryDownloadInvalid
	ErrDiscoveryJobNotReady         = service.ErrDiscoveryJobNotReady
	ErrDiscoverySourceNotFound      = service.ErrDiscoverySourceNotFound
)

type DiscoveryHandler struct {
	discoverySvc *discovery.Service
	downloadSvc  *service.DownloadTaskService
	conf         ConfigStore
	hub          *sse.Hub
}

func NewDiscoveryHandler(discoverySvc *discovery.Service, downloadSvc *service.DownloadTaskService, conf ConfigStore, hub *sse.Hub) *DiscoveryHandler {
	return &DiscoveryHandler{
		discoverySvc: discoverySvc,
		downloadSvc:  downloadSvc,
		conf:         conf,
		hub:          hub,
	}
}

func (h *DiscoveryHandler) Create(c *gin.Context) {
	limitDiscoveryBody(c)
	var req dto.CreateDiscoveryReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.URL) > maxDiscoveryURLBytes {
		writeInvalidRequest(c)
		return
	}
	job, err := h.discoverySvc.Create(c.Request.Context(), discovery.CreateDiscoveryInput{
		URL:               req.URL,
		Mode:              req.Mode,
		TimeoutMS:         req.TimeoutMS,
		UseSessionCookies: req.UseSessionCookies,
	})
	if err != nil {
		writeDiscoveryDomainError(c, err)
		return
	}
	status := http.StatusOK
	if job.Status == discovery.StatusPending || job.Status == discovery.StatusRunning {
		status = http.StatusAccepted
	}
	writeDiscoverySuccess(c, status, job)
}

func (h *DiscoveryHandler) Get(c *gin.Context) {
	job, err := h.discoverySvc.Get(c.Param("id"))
	if err != nil {
		writeDiscoveryDomainError(c, err)
		return
	}
	writeDiscoverySuccess(c, http.StatusOK, job)
}

func (h *DiscoveryHandler) Cancel(c *gin.Context) {
	job, err := h.discoverySvc.Cancel(c.Request.Context(), c.Param("id"))
	if err != nil {
		writeDiscoveryDomainError(c, err)
		return
	}
	writeDiscoverySuccess(c, http.StatusOK, job)
}

func (h *DiscoveryHandler) ExecutorStatus(c *gin.Context) {
	writeDiscoverySuccess(c, http.StatusOK, h.discoverySvc.ExecutorStatus())
}

func (h *DiscoveryHandler) Downloads(c *gin.Context) {
	limitDiscoveryBody(c)
	var req dto.CreateDiscoveryDownloadsReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.SourceIDs) == 0 || len(req.SourceIDs) > maxDiscoveryDownloadSources {
		writeInvalidRequest(c)
		return
	}
	startDownload := req.StartDownload == nil || *req.StartDownload
	videos, err := h.createDownloads(c.Request.Context(), c.Param("id"), req.SourceIDs, req.Folder, "", req.Names, req.VariantURLs, startDownload)
	if err != nil {
		switch {
		case errors.Is(err, ErrDiscoveryDownloadUnavailable):
			writeErrorResponse(c, http.StatusServiceUnavailable, "discovery_download_unavailable", i18n.T(c, i18n.MsgDiscoveryDownloadUnavailable))
		case errors.Is(err, ErrDiscoveryDownloadInvalid):
			writeInvalidRequest(c)
		case errors.Is(err, ErrDiscoveryJobNotReady):
			writeErrorResponse(c, http.StatusConflict, "discovery_invalid_transition", i18n.T(c, i18n.MsgDiscoveryInvalidState))
		case errors.Is(err, ErrDiscoverySourceNotFound):
			writeErrorResponse(c, http.StatusNotFound, "discovery_source_not_found", i18n.T(c, i18n.MsgDiscoverySourceNotFound))
		case errors.Is(err, service.ErrDownloadURLAlreadyExists):
			writeErrorResponse(c, http.StatusConflict, "discovery_download_exists", i18n.T(c, i18n.MsgURLAlreadyExists))
		case errors.Is(err, discovery.ErrNotFound):
			writeDiscoveryDomainError(c, err)
		default:
			writeInternalError(c)
		}
		return
	}
	writeDiscoverySuccess(c, http.StatusOK, videos)
}

// CreateDownloads is the shared discovery-to-download handoff used by HTTP
// and MCP. Sensitive browser credentials stay in task memory for deferred starts
// and retries; persisted records receive only the safe header subset.
func (h *DiscoveryHandler) CreateDownloads(ctx context.Context, jobID string, sourceIDs []string, folderName, downloadDir string, startDownload bool) ([]*db.Video, error) {
	return h.createDownloads(ctx, jobID, sourceIDs, folderName, downloadDir, nil, nil, startDownload)
}

func (h *DiscoveryHandler) createDownloads(ctx context.Context, jobID string, sourceIDs []string, folderName, downloadDir string, names, variantURLs map[string]string, startDownload bool) ([]*db.Video, error) {
	selections := make([]service.DiscoveryDownloadSelection, 0, len(sourceIDs))
	for _, id := range sourceIDs {
		selections = append(selections, service.DiscoveryDownloadSelection{SourceID: id, Name: names[id], VariantURL: variantURLs[id]})
	}
	results, err := h.CreateDownloadBatch(ctx, jobID, selections, folderName, downloadDir, startDownload)
	if err != nil {
		return nil, err
	}
	videos := make([]*db.Video, 0, len(results))
	for _, result := range results {
		if result.Err != nil {
			return nil, result.Err
		}
		if result.Outcome == "created" {
			videos = append(videos, result.Video)
		}
	}
	if len(videos) == 0 {
		return nil, service.ErrDownloadURLAlreadyExists
	}
	return videos, nil
}

// CreateDownloadBatch validates every selection before creating records, then
// returns every outcome, including existing records and failures after creation.
func (h *DiscoveryHandler) CreateDownloadBatch(ctx context.Context, jobID string, selections []service.DiscoveryDownloadSelection, folderName, downloadDir string, startDownload bool) ([]service.DiscoveryDownloadResult, error) {
	if h.downloadSvc == nil {
		return nil, ErrDiscoveryDownloadUnavailable
	}
	if len(selections) == 0 || len(selections) > maxDiscoveryDownloadSources {
		return nil, ErrDiscoveryDownloadInvalid
	}
	job, privateHeaders, err := h.discoverySvc.DownloadSnapshot(jobID)
	if err != nil {
		return nil, err
	}
	if job.Status != discovery.StatusCompleted && job.Status != discovery.StatusFailed {
		return nil, ErrDiscoveryJobNotReady
	}
	sources := make(map[string]discovery.DiscoverySource, len(job.Sources))
	for _, source := range job.Sources {
		sources[source.ID] = source
	}
	seen := make(map[string]bool, len(selections))
	inputs := make([]*service.AddDownloadTaskInput, 0, len(selections))
	for _, selection := range selections {
		id := strings.TrimSpace(selection.SourceID)
		source, ok := sources[id]
		if !ok {
			return nil, ErrDiscoverySourceNotFound
		}
		if seen[id] {
			return nil, ErrDiscoveryDownloadInvalid
		}
		seen[id] = true
		selectedURL, err := selectedDiscoverySourceURL(source, map[string]string{id: selection.VariantURL})
		if err != nil {
			return nil, err
		}
		headers := privateHeaders[id]
		var folder *string
		if folderName != "" {
			value := folderName
			folder = &value
		}
		inputs = append(inputs, &service.AddDownloadTaskInput{
			DownloadDir:    downloadDir,
			Name:           discoverySourceName(source, map[string]string{id: selection.Name}),
			Type:           string(source.Type),
			URL:            selectedURL,
			Headers:        service.PersistentDiscoveryHeaders(headers),
			Folder:         folder,
			RuntimeHeaders: headers,
		})
	}
	results := make([]service.DiscoveryDownloadResult, 0, len(inputs))
	createdIDs := make([]int64, 0, len(inputs))
	for i, input := range inputs {
		item := service.DiscoveryDownloadResult{SourceID: strings.TrimSpace(selections[i].SourceID), Outcome: "created"}
		if err := ctx.Err(); err != nil {
			item.Outcome, item.Err = "failed", err
			results = append(results, item)
			continue
		}
		item.Video, item.Err = h.downloadSvc.AddDownloadTaskWithContext(ctx, input)
		if errors.Is(item.Err, service.ErrDownloadURLAlreadyExists) {
			item.Video, item.Err = h.downloadSvc.FindByURL(input.URL)
			item.Outcome = "existing"
			if item.Err == nil && item.Video == nil {
				item.Err = ErrDiscoveryDownloadUnavailable
			}
			if item.Err == nil && item.Video != nil && len(input.RuntimeHeaders) > 0 {
				item.Err = h.downloadSvc.SetRuntimeHeaders(item.Video.ID, input.URL, input.RuntimeHeaders)
			}
		} else if item.Err == nil {
			createdIDs = append(createdIDs, item.Video.ID)
			if startDownload {
				localPath, _ := h.conf.Get("local").(string)
				deleteSegments, _ := h.conf.Get("deleteSegments").(bool)
				item.Err = h.downloadSvc.StartDownloadIfNeededWithContext(ctx, item.Video.ID, input.URL, localPath, deleteSegments, nil)
			}
		}
		if item.Err != nil || item.Video == nil {
			item.Outcome = "failed"
		}
		results = append(results, item)
	}
	if h.hub != nil && len(createdIDs) > 0 {
		h.hub.Broadcast("download-create", map[string]any{"ids": createdIDs, "count": len(createdIDs)})
	}
	return results, nil
}

// selectedDiscoverySourceURL only accepts a URL advertised by the inspected
// master playlist. This prevents a public request from attaching private
// discovery credentials to an arbitrary destination.
func selectedDiscoverySourceURL(source discovery.DiscoverySource, variantURLs map[string]string) (string, error) {
	selectedURL := strings.TrimSpace(variantURLs[source.ID])
	if selectedURL == "" || selectedURL == source.URL {
		return source.URL, nil
	}
	for _, variant := range source.Variants {
		if selectedURL == variant.URL {
			return selectedURL, nil
		}
	}
	return "", ErrDiscoveryDownloadInvalid
}

func discoverySourceName(source discovery.DiscoverySource, names map[string]string) string {
	if name := strings.TrimSpace(names[source.ID]); name != "" {
		return name
	}
	return source.Title
}

func limitDiscoveryBody(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDiscoveryRequestBodyBytes)
}

func writeDiscoveryDomainError(c *gin.Context, err error) {
	status := http.StatusBadRequest
	message := err.Error()
	switch {
	case errors.Is(err, discovery.ErrNotFound):
		status = http.StatusNotFound
		message = i18n.T(c, i18n.MsgDiscoveryNotFound)
	case errors.Is(err, discovery.ErrExecutorUnavailable):
		status = http.StatusConflict
		message = i18n.T(c, i18n.MsgDiscoveryExecutorUnavailable)
	case errors.Is(err, discovery.ErrQueueFull):
		status = http.StatusTooManyRequests
		message = i18n.T(c, i18n.MsgDiscoveryQueueFull)
	case errors.Is(err, discovery.ErrInspectorUnavailable):
		status = http.StatusServiceUnavailable
		message = i18n.T(c, i18n.MsgDiscoveryInspectorUnavailable)
	case errors.Is(err, discovery.ErrInvalidTransition):
		status = http.StatusConflict
		message = i18n.T(c, i18n.MsgDiscoveryInvalidState)
	case errors.Is(err, discovery.ErrInvalidURL):
		message = i18n.T(c, i18n.MsgDiscoveryInvalidURL)
	case errors.Is(err, discovery.ErrInvalidMode):
		message = i18n.T(c, i18n.MsgDiscoveryInvalidMode)
	case errors.Is(err, discovery.ErrInvalidInspectURL):
		message = i18n.T(c, i18n.MsgDiscoveryInvalidInspectURL)
	}
	writeErrorResponse(c, status, discovery.ErrorCode(err), message)
}

func writeDiscoverySuccess(c *gin.Context, status int, data any) {
	c.JSON(status, dto.SuccessResponse{
		Success: true,
		Code:    status,
		Message: i18n.T(c, i18n.MsgOK),
		Data:    data,
	})
}
