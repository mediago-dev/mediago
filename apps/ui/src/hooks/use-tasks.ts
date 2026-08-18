import { DownloadFilter, type DownloadTask } from "@mediago/shared-common";
import { useCallback, useMemo } from "react";
import useSWR from "swr";
import { useDownloadStore } from "@/store/download";
import { getDownloadTasks as fetchDownloadTasks } from "@/api/download-task";
import { useHomeStore } from "@/store/home";

/**
 * Extended Download Task with real-time details
 */
export interface DownloadTaskDetails extends DownloadTask {
  percent: string;
  speed: string;
  exists?: boolean;
  file?: string;
}

export function useTasks(filter: DownloadFilter = DownloadFilter.list) {
  const eventsMap = useDownloadStore((state) => state.eventsMap);
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
