// DOWNLOAD_EVENT_NAME is used as the channel name for dispatching download events
import type { DownloadEvent } from "@mediago/shared-common";
import { http, isWeb } from "@/utils";
import { useDownloadStore } from "@/store/download";
import { useAppStore } from "@/store/app";
import {
  parseDownloadEventPayload,
  type PersistedDownloadEventType,
} from "./download-event-payload";

type Callback = (...args: unknown[]) => void;
type DownloadEventCallback = (_event: null, data: DownloadEvent) => void;

let es: EventSource | null = null;
let currentCoreUrl: string | null = null;
let connectedApiKey = "";
let stopWatchingApiKey: (() => void) | null = null;

const downloadListeners = new Set<DownloadEventCallback>();
const configListeners = new Set<Callback>();
const INVALID_DOWNLOAD_EVENT_WARNING = "Ignored invalid download event";

function logDownloadProtocolWarning(message: string) {
  // The UI has no logger facade; keep this warning fixed and payload-free.
  // eslint-disable-next-line no-console
  console.warn(message);
}

let pollingTimer: ReturnType<typeof setTimeout> | null = null;
let pollingGeneration = 0;
let pollingEnabled = false;
let pollingRequestInFlight = false;

function stopEventStream() {
  if (!es) return;
  es.close();
  es = null;
}

function canConnectToGoEvents(apiKey: string) {
  return !isWeb || apiKey.length > 0;
}

function watchApiKey() {
  if (stopWatchingApiKey) return;

  stopWatchingApiKey = useAppStore.subscribe((state, previousState) => {
    if (state.apiKey === previousState.apiKey) return;
    if (!currentCoreUrl || state.apiKey === connectedApiKey) return;
    initGoEvents(currentCoreUrl);
  });
}

export interface DownloadSseEventSource {
  addEventListener(
    name: string,
    listener: (event: MessageEvent<string>) => void,
  ): void;
}

export interface DownloadSseCollaborators {
  dispatchDownload: (event: DownloadEvent) => void;
  startProgressPolling: () => void;
  stopProgressPollingIfIdle: () => unknown;
  protocolWarning: (message: string) => void;
}

const DOWNLOAD_SSE_EVENTS = [
  ["download-start", "start", "start"],
  ["download-success", "success", "stop-if-idle"],
  ["download-failed", "failed", "stop-if-idle"],
  ["download-stop", "stopped", "stop-if-idle"],
] as const satisfies ReadonlyArray<
  readonly [string, PersistedDownloadEventType, "start" | "stop-if-idle"]
>;

export function registerDownloadSseListeners(
  eventSource: DownloadSseEventSource,
  collaborators: DownloadSseCollaborators,
) {
  for (const [eventName, eventType, pollingTransition] of DOWNLOAD_SSE_EVENTS) {
    eventSource.addEventListener(eventName, (event) => {
      let payload: unknown;
      try {
        payload = JSON.parse(event.data);
      } catch {
        collaborators.protocolWarning(INVALID_DOWNLOAD_EVENT_WARNING);
        return;
      }

      const parsedEvent = parseDownloadEventPayload(eventType, payload);
      if (!parsedEvent) {
        collaborators.protocolWarning(INVALID_DOWNLOAD_EVENT_WARNING);
        return;
      }

      collaborators.dispatchDownload(parsedEvent);
      if (pollingTransition === "start") {
        collaborators.startProgressPolling();
      } else {
        void collaborators.stopProgressPollingIfIdle();
      }
    });
  }
}

/**
 * Initialize Go Core SSE event stream.
 * Called once from App.tsx after discovering the core URL.
 */
