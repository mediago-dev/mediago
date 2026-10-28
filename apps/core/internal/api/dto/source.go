package dto

// InspectSourceReq describes one sniffed HLS source to inspect.
type InspectSourceReq struct {
	ProxyMode string   `json:"proxyMode,omitempty"`
	ProxyURL  string   `json:"proxyUrl,omitempty"`
	ID        string   `json:"id" binding:"required"`
	URL       string   `json:"url" binding:"required"`
	Headers   []string `json:"headers"`
}

// InspectSourcesReq batches source inspection to avoid one request per
// playlist when a page emits several HLS requests at once.
type InspectSourcesReq struct {
	Sources []InspectSourceReq `json:"sources" binding:"required"`
}
