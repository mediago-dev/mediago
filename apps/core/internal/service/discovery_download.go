package service

import (
	"caorushizi.cn/mediago/internal/db"
	"errors"
)

var (
	ErrDiscoveryDownloadUnavailable = errors.New("discovery download service unavailable")
	ErrDiscoveryDownloadInvalid     = errors.New("invalid discovery download selection")
	ErrDiscoveryJobNotReady         = errors.New("discovery job is not ready for download")
	ErrDiscoverySourceNotFound      = errors.New("discovery source not found")
)

type DiscoveryDownloadSelection struct {
	SourceID   string `json:"sourceId" jsonschema:"ID of a source returned by discovery"`
	VariantURL string `json:"variantUrl,omitempty" jsonschema:"optional exact URL from this source's variants; arbitrary URLs are rejected"`
	Name       string `json:"name,omitempty" jsonschema:"optional output name"`
}

// DiscoveryDownloadResult is internal; each transport supplies its own public DTO.
type DiscoveryDownloadResult struct {
	SourceID string
	Outcome  string
	Video    *db.Video
	Err      error
}