export function initGoEvents(coreUrl: string) {
  currentCoreUrl = coreUrl;
  stopEventStream();

  const apiKey = useAppStore.getState().apiKey;
  connectedApiKey = apiKey;
  watchApiKey();

  // Web API endpoints require authentication. Keep both SSE and progress
  // polling dormant on the sign-in page, then reconnect automatically when
  // the API key changes after a successful sign-in.
  if (!canConnectToGoEvents(apiKey)) {
    stopPolling();
    return;
  }

  const eventsUrl = new URL("/api/events", coreUrl);
  if (apiKey) eventsUrl.searchParams.set("token", apiKey);
  es = new EventSource(eventsUrl);

  // Task creation is broadcast from Go Core's download.Create handler.
  // Driving the sidebar badge from SSE (instead of the local `increase()`
  // call in the form/panel handlers) keeps the count correct across
  // WebContents — e.g. the source-extract overlay dialog has its own
  // Zustand instance and its local store updates never reach the main
  // window.
  es.addEventListener("download-create", (e) => {
    try {
      const payload = JSON.parse(e.data);
      const count =
        typeof payload?.count === "number" && payload.count > 0
          ? payload.count
          : 1;
      const ids: number[] = Array.isArray(payload?.ids)
        ? payload.ids.map((id: unknown) => Number(id))
        : [];
      const { increase } = useDownloadStore.getState();
      for (let i = 0; i < count; i++) increase();

      // Also fan out to download-event listeners so `useTasks` can
      // revalidate its list — otherwise tasks imported externally
      // (browser extension's HTTP mode, Docker clients) only bump
      // the sidebar badge and the list stays stale until a manual
      // refresh.
      dispatchDownload({ type: "created", data: { ids, count } });
    } catch {
      // ignore malformed payloads
    }
  });

  registerDownloadSseListeners(es, {
    dispatchDownload,
    startProgressPolling,
    stopProgressPollingIfIdle,
    protocolWarning: logDownloadProtocolWarning,
  });

  es.addEventListener("config-changed", (e) => {
    const payload = JSON.parse(e.data);
    dispatchConfig({ key: payload.key, value: payload.value });
  });

  // Check on init whether there are already active downloads
  startProgressPolling();
}

/**
 * Subscribe to download events (start/success/failed/stopped/progress).
 * Callback receives (null, eventData) to match existing consumer pattern.
 * Returns an unsubscribe function.
 */
export function onDownloadEvent(cb: DownloadEventCallback): () => void {
  downloadListeners.add(cb);
  return () => {
    downloadListeners.delete(cb);
  };
}

/**
 * Subscribe to config-changed events.
 * Callback receives (null, { key, value }).
 * Returns an unsubscribe function.
 */
export function onConfigChanged(cb: Callback): () => void {
  configListeners.add(cb);
  return () => {
    configListeners.delete(cb);
  };
}

function dispatchDownload(data: DownloadEvent) {
  downloadListeners.forEach((cb) => cb(null, data));
}

function dispatchConfig(data: unknown) {
  configListeners.forEach((cb) => cb(null, data));
}

interface TaskListResponse {
  tasks: Array<{
    id: string;
    type: string;
    percent: number;
    speed: string;
    isLive: boolean;
    status: string;
  }>;
  total: number;
}

// --- Progress polling (only while downloads are active) ---

function scheduleProgressPoll(delayMs: number) {
  if (!pollingEnabled || pollingTimer || pollingRequestInFlight) return;
  pollingTimer = setTimeout(() => {
    pollingTimer = null;
    void pollProgress();
  }, delayMs);
}

async function pollProgress() {
  if (!pollingEnabled || pollingRequestInFlight) return;
  if (!canConnectToGoEvents(useAppStore.getState().apiKey)) {
    stopPolling();
    return;
  }
  pollingRequestInFlight = true;
  const requestGeneration = pollingGeneration;

  try {
    // Use /api/tasks which returns TaskInfo with percent/speed/isLive.
    const result = await http.get<unknown, TaskListResponse>("/api/tasks", {
      timeout: 5000,
    });
    if (requestGeneration !== pollingGeneration || !pollingEnabled) return;

    const activeTasks = result.tasks.filter(
      (t) => t.percent > 0 && t.percent < 100 && t.status === "downloading",
    );
    if (activeTasks.length > 0) {
      const progress = activeTasks.map((t) => ({
        id: Number(t.id),
        type: t.type,
        percent: String(t.percent || 0),
        speed: t.speed || "",
        isLive: t.isLive || false,
        status: t.status,
      }));
      dispatchDownload({ type: "progress", data: progress });
    }

    if (!result.tasks.some((task) => task.status === "downloading")) {
      stopPolling();
    }
  } catch {
    // Go Core may not be ready yet.
  } finally {
    pollingRequestInFlight = false;
    if (pollingEnabled) {
      scheduleProgressPoll(requestGeneration === pollingGeneration ? 1000 : 0);
    }
  }
}

function startProgressPolling() {
  pollingGeneration += 1;
  pollingEnabled = true;
  scheduleProgressPoll(1000);
}

function stopPolling() {
  pollingEnabled = false;
  pollingGeneration += 1;
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
  }
}

async function stopProgressPollingIfIdle() {
  if (!canConnectToGoEvents(useAppStore.getState().apiKey)) {
    stopPolling();
    return;
  }

  const requestGeneration = pollingGeneration;
  try {
    const result = await http.get<
      unknown,
      Pick<TaskListResponse, "tasks" | "total">
    >("/api/tasks", { timeout: 5000 });
    if (requestGeneration !== pollingGeneration) return;

    const hasActive = result.tasks.some((t) => t.status === "downloading");
    if (!hasActive) {
      stopPolling();
    }
  } catch {
    // ignore
  }
}
