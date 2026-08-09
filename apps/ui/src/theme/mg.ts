/**
 * MediaGo redesign — status / type accent metadata.
 * Mirrors `_statusMeta()` and `_typeMeta()` in the source design (MediaGo.dc.html).
 *
 * Keys use the design's own vocabulary. Real backend enums
 * (DownloadStatus / download type) are mapped onto these in the components,
 * so this module stays a pure presentation table.
 */

export type MgStatus =
  | "waiting"
  | "preparing"
  | "downloading"
  | "paused"
  | "success"
  | "failed";

export interface StatusMeta {
  /** foreground / icon color */
  color: string;
  /** soft background tint (icon chip, status pill) */
  bg: string;
  /** progress-bar fill (solid or gradient) */
  bar: string;
}

export const MG_STATUS: Record<MgStatus, StatusMeta> = {
  waiting: { color: "#94a3b8", bg: "rgba(148,163,184,.14)", bar: "#94a3b8" },
  preparing: { color: "#8b5cf6", bg: "rgba(139,92,246,.14)", bar: "#8b5cf6" },
  downloading: {
    color: "#3b82f6",
    bg: "rgba(59,130,246,.14)",
    bar: "linear-gradient(90deg,#3b82f6,#60a5fa)",
  },
  paused: { color: "#f59e0b", bg: "rgba(245,158,11,.15)", bar: "#f59e0b" },
  success: { color: "#10b981", bg: "rgba(16,185,129,.14)", bar: "#10b981" },
  failed: { color: "#f43f5e", bg: "rgba(244,63,94,.13)", bar: "#f43f5e" },
};

export function statusMeta(s: MgStatus | string): StatusMeta {
  return MG_STATUS[s as MgStatus] ?? MG_STATUS.waiting;
}

export type MgType = "m3u8" | "bilibili" | "youtube" | "mp4" | "mediago";

export interface TypeMeta {
  label: string;
  glyph: string;
  color: string;
  bg: string;
}

export const MG_TYPE: Record<MgType, TypeMeta> = {
  m3u8: {
    label: "M3U8",
    glyph: "🎬",
    color: "#3b82f6",
    bg: "rgba(59,130,246,.13)",
  },
  bilibili: {
    label: "B站",
    glyph: "📺",
    color: "#fb7299",
    bg: "rgba(251,114,153,.14)",
  },
  youtube: {
    label: "YT",
    glyph: "▶️",
    color: "#f43f5e",
    bg: "rgba(244,63,94,.12)",
  },
  mp4: {
    label: "MP4",
    glyph: "🎞️",
    color: "#10b981",
    bg: "rgba(16,185,129,.13)",
  },
  mediago: {
    label: "MG",
    glyph: "⚡",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,.14)",
  },
};

export function typeMeta(t: MgType | string): TypeMeta {
  return MG_TYPE[t as MgType] ?? MG_TYPE.m3u8;
}
