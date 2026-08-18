package handler

import (
	"errors"
	"net/http"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/api/sse"
	"caorushizi.cn/mediago/internal/db/repo"
	"caorushizi.cn/mediago/internal/i18n"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/service"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// DownloadHandler handles database-persisted download task endpoints.
type DownloadHandler struct {
	svc  *service.DownloadTaskService
	conf ConfigStore
	hub  *sse.Hub
}

// NewDownloadHandler creates a DownloadHandler.
func NewDownloadHandler(svc *service.DownloadTaskService, conf ConfigStore, hub *sse.Hub) *DownloadHandler {
	return &DownloadHandler{svc: svc, conf: conf, hub: hub}
}

// Create adds download tasks (supports batch creation).
func (h *DownloadHandler) Create(c *gin.Context) {
	var req dto.AddDownloadBatchReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	inputs := make([]*service.AddDownloadTaskInput, 0, len(req.Tasks))
	for _, t := range req.Tasks {
		inputs = append(inputs, &service.AddDownloadTaskInput{
			Name:    t.Name,
			Type:    t.Type,
			URL:     t.URL,
			Headers: t.Headers,
			Folder:  t.Folder,
		})
	}

	videos, err := h.svc.AddDownloadTasks(inputs)
	if err != nil {
		if errors.Is(err, service.ErrDownloadURLAlreadyExists) {
			c.JSON(http.StatusConflict, dto.ErrorResponse{Success: false, Code: http.StatusConflict, Message: i18n.T(c, i18n.MsgURLAlreadyExists)})
			return
		}
		logger.Error("Failed to add download tasks", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	// Auto-start downloads if requested
	if req.StartDownload {
		localPath, _ := h.conf.Get("local").(string)
		deleteSegments, _ := h.conf.Get("deleteSegments").(bool)
		for _, v := range videos {
			if err := h.svc.StartDownload(v.ID, localPath, deleteSegments); err != nil {
				logger.Warn("auto-start download failed", zap.Int64("id", v.ID), zap.Error(err))
			}
		}
	}

	// Broadcast creation so every connected renderer (main window, overlay
	// dialog, external clients) can update its own badge/state without
	// relying on cross-WebContents IPC.
	if h.hub != nil && len(videos) > 0 {
		ids := make([]int64, 0, len(videos))
		for _, v := range videos {
			ids = append(ids, v.ID)
		}
		h.hub.Broadcast("download-create", map[string]interface{}{
			"ids":   ids,
			"count": len(ids),
		})
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: videos})
}

// List retrieves a paginated list of download tasks.
func (h *DownloadHandler) List(c *gin.Context) {
	var req dto.DownloadPaginationReq
	if err := c.ShouldBindQuery(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	localPath := c.Query("localPath")
	result, err := h.svc.GetDownloadTasks(req.Current, req.PageSize, req.Filter, localPath)
	if err != nil {
		logger.Error("Failed to get download tasks", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: result})
}

// Get retrieves a single download task.
func (h *DownloadHandler) Get(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	localPath, _ := h.conf.Get("local").(string)
	video, err := h.svc.GetDownloadTask(id, localPath)
	if err != nil {
		if errors.Is(err, repo.ErrVideoNotFound) {
			writeDownloadNotFound(c, id)
			return
		}
		logger.Error("Failed to get download task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: video})
}

// Edit edits a download task.
func (h *DownloadHandler) Edit(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	var req dto.EditDownloadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	data := make(map[string]interface{})
	if req.Name != nil {
		data["name"] = *req.Name
	}
	if req.URL != nil {
		data["url"] = *req.URL
	}
	if req.Headers != nil {
		data["headers"] = *req.Headers
	}
	if req.Folder != nil {
		data["folder"] = *req.Folder
	}

	video, err := h.svc.EditDownloadTask(id, data)
	if err != nil {
		if errors.Is(err, repo.ErrVideoNotFound) {
			writeDownloadNotFound(c, id)
			return
		}
		if errors.Is(err, service.ErrDownloadURLAlreadyExists) {
			c.JSON(http.StatusConflict, dto.ErrorResponse{Success: false, Code: http.StatusConflict, Message: i18n.T(c, i18n.MsgURLAlreadyExists)})
			return
		}
		logger.Error("Failed to edit download task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: video})
}

// Delete removes a download task.
func (h *DownloadHandler) Delete(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	if err := h.svc.DeleteDownloadTask(id); err != nil {
		logger.Error("Failed to delete download task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgDeleted)})
}

// Start begins downloading a task.
func (h *DownloadHandler) Start(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	var req dto.StartDownloadReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	// Sync the client-provided localPath into the runtime configuration
	if req.LocalPath != "" {
		if err := h.conf.Set("local", req.LocalPath); err != nil {
			logger.Warn("Failed to sync localPath to config", zap.Error(err))
		}
	}

	if err := h.svc.StartDownload(id, req.LocalPath, req.DeleteSegments); err != nil {
		if errors.Is(err, repo.ErrVideoNotFound) {
			writeDownloadNotFound(c, id)
			return
		}
		logger.Error("Failed to start download", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgDownloadStarted)})
}

// Stop stops a download.
func (h *DownloadHandler) Stop(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	if err := h.svc.StopDownload(id); err != nil {
		logger.Error("Failed to stop download", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgDownloadStopped)})
}

// Logs retrieves the download log.
func (h *DownloadHandler) Logs(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	content, err := h.svc.GetDownloadLog(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: map[string]interface{}{
		"id":  id,
		"log": content,
	}})
}

// Folders retrieves the folder list.
func (h *DownloadHandler) Folders(c *gin.Context) {
	folders, err := h.svc.GetTaskFolders()
	if err != nil {
		logger.Error("Failed to get task folders", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: folders})
}

// Export exports the download list.
func (h *DownloadHandler) Export(c *gin.Context) {
	text, err := h.svc.ExportDownloadList()
	if err != nil {
		logger.Error("Failed to export download list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: text})
}

// UpdateStatus bulk-updates task statuses.
func (h *DownloadHandler) UpdateStatus(c *gin.Context) {
	var req dto.UpdateStatusReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	if err := h.svc.SetStatus(req.IDs, req.Status); err != nil {
		logger.Error("Failed to update status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgStatusUpdated)})
}

// UpdateIsLive updates the live-stream flag.
func (h *DownloadHandler) UpdateIsLive(c *gin.Context) {
	id, ok := parseDownloadID(c)
	if !ok {
		return
	}

	var req dto.UpdateIsLiveReq
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	video, err := h.svc.SetIsLive(id, req.IsLive)
	if err != nil {
		if errors.Is(err, repo.ErrVideoNotFound) {
			writeDownloadNotFound(c, id)
			return
		}
		logger.Error("Failed to update isLive", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: video})
}

// Active retrieves active tasks.
func (h *DownloadHandler) Active(c *gin.Context) {
	tasks, err := h.svc.FindActiveTasks()
	if err != nil {
		logger.Error("Failed to find active tasks", zap.Error(err))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{Success: true, Code: http.StatusOK, Message: i18n.T(c, i18n.MsgOK), Data: tasks})
}
