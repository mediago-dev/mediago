import { DownloadType, type DownloadTask } from "@mediago/shared-common";
import type { DownloadFormItem } from "@/store/download-dialog";

export const DOWNLOAD_URL_RE = /^(?:(?:file|https?):\/\/.+|magnet:\?.+)/i;

export const DEFAULT_DOWNLOAD_FORM_VALUES: DownloadFormItem = {
  batch: false,
  batchList: "",
  folder: "",
  headers: "",
  name: "",
  type: DownloadType.m3u8,
  url: "",
};

export interface BatchDownloadRow {
  folder: string;
  line: number;
  name: string;
  url: string;
  valid: boolean;
}

export function createDownloadFormValues(
  values: DownloadFormItem = {},
): DownloadFormItem {
  return { ...DEFAULT_DOWNLOAD_FORM_VALUES, ...values };
}

// The hidden id input registers with `valueAsNumber`, so react-hook-form turns
// its empty DOM value into NaN. Treat NaN/undefined as "no task id" so the
// overlay dialog (new task, `isEdit` layout) falls back to task creation
// instead of PUT /api/downloads/NaN ("invalid id").
export function resolveEditTaskId(id: number | undefined): number | undefined {
  return typeof id === "number" && Number.isFinite(id) ? id : undefined;
}

export function parseBatchDownloadRows(text: string): BatchDownloadRow[] {
  return text
    .split(/\r?\n/)
    .map((value, index) => ({ value: value.trim(), line: index + 1 }))
    .filter(({ value }) => value.length > 0)
    .map(({ line, value }) => {
      const parts = value.split(/\s+/);
      const [url = "", name = "", folder = ""] = parts;
      return {
        folder,
        line,
        name,
        url,
        valid: parts.length <= 3 && DOWNLOAD_URL_RE.test(url),
      };
    });
}

export function buildBatchDownloadTasks(
  rows: BatchDownloadRow[],
  type: DownloadType,
  headers?: string,
): Omit<DownloadTask, "id">[] {
  return rows.map(({ folder, name, url }) => ({
    url,
    name: name || "",
    headers: headers || undefined,
    type,
    folder: folder || undefined,
  }));
}

export function buildDownloadTasks(
  values: DownloadFormItem,
): Omit<DownloadTask, "id">[] {
  if (values.batch) {
    return buildBatchDownloadTasks(
      parseBatchDownloadRows(values.batchList ?? ""),
      values.type ?? DownloadType.m3u8,
      values.headers,
    );
  }

  const {
    name = "",
    url = "",
    headers,
    type = DownloadType.m3u8,
    folder,
  } = values;
  return [{ name, url, headers, type, folder }];
}
