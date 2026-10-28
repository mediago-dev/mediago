package core

import (
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	ProxyInherit = "inherit"
	ProxyDirect  = "direct"
	ProxyCustom  = "custom"
)

var ErrInvalidDownloadProxy = errors.New("invalid download proxy: use an HTTP or SOCKS5 URL without credentials, path, query or fragment")

// NormalizeDownloadProxy validates task-owned settings, never global settings.
func NormalizeDownloadProxy(mode, address string) (string, string, error) {
	if mode == "" {
		mode = ProxyInherit
	}
	if mode == ProxyInherit || mode == ProxyDirect {
		return mode, "", nil
	}
	if mode != ProxyCustom {
		return "", "", ErrInvalidDownloadProxy
	}
	address = strings.TrimSpace(address)
	u, err := url.Parse(address)
	if err != nil || len(address) > 2048 || strings.ContainsAny(address, "\r\n\t") || u == nil || (u.Scheme != "http" && u.Scheme != "socks5") || u.Hostname() == "" || u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return "", "", ErrInvalidDownloadProxy
	}
	if port := u.Port(); port != "" {
		n, err := strconv.Atoi(port)
		if err != nil || n < 1 || n > 65535 {
			return "", "", ErrInvalidDownloadProxy
		}
	}
	u.Path = ""
	return mode, u.String(), nil
}

// EffectiveDownloadProxy takes one snapshot per run; it does not change config.
func EffectiveDownloadProxy(mode, address string, cfg interface{}) (string, error) {
	mode, address, err := NormalizeDownloadProxy(mode, address)
	if err != nil {
		return "", err
	}
	if mode == ProxyDirect {
		return "", nil
	}
	if mode == ProxyCustom {
		return address, nil
	}
	if config, ok := cfg.(downloaderProxyConfig); ok && config.GetUseProxy() {
		return config.GetProxy(), nil
	}
	return "", nil
}

func ValidateDownloadProxyType(mode, address string, kind DownloadType) error {
	_, normalized, err := NormalizeDownloadProxy(mode, address)
	if err != nil {
		return err
	}
	if mode == ProxyDirect && kind == TypeBilibili {
		return errors.Join(ErrInvalidDownloadProxy, errors.New("BBDown cannot force direct connections; disable the system proxy or select yt-dlp"))
	}
	if kind == TypeDirect && strings.HasPrefix(normalized, "socks5:") {
		return errors.Join(ErrInvalidDownloadProxy, errors.New("direct file downloads require an HTTP proxy"))
	}
	return nil
}

// DownloadProxyEnvironment prevents other tasks' environment settings leaking in.
// Do not mutate the parent's environment: concurrent tasks may use other routes.
func DownloadProxyEnvironment(address string) []string {
	env := make([]string, 0, len(os.Environ())+8)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		switch strings.ToUpper(key) {
		case "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY":
			continue
		}
		env = append(env, entry)
	}
	for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"} {
		env = append(env, key+"="+address)
	}
	bypass := ""
	if address == "" {
		bypass = "*"
	}
	env = append(env, "NO_PROXY="+bypass, "no_proxy="+bypass)
	return env
}
