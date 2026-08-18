package handler

import (
	"net/http"
	"strconv"

	"caorushizi.cn/mediago/internal/api/dto"
	"caorushizi.cn/mediago/internal/i18n"
	"github.com/gin-gonic/gin"
)

const (
	errorCodeInvalidID        = "invalid_id"
	errorCodeDownloadNotFound = "download_not_found"
	errorCodeTaskNotFound     = "task_not_found"
)

func parseDownloadID(c *gin.Context) (int64, bool) {
	rawID := c.Param("id")
	if rawID == "" {
		writeInvalidID(c)
		return 0, false
	}
	for _, char := range rawID {
		if char < '0' || char > '9' {
			writeInvalidID(c)
			return 0, false
		}
	}

	id, err := strconv.ParseInt(rawID, 10, 64)
	if err != nil || id <= 0 {
		writeInvalidID(c)
		return 0, false
	}
	return id, true
}

func writeInvalidID(c *gin.Context) {
	writeErrorResponse(c, http.StatusBadRequest, errorCodeInvalidID, i18n.T(c, i18n.MsgInvalidID))
}

func writeDownloadNotFound(c *gin.Context, id int64) {
	writeErrorResponse(c, http.StatusNotFound, errorCodeDownloadNotFound, i18n.T(c, i18n.MsgVideoNotFound, id))
}

func writeTaskNotFound(c *gin.Context) {
	writeErrorResponse(c, http.StatusNotFound, errorCodeTaskNotFound, i18n.T(c, i18n.MsgTaskNotFound))
}

func writeErrorResponse(c *gin.Context, status int, errorCode, message string) {
	c.JSON(status, dto.ErrorResponse{
		Success:   false,
		Code:      status,
		Message:   message,
		ErrorCode: errorCode,
	})
}
