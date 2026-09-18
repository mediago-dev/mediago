/**
 * Represents the standardized success response from the API.
 */
export interface ApiResponse<T> {
  success: boolean;
  code: number;
  message: string;
  data: T;
}

/**
 * Download type for a task.
 */
export enum DownloadType {
  M3U8 = "m3u8",
  Bilibili = "bilibili",
  Direct = "direct",
  Mediago = "mediago",
  Youtube = "youtube",
  Xiaohongshu = "xiaohongshu",
}

/**
 * Status of a download task.
 */
export enum TaskStatus {
  Pending = "pending",
  Downloading = "downloading",
  Success = "success",
  Failed = "failed",
  Stopped = "stopped",
}

/**
 * Represents a single download task's information.
 */
export interface Task {
  id: string;
  type: DownloadType;
  url: string;
  name: string;
  outputPath?: string;
  artifactPaths?: string[];
  status: TaskStatus;
  percent?: number;
  speed?: string;
  isLive?: boolean;
  error?: string;
}

/**
 * Parameters for creating a new download task.
 */
export interface CreateTaskParams {
  id?: string;
  /** Optional override. MediaGo infers the downloader from the URL when omitted. */
  type?: DownloadType;
  url: string;
  name: string;
  folder?: string;
  headers?: string[];
}

/**
 * Response after creating a task.
 */
export interface CreateTaskResponse {
  id: string;
  message: string;
  status: string;
}

/**
 * Response for a list of tasks.
 */
export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

/**
 * Response for a task's full log content.
 */
export interface TaskLogResponse {
  id: string;
  log: string;
}

export interface InspectSourceInput {
  id: string;
  url: string;
  headers?: string[];
}

export interface HLSVariantInspection {
  url: string;
  quality?: string;
  width?: number;
  height?: number;
  bandwidth?: number;
  codecs?: string;
}

export interface SourceInspection {
  id: string;
  url: string;
  playlistType: "master" | "media" | "unknown";
  maxQuality?: string;
  variants: HLSVariantInspection[];
  errorCode?: "invalid_url" | "not_hls" | "fetch_failed" | "response_too_large";
  error?: string;
}

export interface InspectSourcesParams {
  sources: InspectSourceInput[];
}

export interface InspectSourcesResponse {
  sources: SourceInspection[];
}

// #region Media discovery

export type DiscoveryMode = "auto" | "browser" | "inspect";

export type DiscoveryStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface CreateDiscoveryParams {
  url: string;
  mode?: DiscoveryMode;
  timeoutMs?: number;
  useSessionCookies?: boolean;
}

/** Alias retained for consumers that name API request bodies as inputs. */
export type CreateDiscoveryInput = CreateDiscoveryParams;

export type DiscoverySourceType =
  | "m3u8"
  | "bilibili"
  | "direct"
  | "mediago"
  | "youtube"
  | "xiaohongshu";

export interface DiscoverySource {
  id: string;
  url: string;
  pageUrl: string;
  title: string;
  type: DiscoverySourceType;
  playlistType?: "master" | "media" | "unknown";
  maxQuality?: string;
  variants?: HLSVariantInspection[];
  detectedAt: string;
}

export interface DiscoveryJob {
  id: string;
  input: CreateDiscoveryParams;
  status: DiscoveryStatus;
  sources: DiscoverySource[];
  partial: boolean;
  errorCode?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt: string;
}

export interface DiscoveryExecutorStatus {
  available: boolean;
  activeDiscoveryId?: string;
  queued: number;
}

export interface DiscoveryRequestOptions {
  signal?: AbortSignal;
  /** Transport timeout. Clamped to 1–35 seconds. */
  timeoutMs?: number;
}

export interface CreateDiscoveryDownloadsParams {
  sourceIds: string[];
  folder?: string;
  names?: Record<string, string>;
  /** Optional master-playlist variant URL selected for each source id. */
  variantUrls?: Record<string, string>;
  startDownload?: boolean;
}

/** @internal Electron bridge contract. Never expose headers through public jobs. */
export interface BridgeDiscoverySource extends DiscoverySource {
  headers?: string[];
}

/** @internal Electron bridge command delivered over the dedicated event stream. */
export interface BridgeDiscoveryRequest {
  type: "discovery-requested";
  discoveryId: string;
  input: Required<
    Pick<
      CreateDiscoveryParams,
      "url" | "mode" | "timeoutMs" | "useSessionCookies"
    >
  >;
}

/** @internal Electron bridge cancellation command. */
export interface BridgeDiscoveryCancellation {
  type?: "discovery-cancelled";
  discoveryId: string;
}

/** @internal Electron bridge completion callback body. */
export interface BridgeDiscoveryCompleteParams {
  sources: BridgeDiscoverySource[];
  partial: boolean;
}

/** @internal Electron bridge failure callback body. */
export interface BridgeDiscoveryFailureParams {
  errorCode: string;
  error: string;
  sources?: BridgeDiscoverySource[];
  partial?: boolean;
}

/** @internal Typed events emitted by MediaGoBridgeClient. */
export interface BridgeEventMap {
  "discovery-requested": BridgeDiscoveryRequest;
  "discovery-cancelled": BridgeDiscoveryCancellation;
  open: Event;
  error: Event;
}

/** @internal Electron bridge event stream. */
export type BridgeEventEmitter = TypedEventEmitter<BridgeEventMap>;

// #endregion

/**
 * Parameters for updating the server configuration.
 * All fields are optional.
 */
export interface UpdateConfigParams {
  maxRunner?: number;
  localDir?: string;
  deleteSegments?: boolean;
  proxy?: string;
  useProxy?: boolean;
}

