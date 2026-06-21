import type {
  DownloadTaskWithFile,
  DownloadType,
} from "@mediago/shared-common";
import { create } from "zustand";

export interface NewDownloadPrefill {
  url?: string;
  name?: string;
  type?: DownloadType;
  headers?: string;
  folder?: string;
  batch?: boolean;
  batchList?: string;
}

/**
 * Transient UI state for the redesign's global overlays + shell chrome:
 * the New/Edit download modal, the task right-click context menu, and the
 * desktop sidebar collapse. Kept out of the data stores on purpose.
 */
type DownloadModalMode = "new" | "edit";

interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  taskId: number | null;
}

const COLLAPSE_KEY = "mediago-sidebar-collapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(COLLAPSE_KEY) === "true";
  } catch {
    return false;
  }
}

interface UiState {
  // sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // new / edit download modal
  downloadModalOpen: boolean;
  downloadModalMode: DownloadModalMode;
  editTask: DownloadTaskWithFile | null;
  prefill: NewDownloadPrefill | null;
  openNewDownload: (prefill?: NewDownloadPrefill) => void;
  openEditDownload: (task: DownloadTaskWithFile) => void;
  closeDownloadModal: () => void;

  // task context menu
  ctx: ContextMenuState;
  openContextMenu: (taskId: number, x: number, y: number) => void;
  closeContextMenu: () => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarCollapsed: readCollapsed(),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, String(next));
      } catch {
        // ignore
      }
      return { sidebarCollapsed: next };
    }),

  downloadModalOpen: false,
  downloadModalMode: "new",
  editTask: null,
  prefill: null,
  openNewDownload: (prefill) =>
    set({
      downloadModalOpen: true,
      downloadModalMode: "new",
      editTask: null,
      prefill: prefill ?? null,
    }),
  openEditDownload: (task) =>
    set({
      downloadModalOpen: true,
      downloadModalMode: "edit",
      editTask: task,
      prefill: null,
    }),
  closeDownloadModal: () => set({ downloadModalOpen: false }),

  ctx: { open: false, x: 0, y: 0, taskId: null },
  openContextMenu: (taskId, x, y) => set({ ctx: { open: true, x, y, taskId } }),
  closeContextMenu: () => set((s) => ({ ctx: { ...s.ctx, open: false } })),
}));
