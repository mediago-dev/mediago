package server

import (
	"strconv"
	"sync"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/logger"
	"go.uber.org/zap"
)

func (s *Server) setupQueueCallbacks() {
	var persistedLiveTasks sync.Map
	forgetLiveTask := func(id core.TaskID) {
		persistedLiveTasks.Delete(id)
	}

	s.queue.OnProgress(func(event core.ProgressEvent) {
		if !event.IsLive || s.downloadService == nil {
			return
		}
		if _, loaded := persistedLiveTasks.LoadOrStore(event.ID, struct{}{}); loaded {
			return
		}
		dbID, err := strconv.ParseInt(string(event.ID), 10, 64)
		if err != nil {
			persistedLiveTasks.Delete(event.ID)
			return
		}
		if _, err := s.downloadService.SetIsLive(dbID, true); err != nil {
			persistedLiveTasks.Delete(event.ID)
			logger.Warn("Failed to persist live stream detection",
				zap.String("id", string(event.ID)),
				zap.Error(err))
		}
	})

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

	s.queue.OnComplete(func(id core.TaskID, result core.DownloadResult) error {
		if s.downloadService == nil {
			return nil
		}
		dbID, err := strconv.ParseInt(string(id), 10, 64)
		if err != nil {
			return err
		}
		return s.downloadService.CompleteDownload(dbID, result)
	})

	s.queue.OnSuccess(func(id core.TaskID, result core.DownloadResult) {
		forgetLiveTask(id)
		if s.logs != nil {
			message := "Task completed successfully"
			switch {
			case result.FinalizedAfterStop:
				message = "Live recording stopped and saved"
			case result.RecoveredSegments:
				message = "Live recording ended; preserved segments were merged and saved"
			case result.RecoveredAfterError:
				message = "Live recording ended; completed media was recovered and saved"
			}
			if err := s.logs.Append(string(id), message); err != nil {
				logger.Warn("Failed to append success log",
					zap.String("id", string(id)),
					zap.Error(err))
			}
		}

		s.hub.Broadcast("download-success", map[string]interface{}{"id": id})
	})

	s.queue.OnFailed(func(id core.TaskID, err error) {
		forgetLiveTask(id)
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
				if updateErr := s.downloadService.FailDownload(dbID, err); updateErr != nil {
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
		forgetLiveTask(id)
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
