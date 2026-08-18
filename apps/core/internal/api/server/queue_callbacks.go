package server

import (
	"strconv"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

func (s *Server) setupQueueCallbacks() {
	s.queue.OnStart(func(id core.TaskID) {
		if s.logs != nil {
			if err := s.logs.Reset(string(id)); err != nil {
				logger.Warn("Failed to reset task log",
					zap.String("id", string(id)),
					zap.Error(err))
			} else if err := s.logs.Append(string(id), "Task started"); err != nil {
				logger.Warn("Failed to append start log",
					zap.String("id", string(id)),
					zap.Error(err))
			}
		}

		// Update database status
		if s.downloadService != nil {
			if dbID, err := strconv.ParseInt(string(id), 10, 64); err == nil {
				if err := s.downloadService.SetStatus([]int64{dbID}, "downloading"); err != nil {
					logger.Warn("Failed to update DB status on start",
						zap.String("id", string(id)),
						zap.Error(err))
				}
			}
		}

		s.hub.Broadcast("download-start", map[string]interface{}{"id": id})
	})

	s.queue.OnSuccess(func(id core.TaskID) {
		if s.logs != nil {
			if err := s.logs.Append(string(id), "Task completed successfully"); err != nil {
				logger.Warn("Failed to append success log",
					zap.String("id", string(id)),
					zap.Error(err))
			}
		}

		// Update database status
		if s.downloadService != nil {
			if dbID, err := strconv.ParseInt(string(id), 10, 64); err == nil {
				if err := s.downloadService.SetStatus([]int64{dbID}, "success"); err != nil {
					logger.Warn("Failed to update DB status on success",
						zap.String("id", string(id)),
						zap.Error(err))
				}
			}
		}

		s.hub.Broadcast("download-success", map[string]interface{}{"id": id})
	})

	s.queue.OnFailed(func(id core.TaskID, err error) {
		if s.logs != nil {
			if appErr := s.logs.Append(string(id), "Task failed: "+err.Error()); appErr != nil {
				logger.Warn("Failed to append failure log",
					zap.String("id", string(id)),
					zap.Error(appErr))
			}
		}

		// Update database status
		if s.downloadService != nil {
			if dbID, parseErr := strconv.ParseInt(string(id), 10, 64); parseErr == nil {
				if updateErr := s.downloadService.SetStatus([]int64{dbID}, "failed"); updateErr != nil {
					logger.Warn("Failed to update DB status on failed",
						zap.String("id", string(id)),
						zap.Error(updateErr))
				}
			}
		}

		s.hub.Broadcast("download-failed", taskFailurePayload(id, err))
	})

	s.queue.OnMessage(func(m core.MessageEvent) {
		logger.Infof("[task %s] %s", m.ID, m.Message)
		if s.logs != nil {
			if err := s.logs.Append(string(m.ID), m.Message); err != nil {
				logger.Warn("Failed to append task log message",
					zap.String("id", string(m.ID)),
					zap.Error(err))
			}
		}
	})

	s.queue.OnStopped(func(id core.TaskID) {
		if s.logs != nil {
			if err := s.logs.Append(string(id), "Task stopped"); err != nil {
				logger.Warn("Failed to append stop log",
					zap.String("id", string(id)),
					zap.Error(err))
			}
		}

		// Update database status
		if s.downloadService != nil {
			if dbID, err := strconv.ParseInt(string(id), 10, 64); err == nil {
				if err := s.downloadService.SetStatus([]int64{dbID}, "stopped"); err != nil {
					logger.Warn("Failed to update DB status on stopped",
						zap.String("id", string(id)),
						zap.Error(err))
				}
			}
		}

		s.hub.Broadcast("download-stop", map[string]interface{}{"id": id})
	})
}
