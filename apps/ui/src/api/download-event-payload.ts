import type {
  DownloadFailedData,
  DownloadFailedEvent,
} from "@mediago/shared-common";

const DOWNLOAD_ID_PATTERN = /^[1-9]\d*$/;
const MAX_SAFE_DECIMAL_LENGTH = 16;
const FAILURE_CODES = new Set(["dependency_missing", "download_failed"]);

export type PersistedDownloadEventType =
  | "start"
  | "success"
  | "failed"
  | "stopped";

export type ParsedDownloadEvent =
  | {
      type: Exclude<PersistedDownloadEventType, "failed">;
      data: { id: number };
    }
  | DownloadFailedEvent;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDownloadId(value: unknown): number | null {
  if (
    typeof value !== "string" ||
    value.length > MAX_SAFE_DECIMAL_LENGTH ||
    !DOWNLOAD_ID_PATTERN.test(value)
  ) {
    return null;
  }

  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}

export function parseDownloadEventPayload(
  type: PersistedDownloadEventType,
  payload: unknown,
): ParsedDownloadEvent | null {
  if (!isRecord(payload)) return null;

  const id = parseDownloadId(payload.id);
  if (id === null) return null;

  if (type !== "failed") {
    return { type, data: { id } };
  }

  const data: DownloadFailedData = {
    id,
    error: typeof payload.error === "string" ? payload.error : "",
  };
  if (
    typeof payload.errorCode === "string" &&
    FAILURE_CODES.has(payload.errorCode)
  ) {
    data.errorCode = payload.errorCode as DownloadFailedData["errorCode"];
  }
  if (typeof payload.dependency === "string") {
    data.dependency = payload.dependency;
  }

  return { type, data };
}
