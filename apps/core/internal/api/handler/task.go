package handler

import (
	"errors"
	"net/http"
	"os"
	"strconv"
	"sync"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/i18n"
	"caorushizi.cn/mediago/internal/logger"
	"caorushizi.cn/mediago/internal/tasklog"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// TaskHandler handles task-related endpoints.
type TaskHandler struct {
	queue *core.TaskQueue
	logs  *tasklog.Manager
	mu    sync.Mutex
	seq   int64
}

// NewTaskHandler creates a TaskHandler.
func NewTaskHandler(queue *core.TaskQueue, logs *tasklog.Manager) *TaskHandler {
	return &TaskHandler{
		queue: queue,
		logs:  logs,
	}
}

// Create creates a download task.
// @Summary Create a download task
// @Description Creates a new download task and adds it to the queue; task ID is optional
// @Description Supports M3U8, Bilibili, and Direct download types
// @Tags Tasks
// @Accept json
// @Produce json
// @Param task body dto.CreateTaskReq true "Download task parameters"
// @Success 200 {object} dto.SuccessResponse{data=dto.CreateTaskResponse} "Task created successfully, returns task status (pending/success)"
// @Failure 400 {object} dto.ErrorResponse "Invalid request parameters"
// @Router /tasks [post]
func (h *TaskHandler) Create(c *gin.Context) {
	var req dto.CreateTaskReq
	if err := c.ShouldBindJSON(&req); err != nil {
		logger.Warn("Invalid task creation request",
			zap.String("clientIP", c.ClientIP()),
			zap.Error(err))
		c.JSON(http.StatusBadRequest, dto.ErrorResponse{Success: false, Code: http.StatusBadRequest, Message: err.Error()})
		return
	}

	params := req.ToDownloadParams()

	logger.Info("Task creation request received",
		zap.String("id", string(params.ID)),
		zap.String("type", string(params.Type)),
		zap.String("url", params.URL),
		zap.String("clientIP", c.ClientIP()))

	status := h.queue.Enqueue(params)

	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgTaskCreated),
		Data: dto.CreateTaskResponse{
			ID:      string(params.ID),
			Message: i18n.T(c, i18n.MsgTaskEnqueued),
			Status:  string(status),
		},
	})
}

// Get retrieves task status.
// @Summary Get task status
// @Description Retrieves the status and progress information for the specified task ID
// @Tags Tasks
// @Accept json
// @Produce json
// @Param id path string true "Task ID" example(task-1)
// @Success 200 {object} dto.SuccessResponse{data=core.TaskInfo} "Task information"
// @Failure 404 {object} dto.ErrorResponse "Task not found"
// @Router /tasks/{id} [get]
func (h *TaskHandler) Get(c *gin.Context) {
	id := c.Param("id")

	task, ok := h.queue.GetTask(core.TaskID(id))
	if !ok {
		logger.Warn("Task not found",
			zap.String("id", id),
			zap.String("clientIP", c.ClientIP()))
		writeTaskNotFound(c)
		return
	}

	logger.Debug("Task info retrieved",
		zap.String("id", id),
		zap.String("status", string(task.Status)),
		zap.String("clientIP", c.ClientIP()))

	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgOK),
		Data:    task,
	})
}

// List retrieves all task statuses.
// @Summary Get all task statuses
// @Description Retrieves the status and progress information for all tasks
// @Tags Tasks
// @Accept json
// @Produce json
// @Success 200 {object} dto.SuccessResponse{data=dto.TaskListResponse} "Task list"
// @Router /tasks [get]
func (h *TaskHandler) List(c *gin.Context) {
	tasks := h.queue.GetAllTasks()

	logger.Debug("All tasks info retrieved",
		zap.Int("count", len(tasks)),
		zap.String("clientIP", c.ClientIP()))

	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgOK),
		Data: dto.TaskListResponse{
			Tasks: tasks,
			Total: len(tasks),
		},
	})
}

// Stop stops a download task.
// @Summary Stop a download task
// @Description Stops the download task with the specified ID
// @Tags Tasks
// @Accept json
// @Produce json
// @Param id path string true "Task ID" example(task-1)
// @Success 200 {object} dto.SuccessResponse{data=dto.StopTaskResponse} "Task stopped successfully"
// @Failure 404 {object} dto.ErrorResponse "Task not found"
// @Router /tasks/{id}/stop [post]
func (h *TaskHandler) Stop(c *gin.Context) {
	id := c.Param("id")

	logger.Info("Stop task request received",
		zap.String("id", id),
		zap.String("clientIP", c.ClientIP()))

	if err := h.queue.Stop(core.TaskID(id)); err != nil {
		logger.Warn("Failed to stop task",
			zap.String("id", id),
			zap.Error(err))
		if errors.Is(err, core.ErrTaskNotFound) {
			writeTaskNotFound(c)
			return
		}
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{Success: false, Code: http.StatusInternalServerError, Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgTaskStopped),
		Data:    dto.StopTaskResponse{Message: i18n.T(c, i18n.MsgTaskStopped)},
	})
}

// Logs retrieves task logs.
// @Summary Get task logs
// @Description Retrieves the full download log content for the specified task ID
// @Tags Tasks
// @Accept json
// @Produce json
// @Param id path string true "Task ID" example(task-1)
// @Success 200 {object} dto.SuccessResponse{data=dto.TaskLogResponse} "Task log content"
// @Failure 404 {object} dto.ErrorResponse "Log not found"
// @Failure 500 {object} dto.ErrorResponse "Log system not configured or read failed"
// @Router /tasks/{id}/logs [get]
func (h *TaskHandler) Logs(c *gin.Context) {
	id := c.Param("id")

	if h.logs == nil {
		logger.Error("Task log manager not configured",
			zap.String("id", id),
			zap.String("clientIP", c.ClientIP()))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Success: false,
			Code:    http.StatusInternalServerError,
			Message: i18n.T(c, i18n.MsgTaskLogNotConfigured),
		})
		return
	}

	content, err := h.logs.Read(id)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			logger.Warn("Task log not found",
				zap.String("id", id),
				zap.String("clientIP", c.ClientIP()))
			c.JSON(http.StatusNotFound, dto.ErrorResponse{
				Success: false,
				Code:    http.StatusNotFound,
				Message: i18n.T(c, i18n.MsgTaskLogNotFound),
			})
			return
		}

		logger.Error("Failed to read task log",
			zap.String("id", id),
			zap.Error(err),
			zap.String("clientIP", c.ClientIP()))
		c.JSON(http.StatusInternalServerError, dto.ErrorResponse{
			Success: false,
			Code:    http.StatusInternalServerError,
			Message: i18n.T(c, i18n.MsgTaskLogReadFailed),
		})
		return
	}

	c.JSON(http.StatusOK, dto.SuccessResponse{
		Success: true,
		Code:    http.StatusOK,
		Message: i18n.T(c, i18n.MsgOK),
		Data: dto.TaskLogResponse{
			ID:  id,
			Log: content,
		},
	})
}

func (h *TaskHandler) nextTaskID() core.TaskID {
	h.mu.Lock()
	defer h.mu.Unlock()

	h.seq++
	return core.TaskID(strconv.FormatInt(h.seq, 10))
}
