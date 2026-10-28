package dto

// AddDownloadReq Add download task request.
type AddDownloadReq struct {
	ProxyMode string  `json:"proxyMode,omitempty"`
	ProxyURL  string  `json:"proxyUrl,omitempty"`
	Type      string  `json:"type,omitempty"`
	Name      string  `json:"name"`
	URL       string  `json:"url" binding:"required"`
	Headers   *string `json:"headers"`
	Folder    *string `json:"folder"`
}

// AddDownloadBatchReq Batch add download tasks request.
type AddDownloadBatchReq struct {
	Tasks         []AddDownloadReq `json:"tasks" binding:"required"`
	StartDownload bool             `json:"startDownload"`
}

// EditDownloadReq Edit download task request.
type EditDownloadReq struct {
	ProxyMode *string `json:"proxyMode"`
	ProxyURL  *string `json:"proxyUrl"`
	Name      *string `json:"name"`
	URL       *string `json:"url"`
	Headers   *string `json:"headers"`
	Folder    *string `json:"folder"`
}

// DownloadPaginationReq Paginated query request.
type DownloadPaginationReq struct {
	Current  int    `form:"current" json:"current"`
	PageSize int    `form:"pageSize" json:"pageSize"`
	Filter   string `form:"filter" json:"filter"`
}

// UpdateStatusReq Batch update status request.
type UpdateStatusReq struct {
	IDs    []int64 `json:"ids" binding:"required"`
	Status string  `json:"status" binding:"required"`
}

// UpdateIsLiveReq Update live stream flag request.
type UpdateIsLiveReq struct {
	IsLive bool `json:"isLive"`
}

// StartDownloadReq Start download request.
type StartDownloadReq struct {
	LocalPath      string `json:"localPath"`
	DeleteSegments bool   `json:"deleteSegments"`
}
