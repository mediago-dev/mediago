import type { Conversion, Favorite, Video } from "./entities";

export type Controller = Record<string | symbol, any>;

export interface DownloadTask {
  id: number;
  type: DownloadType;
  name: string;
  url: string;
  headers?: string;
  status?: DownloadStatus;
  folder?: string;
  isLive?: boolean;
  createdDate?: Date;
}

export enum DownloadFilter {
  list = "list",
  done = "done",
}

export interface DownloadTaskPagination {
  current?: number;
  pageSize?: number;
  filter?: DownloadFilter;
}

export interface ConversionPagination {
  current?: number;
  pageSize?: number;
}

export interface DownloadTaskResponse {
  total: number;
  list: DownloadTaskWithFile[];
}

export interface ConversionResponse {
  total: number;
  list: Conversion[];
}

export enum DownloadStatus {
  Ready = "ready",
  Pending = "pending",
  Downloading = "downloading",
  Stopped = "stopped",
  Success = "success",
  Failed = "failed",
}

export type Task = {
  id: number;
  params: Omit<DownloadParams, "id" | "abortSignal" | "callback">;
};

export interface DownloadProgress {
  id: number;
  type: string;
  percent: string;
  speed: string;
  isLive: boolean;
  status: DownloadStatus;
}

export enum DownloadType {
  m3u8 = "m3u8",
  bilibili = "bilibili",
  direct = "direct",
  mediago = "mediago",
  youtube = "youtube",
}

export type HLSInspectionStatus = "inspecting" | "ready" | "failed";

export type HLSPlaylistType = "master" | "media" | "unknown";

export interface HLSVariantInfo {
  url: string;
  quality?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  codecs?: string;
}

export interface HLSMediaInfo {
  status: HLSInspectionStatus;
  playlistType: HLSPlaylistType;
  maxQuality?: string;
  variants: HLSVariantInfo[];
}
export type ShareIntentSource = "web" | "pwa" | "electron" | "legacy-electron";

export type ShareIntentWarning = "legacy-auto-action-disabled";

/**
 * A validated request to prefill MediaGo's existing download dialog.
 * Share intents never create or start downloads by themselves.
 */
export interface ShareIntent {
  id: string;
  version: 1;
  source: ShareIntentSource;
  createdAt: number;
  url: string;
  name?: string;
  type: DownloadType;
  warning?: ShareIntentWarning;
}

export interface ShareIntentInput {
  id?: string;
  source: ShareIntentSource;
  createdAt?: number;
  url?: string | null;
  name?: string | null;
  type?: string | null;
  warning?: ShareIntentWarning;
}

export interface DownloadParams {
  id: number;
  type: DownloadType;
  url: string;
  local: string;
  name: string;
  headers?: string;
  abortSignal: AbortController;
  proxy?: string;
  deleteSegments?: boolean;
  callback: (type: string, data: any) => void;
  folder?: string;
}

export interface DownloadTaskWithFile extends DownloadTask {
  exists?: boolean;
  file?: string;
}

export interface ListPagination {
  total: number;
  list: DownloadTaskWithFile[];
}

export enum AppTheme {
  System = "system",
  Light = "light",
  Dark = "dark",
}

export enum AppLanguage {
  System = "system",
  ZH = "zh",
  EN = "en",
  IT = "it",
}

export interface DownloadContext {
  // Whether it is live
  isLive: boolean;
  // Download progress
  percent: string;
  // Download speed
  speed: string;
  // Ready
  ready: boolean;
}

export interface ExecOptions {
  binPath: string;
  args: string[];
  abortSignal: AbortController;
  encoding?: string;
  onMessage?: (ctx: DownloadContext, message: string) => void;
}

/**
 * Platform
 */
export enum Platform {
  Windows = "win32",
  MacOS = "darwin",
  Linux = "linux",
}

export interface DownloadEvent<T = any> {
  type: string;
  data: T;
}

export interface DownloadSuccessEvent extends DownloadEvent<DownloadTask> {
  type: "success";
}

export interface DownloadFailedData {
  id: number;
  error: string;
  errorCode?: "dependency_missing" | "download_failed";
  dependency?: string;
}

export interface DownloadFailedEvent extends DownloadEvent<DownloadFailedData> {
  type: "failed";
}

