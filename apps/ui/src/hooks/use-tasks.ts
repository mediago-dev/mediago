import {
  DownloadFilter,
  DownloadStatus,
  type DownloadTaskResponse,
  type UnifiedDownloadTask,
} from "@mediago/common";
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { getDockerTasks } from "@/api/docker-download-task";
import { getDownloadTasks as fetchDownloadTasks } from "@/api/download-task";
import { useAppStore } from "@/store/app";
import { useDockerDownloadStore } from "@/store/docker-downloads";
import { useDownloadStore } from "@/store/download";
import { useHomeStore } from "@/store/home";

/** Extended unified task with real-time details. */
export interface DownloadTaskDetails extends UnifiedDownloadTask {
  percent: string;
  speed: string;
  recordingStartedAt?: string;
}

function createdTimestamp(task: UnifiedDownloadTask): number {
  if (!task.createdDate) return 0;
  const value = new Date(task.createdDate).getTime();
  return Number.isFinite(value) ? value : 0;
}

export function taskRefKey(task: Pick<UnifiedDownloadTask, "id" | "origin">) {
  return `${task.origin}:${task.id}`;
}

export function mergeUnifiedTaskPage(
  local: DownloadTaskResponse | undefined,
  remote: DownloadTaskResponse | undefined,
  page: number,
  pageSize: number,
  remoteOffline: boolean,
  remoteLastSyncedAt?: string,
): { list: UnifiedDownloadTask[]; total: number } {
  const localTasks: UnifiedDownloadTask[] = (local?.list ?? []).map((task) =>
    Object.assign({}, task, { origin: "local" as const }),
  );
  const remoteTasks: UnifiedDownloadTask[] = (remote?.list ?? []).map((task) =>
    Object.assign({}, task, {
      origin: "docker" as const,
      remoteOffline,
      remoteLastSyncedAt,
    }),
  );
  const offset = Math.max(0, page - 1) * pageSize;
  const combined = [...localTasks, ...remoteTasks];
  /* oxlint-disable unicorn/no-array-sort -- This is a fresh merged array; ES2023 toSorted is outside the UI target. */
  const list = combined
    .sort(
      (a, b) =>
        createdTimestamp(b) - createdTimestamp(a) ||
        taskRefKey(b).localeCompare(taskRefKey(a)),
    )
    .slice(offset, offset + pageSize);
  /* oxlint-enable unicorn/no-array-sort */

  return {
    list,
    total: (local?.total ?? 0) + (remote?.total ?? 0),
  };
}

export function useTasks(filter: DownloadFilter = DownloadFilter.list) {
  const eventsMap = useDownloadStore((state) => state.eventsMap);
  const enableDocker = useAppStore((state) => state.enableDocker);
  const page = useHomeStore((state) => state.pages[filter]);
  const pageSize = useHomeStore((state) => state.pageSize);
  const setStorePage = useHomeStore((state) => state.setPage);
  const setPageSize = useHomeStore((state) => state.setPageSize);
  const snapshot = useDockerDownloadStore((state) => state.snapshots[filter]);
  const replaceSnapshot = useDockerDownloadStore(
    (state) => state.replaceSnapshot,
  );
  const setPage = useCallback(
    (nextPage: number) => setStorePage(filter, nextPage),
    [filter, setStorePage],
  );
  const fetchSize = Math.max(1, page) * pageSize;

  const {
    data: localData,
    error: localError,
    isLoading: localLoading,
    mutate: mutateLocal,
  } = useSWR(
    {
      key: "api/tasks/local",
      args: { current: 1, pageSize: fetchSize, filter },
    },
    ({ args }) => fetchDownloadTasks(args),
    { keepPreviousData: true },
  );

  const {
    data: dockerData,
    error: dockerError,
    isLoading: dockerLoading,
    mutate: mutateDocker,
  } = useSWR(
    enableDocker
      ? {
          key: "api/tasks/docker",
          args: { current: 1, pageSize: fetchSize, filter },
        }
      : null,
    ({ args }) => getDockerTasks(args),
    {
      keepPreviousData: true,
      refreshWhenHidden: false,
      refreshInterval: enableDocker
        ? (latest) =>
            Array.isArray(latest?.list) &&
            latest.list.some(
              (task) => task.status === DownloadStatus.Downloading,
            )
              ? 1_000
              : 12_000
        : 0,
      onSuccess: (response) =>
        replaceSnapshot(filter, response.list, response.total),
    },
  );

  const dockerOffline = enableDocker && Boolean(dockerError);
  const remoteData: DownloadTaskResponse | undefined = dockerOffline
    ? {
        list: snapshot.list.map((task) => ({
          ...task,
          createdDate: task.createdDate
            ? new Date(task.createdDate)
            : undefined,
        })),
        total: snapshot.total,
      }
    : dockerData;

  const merged = useMemo(
    () =>
      mergeUnifiedTaskPage(
        localData,
        enableDocker ? remoteData : undefined,
        page,
        pageSize,
        dockerOffline,
        dockerOffline ? snapshot.syncedAt : undefined,
      ),
    [
      dockerOffline,
      enableDocker,
      localData,
      page,
      pageSize,
      remoteData,
      snapshot.syncedAt,
    ],
  );

  const detail: DownloadTaskDetails[] = useMemo(
    () =>
      merged.list.map((item) => {
        const eventItem =
          item.origin === "local" ? eventsMap.get(String(item.id)) : undefined;

        return {
          ...item,
          percent: eventItem?.percent || "0",
          speed: eventItem?.speed || "0 B/s",
          isLive: item.isLive === true || eventItem?.isLive,
          recordingStartedAt: eventItem?.startedAt,
        };
      }),
    [eventsMap, merged.list],
  );

  const mutate = useCallback(async () => {
    const requests: Promise<unknown>[] = [mutateLocal()];
    if (enableDocker) requests.push(mutateDocker());
    await Promise.allSettled(requests);
  }, [enableDocker, mutateDocker, mutateLocal]);

  return {
    data: detail,
    total: merged.total,
    isLoading:
      localLoading ||
      (enableDocker &&
        dockerLoading &&
        !dockerData &&
        snapshot.list.length === 0),
    error: localError,
    dockerError,
    dockerOffline,
    dockerLastSyncedAt: dockerOffline ? snapshot.syncedAt : undefined,
    mutate,
    pagination: { page, pageSize },
    setPage,
    setPageSize,
  };
}
