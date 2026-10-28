package service

import "caorushizi.cn/mediago/internal/core"

func normalizeTaskProxy(input *AddDownloadTaskInput) error {
	mode, address, err := core.NormalizeDownloadProxy(input.ProxyMode, input.ProxyURL)
	if err != nil {
		return err
	}
	if err := core.ValidateDownloadProxyType(mode, address, core.DownloadType(input.Type)); err != nil {
		return err
	}
	input.ProxyMode, input.ProxyURL = mode, address
	return nil
}
