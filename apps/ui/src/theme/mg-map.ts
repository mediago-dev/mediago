import { DownloadStatus, DownloadType } from "@mediago/shared-common";
import type { MgStatus, MgType } from "./mg";

/** Map real backend DownloadStatus -> the design's status vocabulary. */
export function mapStatus(s?: DownloadStatus): MgStatus {
  switch (s) {
    case DownloadStatus.Ready:
      return "waiting";
    case DownloadStatus.Pending:
      return "preparing";
    case DownloadStatus.Downloading:
      return "downloading";
    case DownloadStatus.Stopped:
      return "paused";
    case DownloadStatus.Success:
      return "success";
    case DownloadStatus.Failed:
      return "failed";
    default:
      return "waiting";
  }
}

/** Map real backend DownloadType -> the design's type vocabulary. */
export function mapType(t?: DownloadType): MgType {
  switch (t) {
    case DownloadType.bilibili:
      return "bilibili";
    case DownloadType.youtube:
      return "youtube";
    case DownloadType.mediago:
      return "mediago";
    case DownloadType.direct:
      return "mp4";
    default:
      return "m3u8";
  }
}

/** MgStatus -> existing i18n key for the status label. */
export const statusLabelKey: Record<MgStatus, string> = {
  waiting: "pending",
  preparing: "preparing",
  downloading: "downloading",
  paused: "downloadPause",
  success: "downloadSuccess",
  failed: "downloadFailed",
};
