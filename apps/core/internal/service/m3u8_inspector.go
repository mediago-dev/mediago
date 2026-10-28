package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"caorushizi.cn/mediago/internal/core"
	"caorushizi.cn/mediago/internal/mediahttp"
)

const (
	inspectTimeout       = 5 * time.Second
	inspectCacheTTL      = 5 * time.Minute
	inspectCacheCapacity = 500
	maxManifestBytes     = 2 * 1024 * 1024
	maxProbeBytes        = 64 * 1024
	maxInspectWorkers    = 4
)

const (
	InspectionErrorInvalidURL = "invalid_url"
	InspectionErrorNotHLS     = "not_hls"
	InspectionErrorFetch      = "fetch_failed"
	InspectionErrorTooLarge   = "response_too_large"
)

var (
	errInspectionInvalidURL = errors.New("source URL must use HTTP or HTTPS")
	errInspectionNotHLS     = errors.New("response is not an M3U8 playlist")
	errInspectionTooLarge   = errors.New("playlist exceeds inspection size limit")
)

var ignoredInspectHeaders = map[string]struct{}{
	"accept-encoding":   {},
	"connection":        {},
	"content-length":    {},
	"host":              {},
	"proxy-connection":  {},
	"transfer-encoding": {},
}

// M3U8InspectorConfig provides current proxy settings without coupling the
// inspector to the generic application config implementation.
type M3U8InspectorConfig interface {
	Get(key string) any
}

// InspectSourceInput is an ephemeral sniffed source. It is never persisted.
type InspectSourceInput struct {
	ProxyMode string
	ProxyURL  string
	ID        string
	URL       string
	Headers   []string
}

