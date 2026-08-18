import {
  DownloadStatus,
  type DownloadCreatedEvent,
  type DownloadEvent,
  type DownloadFailedEvent,
  type DownloadProgress,
  type DownloadStoppedEvent,
  type DownloadSuccessEvent,
  type DownloadTaskResponse,
} from "@mediago/shared-common";
import { useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useSWRConfig } from "swr";
import { onDownloadEvent } from "@/api/events";
import { useDownloadStore } from "@/store/download";
import { handleDownloadFailure } from "./download-failure-handler";

const DOWNLOAD_EVENT_SIDE_EFFECT_WARNING = "Download event side effect failed";

type DownloadEventCallback = (_event: null, data: DownloadEvent) => void;

export type DownloadEventSubscriber = (
  callback: DownloadEventCallback,
) => () => void;

export interface DownloadEventCollaborators {
  translate: (
    key: "dependencyMissing" | "unknownError",
    options?: { dependency: string },
  ) => string;
  notify: (message: string) => void;
  revalidateTasks: () => unknown;
  updateProgress: (progress: DownloadProgress[]) => unknown;
  protocolWarning: (message: string) => void;
}

const isSuccessEvent = (event: DownloadEvent): event is DownloadSuccessEvent =>
  event.type === "success";
const isFailedEvent = (event: DownloadEvent): event is DownloadFailedEvent =>
  event.type === "failed";
const isStoppedEvent = (event: DownloadEvent): event is DownloadStoppedEvent =>
  event.type === "stopped";
const isCreatedEvent = (event: DownloadEvent): event is DownloadCreatedEvent =>
  event.type === "created";
const isProgressEvent = (
  event: DownloadEvent,
): event is DownloadEvent<DownloadProgress[]> => event.type === "progress";

function runDownloadEventSideEffect(
  effect: () => unknown,
  protocolWarning: (message: string) => void,
) {
  try {
    Promise.resolve(effect()).catch(() => {
      protocolWarning(DOWNLOAD_EVENT_SIDE_EFFECT_WARNING);
    });
  } catch {
    protocolWarning(DOWNLOAD_EVENT_SIDE_EFFECT_WARNING);
  }
}

function handleDownloadEvent(
  event: DownloadEvent,
  collaborators: DownloadEventCollaborators,
) {
  if (isFailedEvent(event)) {
    handleDownloadFailure(event, {
      translate: collaborators.translate,
      notify: collaborators.notify,
      revalidate: collaborators.revalidateTasks,
      protocolWarning: collaborators.protocolWarning,
    });
    return;
  }

  if (isSuccessEvent(event) || isStoppedEvent(event) || isCreatedEvent(event)) {
    runDownloadEventSideEffect(
      collaborators.revalidateTasks,
      collaborators.protocolWarning,
    );
    return;
  }

  if (isProgressEvent(event)) {
    runDownloadEventSideEffect(
      () => collaborators.updateProgress(event.data),
      collaborators.protocolWarning,
    );
  }
}

export function registerDownloadEventSubscription(
  subscribe: DownloadEventSubscriber,
  collaborators: DownloadEventCollaborators,
): () => void {
  return subscribe((_event, data) => {
    handleDownloadEvent(data, collaborators);
  });
}

function isDownloadTasksCacheKey(key: unknown): boolean {
  return (
    typeof key === "object" &&
    key !== null &&
    "key" in key &&
    key.key === "api/tasks"
  );
}

function applyProgressToTaskCache(
  current: DownloadTaskResponse | undefined,
  progress: DownloadProgress[],
): DownloadTaskResponse | undefined {
  if (!current) return current;

  const progressIds = new Set(progress.map((item) => item.id));
  let changed = false;
  const list = current.list.map((item) => {
    if (
      !progressIds.has(item.id) ||
      item.status === DownloadStatus.Downloading
    ) {
      return item;
    }
    changed = true;
    return { ...item, status: DownloadStatus.Downloading };
  });

  return changed ? { ...current, list } : current;
}

function logDownloadEventWarning(message: string) {
  // The UI has no logger facade; warnings remain fixed and payload-free.
  // eslint-disable-next-line no-console
  console.warn(message);
}

export function useDownloadEvents() {
  const { t } = useTranslation();
  const { mutate } = useSWRConfig();
  const setEvents = useDownloadStore((state) => state.setEvents);
  const revalidateTasks = useCallback(
    () => mutate(isDownloadTasksCacheKey),
    [mutate],
  );
  const updateProgress = useCallback(
    (progress: DownloadProgress[]) => {
      setEvents(
        progress.map((item) => ({
          percent: item.percent,
          speed: item.speed,
          id: item.id,
        })),
      );
      return mutate<DownloadTaskResponse>(
        isDownloadTasksCacheKey,
        (current) => applyProgressToTaskCache(current, progress),
        { revalidate: false },
      );
    },
    [mutate, setEvents],
  );

  useEffect(
    () =>
      registerDownloadEventSubscription(onDownloadEvent, {
        translate: (key, options) => t(key, options),
        notify: toast.error,
        revalidateTasks,
        updateProgress,
        protocolWarning: logDownloadEventWarning,
      }),
    [revalidateTasks, t, updateProgress],
  );
}