export interface DownloadStoppedEvent extends DownloadEvent<{ id: number }> {
  type: "stopped";
}

export interface DownloadProgressEvent extends DownloadEvent<
  DownloadProgress[]
> {
  type: "progress";
}

/**
 * Emitted when new tasks are created — e.g. the browser extension POSTs
 * to /api/downloads, or any external client hits Go Core directly.
 * Carries the newly-created task IDs so listeners can cheaply decide
 * whether they need to refetch.
 */
export interface DownloadCreatedEvent extends DownloadEvent<{
  ids: number[];
  count: number;
}> {
  type: "created";
}

export interface EnvPath {
  binPath: string;
  dbPath: string;
  workspace: string;
  platform: string;
  local: string;
  playerUrl: string;
  coreUrl: string;
}

export interface CLIInstallOptions {
  baseUrl: string;
  apiKey?: string;
}

export interface CLIInstallStatus {
  installed: boolean;
  updateAvailable: boolean;
  inPath: boolean;
  binaryPath: string;
  configPath: string;
}

export interface MCPServerStatus {
  enabled: boolean;
  running: boolean;
  endpoint: string;
  error?: string;
}

export interface Rectangle {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface AppStore {
  // Local storage address
  local: string;
  // Download completion tone
  promptTone: boolean;
  // Proxy address
  proxy: string;
  // Whether to enable agent
  useProxy: boolean;
  // Delete the original file after downloading
  deleteSegments: boolean;
  // A new window opens the browser
  openInNewWindow: boolean;
  mainBounds?: Rectangle;
  browserBounds?: Rectangle;
  blockAds: boolean;
  // theme
  theme: AppTheme;
  // Using browser plugins
  useExtension: boolean;
  // Whether to use mobile UA
  isMobile: boolean;
  // Maximum number of simultaneous downloads
  maxRunner: number;
  // Language
  language: AppLanguage;
  // Show terminal or not
  showTerminal: boolean;
  // Privacy mode
  privacy: boolean;
  // Machine id
  machineId: string;
  // Download proxy Settings
  downloadProxySwitch: boolean;
  // Automatic update
  autoUpgrade: boolean;
  // beta versions are allowed
  allowBeta: boolean;
  // Close the main window
  closeMainWindow: boolean;
  // Whether to play sounds in the browser. The default value is mute
  audioMuted: boolean;
  // Whether to enable Docker
  enableDocker: boolean;
  // Docker URL
  dockerUrl: string;
  // Mobile player
  enableMobilePlayer: boolean;
  // server apikey
  apiKey: string;
  // Built-in local MCP server
  enableMcp: boolean;
  mcpPort: number;
  mcpToken: string;
}

export interface WebSource {
  url: string;
  type: DownloadType;
  name: string;
  headers?: string;
}

export interface BrowserStore {
  url: string;
  sourceList: WebSource[];
}

export interface SetupAuthRequest {
  apiKey: string;
}

export interface IS_SETUP_RESPONSE {
  setuped: boolean;
}

/**
 * Data/CRUD operations — routed to Go Core HTTP API.
 * Available in both Electron and web/server modes.
 */
export interface GoApi {
  getEnvPath(): Promise<EnvPath>;
  getFavorites(): Promise<Favorite[]>;
  addFavorite(
    favorite: Omit<Favorite, "id" | "createdDate" | "updatedDate">,
  ): Promise<Favorite>;
  removeFavorite(id: number): Promise<void>;
  getAppStore(): Promise<AppStore>;
  setAppStore(
    key: keyof AppStore,
    val: AppStore[keyof AppStore],
  ): Promise<void>;
  createDownloadTasks(
    tasks: Omit<DownloadTask, "id">[],
    startDownload?: boolean,
  ): Promise<Video[]>;
  getDownloadTasks(p: DownloadTaskPagination): Promise<DownloadTaskResponse>;
  startDownload(vid: number): Promise<void>;
  stopDownload(id: number): Promise<void>;
  deleteDownloadTask(id: number): Promise<void>;
  updateDownloadTask(
    task: DownloadTask,
    startDownload?: boolean,
  ): Promise<void>;
  getVideoFolders(): Promise<string[]>;
  getDownloadLog(id: number): Promise<string>;
  getConversions(pagination: ConversionPagination): Promise<ConversionResponse>;
  addConversion(conversion: {
    name: string;
    path: string;
    outputFormat: string;
    quality: string;
  }): Promise<Conversion>;
  deleteConversion(id: number): Promise<void>;
  startConversion(id: number): Promise<void>;
  stopConversion(id: number): Promise<void>;
  getPageTitle(url: string): Promise<string | undefined>;
  setupAuth(req: SetupAuthRequest): Promise<void>;
  signin(req: SetupAuthRequest): Promise<void>;
  isSetup(): Promise<IS_SETUP_RESPONSE>;
  openUrl(url: string): Promise<void>;
}

// ============================================================
// Generic dialog / shell / contextMenu types
// ============================================================

export interface DialogOpenOptions {
  type: "file" | "directory";
  filters?: { name: string; extensions: string[] }[];
  multiple?: boolean;
  /** If true, returns file contents instead of paths (only for type: 'file') */
  readContent?: boolean;
}

export interface DialogSaveOptions {
  content: string;
  defaultPath?: string;
  filters?: { name: string; extensions: string[] }[];
}

export interface ContextMenuItem {
  key: string;
  label: string;
  type?: "separator";
  role?: "copy" | "cut" | "paste" | "redo" | "selectAll" | "undo";
}

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "not-available"
  | "error";

export type UpdateErrorPhase = "check" | "download" | "install" | "unknown";

export interface UpdateErrorInfo {
  code: string;
  message: string;
  phase: UpdateErrorPhase;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  targetVersion?: string;
  progress: number;
  error?: UpdateErrorInfo;
  autoDownload: boolean;
  portable: boolean;
}

export interface UpdateCheckResult {
  mode: "external" | "in-app";
  state: UpdateState;
  externalUrl?: string;
}

export interface OpenUpdateLogsResult {
  opened: boolean;
  error?: string;
}

// ============================================================
// PlatformApi — namespaced, routed to Electron IPC in desktop
// mode, no-op stubs in web/server mode.
// ============================================================

export interface PlatformApi {
  browser: {
    loadURL(url: string): Promise<void>;
    back(): Promise<boolean>;
    reload(): Promise<void>;
    show(): Promise<void>;
    hide(): Promise<void>;
    home(): Promise<void>;
    setBounds(rect: Rectangle): Promise<void>;
    setUserAgent(isMobile: boolean): Promise<void>;
    clearCache(): Promise<void>;
    pluginReady(): Promise<void>;
    showDownloadDialog(data: Omit<DownloadTask, "id">[]): Promise<void>;
    dismissOverlayDialog(): Promise<void>;
  };
  app: {
    getEnvPath(): Promise<EnvPath>;
    getPathForFile(file: File): Promise<string>;
    /**
     * Absolute path to the bundled browser-extension directory.
     * Electron-only (web/server stub returns an empty string). Paired
     * with `shell.open()` to surface the folder in the OS file manager
     * from the Settings page.
     */
    getExtensionDir(): Promise<string>;
    getSharedState(): Promise<unknown>;
    setSharedState(state: unknown): Promise<void>;
    showBrowserWindow(): Promise<void>;
    combineToHomePage(store: BrowserStore): Promise<void>;
    drainShareIntents(): Promise<ShareIntent[]>;
  };
  dialog: {
    open(options: DialogOpenOptions): Promise<string[]>;
    save(options: DialogSaveOptions): Promise<string>;
  };
  shell: {
    open(target: string): Promise<void>;
  };
  contextMenu: {
    show(items: ContextMenuItem[]): Promise<string | null>;
  };
  cli: {
    getStatus(): Promise<CLIInstallStatus>;
    install(options: CLIInstallOptions): Promise<CLIInstallStatus>;
  };
  update: {
    getState(): Promise<UpdateState>;
    check(): Promise<UpdateCheckResult>;
    startDownload(): Promise<UpdateState>;
    install(): Promise<UpdateState>;
    openLogDirectory(): Promise<OpenUpdateLogsResult>;
    getDiagnosticInfo(): Promise<string>;
  };
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
}

/** Combined API — backward compatible union of Go + Platform */
export type MediaGoApi = GoApi & PlatformApi;