// HLSVariant describes one video variant advertised by a master playlist.
type HLSVariant struct {
	URL       string `json:"url"`
	Quality   string `json:"quality,omitempty"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
	Bandwidth int64  `json:"bandwidth,omitempty"`
	Codecs    string `json:"codecs,omitempty"`
}

// SourceInspection is the per-source result returned to sniffing clients.
type SourceInspection struct {
	ID           string       `json:"id"`
	URL          string       `json:"url"`
	PlaylistType string       `json:"playlistType"`
	MaxQuality   string       `json:"maxQuality,omitempty"`
	Variants     []HLSVariant `json:"variants"`
	ErrorCode    string       `json:"errorCode,omitempty"`
	Error        string       `json:"error,omitempty"`
}

type fetchedManifest struct {
	body     []byte
	finalURL string
}

type inspectionCacheEntry struct {
	result    SourceInspection
	expiresAt time.Time
}

// M3U8Inspector fetches and parses HLS playlists for display metadata.
type M3U8Inspector struct {
	config M3U8InspectorConfig
	mu     sync.Mutex
	cache  map[string]inspectionCacheEntry
}

// NewM3U8Inspector creates a stateless inspector with a short-lived memory
// cache. Sensitive headers only contribute to a SHA-256 cache key.
func NewM3U8Inspector(config M3U8InspectorConfig) *M3U8Inspector {
	return &M3U8Inspector{
		config: config,
		cache:  make(map[string]inspectionCacheEntry),
	}
}

// InspectBatch inspects sources concurrently while preserving input order.
func (i *M3U8Inspector) InspectBatch(ctx context.Context, inputs []InspectSourceInput) []SourceInspection {
	results := make([]SourceInspection, len(inputs))
	if len(inputs) == 0 {
		return results
	}

	workerCount := min(maxInspectWorkers, len(inputs))
	jobs := make(chan int)
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for range workerCount {
		go func() {
			defer workers.Done()
			for index := range jobs {
				results[index] = i.Inspect(ctx, inputs[index])
			}
		}()
	}
	for index := range inputs {
		jobs <- index
	}
	close(jobs)
	workers.Wait()
	return results
}

// Inspect fetches and parses one playlist. Failures are returned in-band so a
// batch can still enrich the other sources and the UI can gracefully fall back.
func (i *M3U8Inspector) Inspect(ctx context.Context, input InspectSourceInput) SourceInspection {
	base := SourceInspection{
		ID:           input.ID,
		URL:          input.URL,
		PlaylistType: "unknown",
		Variants:     []HLSVariant{},
	}

	mode, address, proxyErr := core.NormalizeDownloadProxy(input.ProxyMode, input.ProxyURL)
	if proxyErr != nil {
		base.ErrorCode, base.Error = "fetch_failed", proxyErr.Error()
		return base
	}
	proxyKey := "useProxy"
	if input.ProxyMode != "" {
		proxyKey = "downloadProxySwitch"
	}
	if mode == core.ProxyInherit {
		address = ""
		if enabled, _ := i.config.Get(proxyKey).(bool); enabled {
			address, _ = i.config.Get("proxy").(string)
		}
	}
	cacheKey := inspectionCacheKey(input.URL, append(append([]string{}, input.Headers...), "proxy="+address))
	if cached, ok := i.loadCache(cacheKey); ok {
		cached.ID = input.ID
		return cached
	}

	manifest, err := i.fetch(ctx, input.URL, input.Headers, address)
	if err != nil {
		base.ErrorCode = inspectionErrorCode(err)
		base.Error = err.Error()
		return base
	}

	parsed, err := parseM3U8(manifest.finalURL, manifest.body)
	if err != nil {
		base.ErrorCode = inspectionErrorCode(err)
		base.Error = err.Error()
		return base
	}
	parsed.ID = input.ID
	parsed.URL = input.URL
	i.storeCache(cacheKey, parsed)
	return parsed
}

func (i *M3U8Inspector) fetch(ctx context.Context, rawURL string, headers []string, proxyOverride ...string) (fetchedManifest, error) {
	parsedURL, err := url.Parse(rawURL)
	if err != nil || (parsedURL.Scheme != "http" && parsedURL.Scheme != "https") {
		return fetchedManifest{}, errInspectionInvalidURL
	}

	requestContext, cancel := context.WithTimeout(ctx, inspectTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(requestContext, http.MethodGet, rawURL, nil)
	if err != nil {
		return fetchedManifest{}, fmt.Errorf("create playlist request: %w", err)
	}
	applyInspectHeaders(req, headers)

	transport := mediahttp.NewTransport()
	transport.Proxy = nil
	proxyValue := ""
	if len(proxyOverride) > 0 {
		proxyValue = proxyOverride[0]
	} else if useProxy, _ := i.config.Get("useProxy").(bool); useProxy {
		proxyValue, _ = i.config.Get("proxy").(string)
	}
	if proxyValue != "" {
		if !strings.Contains(proxyValue, "://") {
			proxyValue = "http://" + proxyValue
		}
		proxyURL, err := url.Parse(proxyValue)
		if err != nil {
			return fetchedManifest{}, fmt.Errorf("parse configured proxy: %w", err)
		}
		transport.Proxy = http.ProxyURL(proxyURL)
	}

	resp, err := mediahttp.Get(requestContext, rawURL, req.Header, transport, inspectTimeout)
	if err != nil {
		return fetchedManifest{}, fmt.Errorf("fetch playlist: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		return fetchedManifest{}, fmt.Errorf("fetch playlist: HTTP %d", resp.StatusCode)
	}

	body, err := readM3U8Manifest(resp.Body)
	if err != nil {
		return fetchedManifest{}, err
	}
	return fetchedManifest{body: body, finalURL: resp.FinalURL.String()}, nil
}

func readM3U8Manifest(reader io.Reader) ([]byte, error) {
	prefix, err := io.ReadAll(io.LimitReader(reader, maxProbeBytes))
	if err != nil {
		return nil, fmt.Errorf("read playlist probe: %w", err)
	}
	if !hasM3U8Header(prefix) {
		return nil, errInspectionNotHLS
	}

	remainingLimit := int64(maxManifestBytes-len(prefix)) + 1
	remainder, err := io.ReadAll(io.LimitReader(reader, remainingLimit))
	if err != nil {
		return nil, fmt.Errorf("read playlist: %w", err)
	}
	if len(prefix)+len(remainder) > maxManifestBytes {
		return nil, errInspectionTooLarge
	}
	return append(prefix, remainder...), nil
}

func hasM3U8Header(contents []byte) bool {
	text := strings.TrimPrefix(string(contents), "\ufeff")
	for _, line := range strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return line == "#EXTM3U"
		}
	}
	return false
}

func inspectionErrorCode(err error) string {
	switch {
	case errors.Is(err, errInspectionInvalidURL):
		return InspectionErrorInvalidURL
	case errors.Is(err, errInspectionNotHLS):
		return InspectionErrorNotHLS
	case errors.Is(err, errInspectionTooLarge):
		return InspectionErrorTooLarge
	default:
		return InspectionErrorFetch
	}
}

func applyInspectHeaders(req *http.Request, headers []string) {
	for _, header := range headers {
		name, value, found := strings.Cut(header, ":")
		name = strings.TrimSpace(name)
		if !found || name == "" {
			continue
		}
		if _, ignored := ignoredInspectHeaders[strings.ToLower(name)]; ignored {
			continue
		}
		req.Header.Set(name, strings.TrimSpace(value))
	}
}

func parseM3U8(rawURL string, manifest []byte) (SourceInspection, error) {
	result := SourceInspection{
		PlaylistType: "unknown",
		Variants:     []HLSVariant{},
	}
	text := strings.TrimPrefix(string(manifest), "\ufeff")
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	firstContent := ""
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			firstContent = line
			break
		}
	}
	if firstContent != "#EXTM3U" {
		return result, errInspectionNotHLS
	}

	baseURL, err := url.Parse(rawURL)
	if err != nil {
		return result, fmt.Errorf("parse playlist URL: %w", err)
	}
	mediaPlaylist := false
	seenVariants := make(map[string]struct{})
	for index := 0; index < len(lines); index++ {
		line := strings.TrimSpace(lines[index])
		switch {
		case strings.HasPrefix(line, "#EXT-X-STREAM-INF:"):
			attributes := parseM3U8Attributes(strings.TrimPrefix(line, "#EXT-X-STREAM-INF:"))
			variantLine := ""
			for index++; index < len(lines); index++ {
				candidate := strings.TrimSpace(lines[index])
				if candidate == "" || strings.HasPrefix(candidate, "#") {
					continue
				}
				variantLine = candidate
				break
			}
			if variantLine == "" {
				continue
			}
			variantURL, err := url.Parse(variantLine)
			if err != nil {
				continue
			}
			resolvedURL := baseURL.ResolveReference(variantURL).String()
			if _, exists := seenVariants[resolvedURL]; exists {
				continue
			}
			seenVariants[resolvedURL] = struct{}{}
			result.Variants = append(result.Variants, variantFromAttributes(resolvedURL, attributes))
		case strings.HasPrefix(line, "#EXTINF:") || strings.HasPrefix(line, "#EXT-X-TARGETDURATION:"):
			mediaPlaylist = true
		}
	}

	if len(result.Variants) > 0 {
		result.PlaylistType = "master"
		result.MaxQuality = maxVariantQuality(result.Variants)
	} else if mediaPlaylist {
		result.PlaylistType = "media"
	}
	return result, nil
}

func parseM3U8Attributes(value string) map[string]string {
	attributes := make(map[string]string)
	start := 0
	quoted := false
	parts := make([]string, 0, 8)
	for index, char := range value {
		if char == '"' {
			quoted = !quoted
		}
		if char == ',' && !quoted {
			parts = append(parts, value[start:index])
			start = index + 1
		}
	}
	parts = append(parts, value[start:])
	for _, part := range parts {
		key, attributeValue, found := strings.Cut(part, "=")
		if !found {
			continue
		}
		attributes[strings.TrimSpace(key)] = strings.Trim(strings.TrimSpace(attributeValue), "\"")
	}
	return attributes
}

func variantFromAttributes(variantURL string, attributes map[string]string) HLSVariant {
	variant := HLSVariant{URL: variantURL, Codecs: attributes["CODECS"]}
	resolution := attributes["RESOLUTION"]
	if width, height, found := strings.Cut(resolution, "x"); found {
		variant.Width, _ = strconv.Atoi(width)
		variant.Height, _ = strconv.Atoi(height)
		if variant.Height > 0 {
			variant.Quality = fmt.Sprintf("%dp", variant.Height)
		}
	}
	bandwidth := attributes["BANDWIDTH"]
	if bandwidth == "" {
		bandwidth = attributes["AVERAGE-BANDWIDTH"]
	}
	variant.Bandwidth, _ = strconv.ParseInt(bandwidth, 10, 64)
	return variant
}

func maxVariantQuality(variants []HLSVariant) string {
	bestHeight := 0
	var bestBandwidth int64
	quality := ""
	for _, variant := range variants {
		if variant.Height > bestHeight || (variant.Height == bestHeight && variant.Bandwidth > bestBandwidth) {
			bestHeight = variant.Height
			bestBandwidth = variant.Bandwidth
			quality = variant.Quality
		}
	}
	return quality
}

func inspectionCacheKey(rawURL string, headers []string) string {
	digest := sha256.New()
	_, _ = digest.Write([]byte(rawURL))
	for _, header := range headers {
		_, _ = digest.Write([]byte{0})
		_, _ = digest.Write([]byte(header))
	}
	return hex.EncodeToString(digest.Sum(nil))
}

func (i *M3U8Inspector) loadCache(key string) (SourceInspection, bool) {
	i.mu.Lock()
	defer i.mu.Unlock()
	entry, ok := i.cache[key]
	if !ok {
		return SourceInspection{}, false
	}
	if time.Now().After(entry.expiresAt) {
		delete(i.cache, key)
		return SourceInspection{}, false
	}
	return entry.result, true
}

func (i *M3U8Inspector) storeCache(key string, result SourceInspection) {
	i.mu.Lock()
	defer i.mu.Unlock()
	now := time.Now()
	if len(i.cache) >= inspectCacheCapacity {
		for cacheKey, entry := range i.cache {
			if now.After(entry.expiresAt) {
				delete(i.cache, cacheKey)
			}
		}
	}
	if len(i.cache) >= inspectCacheCapacity {
		for cacheKey := range i.cache {
			delete(i.cache, cacheKey)
			break
		}
	}
	result.ID = ""
	i.cache[key] = inspectionCacheEntry{result: result, expiresAt: now.Add(inspectCacheTTL)}
}
