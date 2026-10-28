package dto

import (
	"time"

	"caorushizi.cn/mediago/internal/discovery"
)

type CreateDiscoveryReq struct {
	URL               string                  `json:"url" binding:"required"`
	Mode              discovery.DiscoveryMode `json:"mode"`
	TimeoutMS         int                     `json:"timeoutMs"`
	UseSessionCookies bool                    `json:"useSessionCookies"`
}

type CreateDiscoveryDownloadsReq struct {
	ProxyMode     string            `json:"proxyMode,omitempty"`
	ProxyURL      string            `json:"proxyUrl,omitempty"`
	SourceIDs     []string          `json:"sourceIds" binding:"required"`
	Folder        string            `json:"folder"`
	Names         map[string]string `json:"names,omitempty"`
	VariantURLs   map[string]string `json:"variantUrls,omitempty"`
	StartDownload *bool             `json:"startDownload"`
}

type BridgeDiscoverySourceReq struct {
	ID           string                 `json:"id"`
	URL          string                 `json:"url"`
	PageURL      string                 `json:"pageUrl"`
	Title        string                 `json:"title"`
	Type         discovery.SourceType   `json:"type"`
	PlaylistType discovery.PlaylistType `json:"playlistType,omitempty"`
	MaxQuality   string                 `json:"maxQuality,omitempty"`
	Variants     []discovery.HLSVariant `json:"variants,omitempty"`
	DetectedAt   time.Time              `json:"detectedAt"`
	Headers      []string               `json:"headers,omitempty"`
}

type BridgeDiscoveryCompleteReq struct {
	Sources []BridgeDiscoverySourceReq `json:"sources"`
	Partial bool                       `json:"partial"`
}

type BridgeDiscoveryFailReq struct {
	ErrorCode string                     `json:"errorCode"`
	Error     string                     `json:"error"`
	Sources   []BridgeDiscoverySourceReq `json:"sources,omitempty"`
	Partial   bool                       `json:"partial,omitempty"`
}