/**
 * Payload for SSE events that indicate a change in task status.
 */
export interface TaskEventPayload {
  id: string;
}

/**
 * Payload for the 'download-failed' SSE event.
 */
export interface TaskFailedEventPayload {
  id: string;
  error: string;
  errorCode?: "dependency_missing" | "download_failed";
  dependency?: string;
}

// #region Database-Persisted Types

/**
 * A download task persisted in the database.
 */
export interface DownloadTask {
  id: number;
  name: string;
  type: string;
  url: string;
  folder?: string | null;
  downloadDir?: string;
  headers?: string | null;
  outputPath?: string;
  isLive: boolean;
  status: string;
  createdDate: string;
  updatedDate: string;
  exists?: boolean;
  file?: string;
  files?: string[];
}

/**
 * Paginated response.
 */
export interface PaginatedResponse<T> {
  total: number;
  list: T[];
}

/**
 * Parameters for adding a download task.
 */
export interface AddDownloadTaskParams {
  type: string;
  url: string;
  name?: string;
  headers?: string;
  folder?: string;
}

/**
 * Parameters for batch adding download tasks.
 */
export interface AddDownloadBatchParams {
  tasks: AddDownloadTaskParams[];
  startDownload?: boolean;
}

/**
 * Parameters for editing a download task.
 */
export interface EditDownloadTaskParams {
  name?: string;
  url?: string;
  headers?: string;
  folder?: string;
}

/**
 * Parameters for starting a download.
 */
export interface StartDownloadParams {
  localPath: string;
  deleteSegments: boolean;
}

/**
 * Parameters for download task pagination.
 */
export interface DownloadPaginationParams {
  current?: number;
  pageSize?: number;
  filter?: string;
  localPath?: string;
}

/**
 * A favorite bookmark.
 */
export interface FavoriteItem {
  id: number;
  title: string;
  url: string;
  icon?: string | null;
  iconStatus: FavoriteIconStatus;
  createdDate: string;
  updatedDate: string;
}

export type FavoriteIconStatus =
  | "unresolved"
  | "ready"
  | "missing"
  | "retryable";

/**
 * Parameters for adding a favorite.
 */
export interface AddFavoriteParams {
  title: string;
  url: string;
  icon?: string;
}

/**
 * A conversion record.
 */
export interface ConversionItem {
  id: number;
  name?: string | null;
  path: string;
  status: string;
  outputPath: string;
  outputFormat: string;
  quality: string;
  progress: number;
  error?: string | null;
  createdDate: string;
  updatedDate: string;
}

/**
 * Parameters for adding a conversion.
 */
export interface AddConversionParams {
  name?: string;
  path: string;
  outputFormat: string;
  quality: string;
}

/**
 * Parameters for conversion pagination.
 */
export interface ConversionPaginationParams {
  current?: number;
  pageSize?: number;
}

// #endregion

// #region Config Types

/**
 * User-facing application configuration (AppStore).
 * Matches the Go AppStore struct and TS AppStore interface.
 */
export interface AppStore {
  local: string;
  promptTone: boolean;
  proxy: string;
  useProxy: boolean;
  deleteSegments: boolean;
  openInNewWindow: boolean;
  blockAds: boolean;
  theme: string;
  useExtension: boolean;
  isMobile: boolean;
  maxRunner: number;
  language: string;
  showTerminal: boolean;
  privacy: boolean;
  machineId: string;
  downloadProxySwitch: boolean;
  autoUpgrade: boolean;
  allowBeta: boolean;
  closeMainWindow: boolean;
  audioMuted: boolean;
  enableDocker: boolean;
  dockerUrl: string;
  enableMobilePlayer: boolean;
  apiKey: string;
  enableMcp: boolean;
  mcpToken: string;
}

export interface MCPServerStatus {
  enabled: boolean;
  running: boolean;
  endpoint: string;
  error?: string;
}

// #endregion

/**
 * Server environment paths.
 */
export interface EnvPaths {
  configDir: string;
  binDir: string;
  platform: string;
}

// #region Event Emitter Types

/**
 * Health check response payload.
 */
export interface HealthResponse {
  status: string;
}

/**
 * Maps the SSE event names to their respective payload types.
 */
export interface ConfigChangedPayload {
  key: string;
  value: any;
}

export interface TaskEventMap {
  "download-start": TaskEventPayload;
  "download-success": TaskEventPayload;
  "download-failed": TaskFailedEventPayload;
  "download-stop": TaskEventPayload;
  "config-changed": ConfigChangedPayload;
  open: Event;
  error: Event;
}

/**
 * Describes a generic, strongly-typed event emitter.
 */
export interface TypedEventEmitter<TEventMap extends Record<string, any>> {
  on<TEventName extends keyof TEventMap>(
    eventName: TEventName,
    listener: (payload: TEventMap[TEventName]) => void,
  ): this;

  off<TEventName extends keyof TEventMap>(
    eventName: TEventName,
    listener: (payload: TEventMap[TEventName]) => void,
  ): this;

  once<TEventName extends keyof TEventMap>(
    eventName: TEventName,
    listener: (payload: TEventMap[TEventName]) => void,
  ): this;

  emit<TEventName extends keyof TEventMap>(
    eventName: TEventName,
    payload: TEventMap[TEventName],
  ): boolean;

  removeAllListeners<TEventName extends keyof TEventMap>(
    eventName?: TEventName,
  ): this;

  /**
   * Closes the underlying connection or resource.
   */
  close(): void;
}

/**
 * A strongly-typed event emitter for task-related SSE events.
 */
export type TaskEventEmitter = TypedEventEmitter<TaskEventMap>;

// #endregion
