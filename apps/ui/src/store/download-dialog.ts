import {
  DownloadType,
  type DownloadTask,
  type TaskOrigin,
  type DownloadProxySettings,
} from "@mediago/common";
import { create } from "zustand";

/**
 * Form-only selection. It is resolved to an existing Core DownloadType before
 * any task is created, so neither the local nor Docker Core receives "smart".
 */
export const SMART_DOWNLOAD_TYPE = "smart" as const;
export type DownloadFormType = DownloadType | typeof SMART_DOWNLOAD_TYPE;

export interface DownloadFormItem extends DownloadProxySettings {
  downloadTarget?: "local" | "docker";
  batch?: boolean;
  batchList?: string;
  name?: string;
  type?: DownloadFormType;
  headers?: string;
  url?: string;
  id?: number;
  folder?: string;
  origin?: TaskOrigin;
}

type DownloadDialogMode = "new" | "edit";

interface DownloadDialogState {
  mode: DownloadDialogMode;
  open: boolean;
  requestId: number;
  values: DownloadFormItem;
  openNew: (values?: DownloadFormItem) => void;
  openEdit: (task: DownloadTask & { origin?: TaskOrigin }) => void;
  close: () => void;
}

export const useDownloadDialogStore = create<DownloadDialogState>((set) => ({
  mode: "new",
  open: false,
  requestId: 0,
  values: {},
  openNew: (values = {}) =>
    set((state) => ({
      mode: "new",
      open: true,
      requestId: state.requestId + 1,
      values,
    })),
  openEdit: (task) =>
    set((state) => ({
      mode: "edit",
      open: true,
      requestId: state.requestId + 1,
      values: {
        batch: false,
        id: task.id,
        name: task.name,
        url: task.url,
        headers: task.headers,
        type: task.type,
        folder: task.folder,
        origin: task.origin,
        downloadTarget: task.origin === "docker" ? "docker" : "local",
        proxyMode: task.proxyMode ?? "inherit",
        proxyUrl: task.proxyUrl ?? "",
      },
    })),
  close: () => set({ open: false }),
}));
