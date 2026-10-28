package handler

import (
	"net/http"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/i18n"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
)

const (
	maxInspectSources          = 20
	maxInspectRequestBodyBytes = 256 << 10
)

// SourceHandler handles ephemeral metadata inspection for sniffed sources.
type SourceHandler struct {
	inspector *service.M3U8Inspector
}

// NewSourceHandler creates a source inspection handler.
func NewSourceHandler(inspector *service.M3U8Inspector) *SourceHandler {
	return &SourceHandler{inspector: inspector}
}

// Inspect returns HLS metadata without creating or persisting download tasks.
func (h *SourceHandler) Inspect(c *gin.Context) {
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxInspectRequestBodyBytes)
	var req dto.InspectSourcesReq
	if err := c.ShouldBindJSON(&req); err != nil {
		writeInvalidRequest(c)
		return
	}
	if len(req.Sources) == 0 || len(req.Sources) > maxInspectSources {
		writeSourcesCountInvalid(c)
		return
	}

	inputs := make([]service.InspectSourceInput, len(req.Sources))
	for index, source := range req.Sources {
		inputs[index] = service.InspectSourceInput{
			ProxyMode: source.ProxyMode,
			ProxyURL:  source.ProxyURL,
			ID:        source.ID,
			URL:       source.URL,
			Headers:   source.Headers,
		}
	}
	results := h.inspector.InspectBatch(c.Request.Context(), inputs)
	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgOK),
		Data:    map[string]any{"sources": results},
	})
}
