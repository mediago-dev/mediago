package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/discovery"
	dockerproxy "caorushizi.cn/mediago/internal/docker"
	"github.com/gin-gonic/gin"
)

const maxDockerProxyRequestBytes = 8 << 20

type DockerForwarder interface {
	Forward(context.Context, string, dockerproxy.ForwardRequest) (dockerproxy.ForwardResponse, error)
}

type DockerHandler struct {
	forwarder    DockerForwarder
	discoverySvc *discovery.Service
}

func NewDockerHandler(forwarder DockerForwarder, discoveryServices ...*discovery.Service) *DockerHandler {
	handler := &DockerHandler{forwarder: forwarder}
	if len(discoveryServices) > 0 {
		handler.discoverySvc = discoveryServices[0]
	}
	return handler
}

func (h *DockerHandler) Status(c *gin.Context)         { h.proxy(c, "/healthy") }
func (h *DockerHandler) List(c *gin.Context)           { h.proxy(c, "/api/downloads") }
func (h *DockerHandler) Create(c *gin.Context)         { h.proxy(c, "/api/downloads") }
func (h *DockerHandler) Active(c *gin.Context)         { h.proxy(c, "/api/downloads/active") }
func (h *DockerHandler) InspectSources(c *gin.Context) { h.proxy(c, "/api/sources/inspect") }

func (h *DockerHandler) Get(c *gin.Context) {
	h.proxyDownload(c, "")
}

func (h *DockerHandler) Update(c *gin.Context) {
	h.proxyDownload(c, "")
}

func (h *DockerHandler) Delete(c *gin.Context) {
	h.proxyDownload(c, "")
}

func (h *DockerHandler) Start(c *gin.Context) {
	h.proxyDownload(c, "/start")
}

func (h *DockerHandler) Stop(c *gin.Context) {
	h.proxyDownload(c, "/stop")
}

func (h *DockerHandler) UpdateLive(c *gin.Context) {
	h.proxyDownload(c, "/live")
}

func (h *DockerHandler) Logs(c *gin.Context) {
	h.proxyDownload(c, "/logs")
}

func (h *DockerHandler) DiscoveryDownloads(c *gin.Context) {
	if h.discoverySvc == nil {
		writeErrorResponse(c, http.StatusServiceUnavailable, "docker_discovery_unavailable", "Docker discovery handoff is unavailable")
		return
	}
	limitDiscoveryBody(c)
	var req dto.CreateDiscoveryDownloadsReq
	if err := c.ShouldBindJSON(&req); err != nil || len(req.SourceIDs) == 0 || len(req.SourceIDs) > maxDiscoveryDownloadSources {
		writeInvalidRequest(c)
		return
	}
	job, err := h.discoverySvc.Get(c.Param("id"))
	if err != nil {
		writeDiscoveryDomainError(c, err)
		return
	}
	if job.Status != discovery.StatusCompleted && job.Status != discovery.StatusFailed {
		writeErrorResponse(c, http.StatusConflict, "discovery_invalid_transition", "Discovery is not ready")
		return
	}
	sources := make(map[string]discovery.DiscoverySource, len(job.Sources))
	for _, source := range job.Sources {
		sources[source.ID] = source
	}
	seen := make(map[string]struct{}, len(req.SourceIDs))
	tasks := make([]dto.AddDownloadReq, 0, len(req.SourceIDs))
	for _, rawID := range req.SourceIDs {
		sourceID := strings.TrimSpace(rawID)
		source, ok := sources[sourceID]
		if !ok {
			writeErrorResponse(c, http.StatusNotFound, "discovery_source_not_found", "Discovery source was not found")
			return
		}
		if _, duplicate := seen[sourceID]; duplicate {
			writeInvalidRequest(c)
			return
		}
		seen[sourceID] = struct{}{}
		selectedURL, err := selectedDiscoverySourceURL(source, req.VariantURLs)
		if err != nil {
			writeInvalidRequest(c)
			return
		}
		headers, _ := h.discoverySvc.PrivateHeaders(job.ID, sourceID)
		headerText := strings.Join(headers, "\n")
		var headerValue *string
		if headerText != "" {
			headerValue = &headerText
		}
		var folder *string
		if req.Folder != "" {
			folderValue := req.Folder
			folder = &folderValue
		}
		tasks = append(tasks, dto.AddDownloadReq{
			Name:    discoverySourceName(source, req.Names),
			Type:    string(source.Type),
			URL:     selectedURL,
			Headers: headerValue,
			Folder:  folder,
		})
	}
	startDownload := req.StartDownload == nil || *req.StartDownload
	payload, err := json.Marshal(dto.AddDownloadBatchReq{Tasks: tasks, StartDownload: startDownload})
	if err != nil {
		writeInternalError(c)
		return
	}
	h.forward(c, dockerproxy.ForwardRequest{
		Method:         http.MethodPost,
		Path:           "/api/downloads",
		Body:           bytes.NewReader(payload),
		ContentType:    "application/json",
		AcceptLanguage: c.GetHeader("Accept-Language"),
	})
}

func (h *DockerHandler) proxyDownload(c *gin.Context, suffix string) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}
	h.proxy(c, fmt.Sprintf("/api/downloads/%d%s", id, suffix))
}

func (h *DockerHandler) proxy(c *gin.Context, targetPath string) {
	if h.forwarder == nil {
		writeErrorResponse(c, http.StatusServiceUnavailable, "docker_unavailable", "Docker proxy is unavailable")
		return
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxDockerProxyRequestBytes)
	h.forward(c, dockerproxy.ForwardRequest{
		Method:         c.Request.Method,
		Path:           targetPath,
		RawQuery:       c.Request.URL.RawQuery,
		Body:           c.Request.Body,
		ContentType:    c.GetHeader("Content-Type"),
		AcceptLanguage: c.GetHeader("Accept-Language"),
	})
}

func (h *DockerHandler) forward(c *gin.Context, request dockerproxy.ForwardRequest) {
	if h.forwarder == nil {
		writeErrorResponse(c, http.StatusServiceUnavailable, "docker_unavailable", "Docker proxy is unavailable")
		return
	}
	response, err := h.forwarder.Forward(c.Request.Context(), c.Request.Host, request)
	if err != nil {
		status := http.StatusBadGateway
		code := "docker_proxy_failed"
		if errors.Is(err, dockerproxy.ErrDisabled) || errors.Is(err, dockerproxy.ErrInvalidTarget) || errors.Is(err, dockerproxy.ErrRecursiveTarget) {
			status = http.StatusServiceUnavailable
			code = "docker_unavailable"
		}
		writeErrorResponse(c, status, code, err.Error())
		return
	}
	contentType := response.ContentType
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Data(response.StatusCode, contentType, response.Body)
}
