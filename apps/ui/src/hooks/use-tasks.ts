import {
  DownloadFilter,
  DownloadStatus,
  type DownloadCreatedEvent,
  type DownloadEvent,
  type DownloadFailedEvent,
  type DownloadProgress,
  type DownloadStoppedEvent,
  type DownloadSuccessEvent,
  type DownloadTask,
} from "@mediago/shared-common";
import { useCallback, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import useSWR from "swr";
import { useShallow } from "zustand/react/shallow";
import { downloadStoreSelector, useDownloadStore } from "@/store/download";
import { getDownloadTasks as fetchDownloadTasks } from "@/api/download-task";
import { onDownloadEvent } from "@/api/events";
import { useHomeStore } from "@/store/home";
import { handleDownloadFailure } from "./download-failure-handler";

/**
 * Extended Download Task with real-time details
 */
export interface DownloadTaskDetails extends DownloadTask {
  percent: string;
  speed: string;
  exists?: boolean;
  file?: string;
}

const isSuccessEvent = (obj: DownloadEvent): obj is DownloadSuccessEvent =>
  obj.type === "success";
const isFailedEvent = (obj: DownloadEvent): obj is DownloadFailedEvent =>
  obj.type === "failed";
const isStoppedEvent = (obj: DownloadEvent): obj is DownloadStoppedEvent =>
  obj.type === "stopped";
const isCreatedEvent = (obj: DownloadEvent): obj is DownloadCreatedEvent =>
  obj.type === "created";
const isProgressEvent = (
  obj: DownloadEvent,
): obj is DownloadEvent<DownloadProgress[]> => obj.type === "progress";

export function useTasks(filter: DownloadFilter = DownloadFilter.list) {
  const { t } = useTranslation();
  const { setEvents, eventsMap } = useDownloadStore(
    useShallow(downloadStoreSelector),
  );
  const page = useHomeStore((state) => state.pages[filter]);
  const pageSize = useHomeStore((state) => state.pageSize);
  const setStorePage = useHomeStore((state) => state.setPage);
  const setPageSize = useHomeStore((state) => state.setPageSize);
  const setPage = useCallback(
    (nextPage: number) => setStorePage(filter, nextPage),
    [filter, setStorePage],
  );

  const { data, error, isLoading, mutate } = useSWR(
    {
      key: "api/tasks",
      args: {
        current: page,
        pageSize,
        filter,
      },
    },
    ({ args }) => {
      return fetchDownloadTasks(args);
    },
    { keepPreviousData: true },
  );

  const detail: DownloadTaskDetails[] = useMemo(() => {
    return (data?.list || []).map((item) => {
      const evnetItem = eventsMap.get(String(item.id));

      if (!evnetItem) {
        return {
          ...item,
          percent: "0",
          speed: "0 B/s",
        };
      }

      return {
        ...item,
        percent: evnetItem.percent || "0",
        speed: evnetItem.speed || "0 B/s",
      };
    });
  }, [data, eventsMap]);

  const handleDownloadEvent = useCallback(
    (_: unknown, eventData: DownloadEvent) => {
      if (isSuccessEvent(eventData)) {
        mutate();
        return;
      }

      if (isFailedEvent(eventData)) {
        void handleDownloadFailure(eventData, {
          translate: (key, options) => t(key, options),
          notify: toast.error,
          revalidate: mutate,
        });
        return;
      }

      if (isStoppedEvent(eventData)) {
        mutate();
        return;
      }

      // Tasks created externally (browser extension, Docker clients)
      // arrive here — refetch so the new rows show up immediately
      // without a manual refresh.
      if (isCreatedEvent(eventData)) {
        mutate();
        return;
      }

      if (isProgressEvent(eventData)) {
        const events = eventData.data.map((item) => ({
          percent: item.percent,
          speed: item.speed,
          id: item.id,
        }));
        setEvents(events);

        mutate(
          (current) => {
            if (!current) {
              return current;
            }

            const progressMap = new Map(
              eventData.data.map((item) => [item.id, item]),
            );
            let changed = false;
            const nextList = current.list.map((item) => {
              if (!progressMap.has(item.id)) {
                return item;
              }
              if (item.status === DownloadStatus.Downloading) {
                return item;
              }
              changed = true;
              return {
                ...item,
                status: DownloadStatus.Downloading,
              };
            });

            if (!changed) {
              return current;
            }

            return {
              ...current,
              list: nextList,
            };
          },
          { revalidate: false },
        );
      }
    },
    [mutate, setEvents, t],
  );

  // Subscribe to Go SSE download events
  useEffect(() => {
    return onDownloadEvent(handleDownloadEvent);
  }, [handleDownloadEvent]);

  return {
    data: detail,
    total: data?.total ?? 0,
    isLoading,
    error,
    mutate,
    pagination: {
      page,
      pageSize,
    },
    setPage,
    setPageSize,
  };
}
