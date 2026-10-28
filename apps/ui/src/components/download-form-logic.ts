import {
  DownloadType,
  inferDownloadType,
  type DownloadTask,
} from "@mediago/common";
import {
  SMART_DOWNLOAD_TYPE,
  type DownloadFormItem,
  type DownloadFormType,
} from "@/store/download-dialog";

export const DOWNLOAD_URL_RE = /^(?:(?:file|https?):\/\/.+|magnet:\?.+)/i;

export const DEFAULT_DOWNLOAD_FORM_VALUES: DownloadFormItem = {
  downloadTarget: "local",
  proxyMode: "inherit",
  proxyUrl: "",
  batch: false,
  batchList: "",
  folder: "",
  headers: "",
  name: "",
  type: SMART_DOWNLOAD_TYPE,
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
  const merged = { ...DEFAULT_DOWNLOAD_FORM_VALUES, ...values };
  return {
    ...merged,
    downloadTarget:
      values.origin === "docker" ? "docker" : merged.downloadTarget,
    // Xiaohongshu remains an internal compatibility type, but the form has a
    // single user-facing yt-dlp option. The concrete type is restored from the
    // submitted URL by resolveDownloadTaskType.
    type:
      merged.type === DownloadType.xiaohongshu
        ? DownloadType.youtube
        : merged.type,
  };
}

export function resolveDownloadTaskType(
  selectedType: DownloadFormType,
  url: string,
): DownloadType {
  if (selectedType === SMART_DOWNLOAD_TYPE) return inferDownloadType(url);
  if (
    selectedType !== DownloadType.youtube &&
    selectedType !== DownloadType.xiaohongshu
  ) {
    return selectedType;
  }
  return inferDownloadType(url) === DownloadType.xiaohongshu
    ? DownloadType.xiaohongshu
    : DownloadType.youtube;
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
  type: DownloadFormType,
  headers?: string,
): Omit<DownloadTask, "id">[] {
  return rows.map(({ folder, name, url }) => ({
    url,
    name: name || "",
    headers: headers || undefined,
    type: resolveDownloadTaskType(type, url),
    folder: folder || undefined,
  }));
}

export function buildDownloadTasks(
  values: DownloadFormItem,
  target = values.downloadTarget ?? "local",
): Omit<DownloadTask, "id">[] {
  const proxy =
    target === "docker"
      ? {}
      : {
          proxyMode: values.proxyMode ?? "inherit",
          proxyUrl:
            values.proxyMode === "custom" ? values.proxyUrl?.trim() : "",
        };
  if (values.batch) {
    return buildBatchDownloadTasks(
      parseBatchDownloadRows(values.batchList ?? ""),
      values.type ?? SMART_DOWNLOAD_TYPE,
      values.headers,
    ).map((task) => ({ ...task, ...proxy }));
  }

  const {
    name = "",
    url = "",
    headers,
    type = SMART_DOWNLOAD_TYPE,
    folder,
  } = values;
  return [
    {
      ...proxy,
      name,
      url,
      headers,
      type: resolveDownloadTaskType(type, url),
      folder,
    },
  ];
}

export type SmartSubmitMode = "smart" | "hls-only";

export function resolveSmartSubmitMode(
  values: DownloadFormItem,
  isEdit: boolean,
): SmartSubmitMode | undefined {
  if (
    isEdit ||
    values.batch === true ||
    !/^https?:\/\//i.test(values.url?.trim() ?? "")
  ) {
    return undefined;
  }
  if (values.type === SMART_DOWNLOAD_TYPE) return "smart";
  if (values.type === DownloadType.m3u8) return "hls-only";
  return undefined;
}
