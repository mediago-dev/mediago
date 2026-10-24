import { DownloadFilter } from "@mediago/common";
import { useMemoizedFn } from "ahooks";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import {
  deleteDockerDownloadTask,
  startDockerDownload,
  stopDockerDownload,
} from "@/api/docker-download-task";
import {
  deleteDownloadTask,
  startDownload,
  stopDownload,
} from "@/api/download-task";
import emptyCompleted from "@/assets/images/empty-states/empty-completed.png";
import emptyDownloads from "@/assets/images/empty-states/empty-downloads.png";
import emptyError from "@/assets/images/empty-states/empty-error.png";
import { AppEmptyState } from "@/components/app-empty-state";
import Loading from "@/components/loading";
import { Button } from "@/components/ui/button";
import { EDIT_DOWNLOAD } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { taskRefKey, type DownloadTaskDetails } from "@/hooks/use-tasks";
import { useDownloadDialogStore } from "@/store/download-dialog";
import { cn, tdApp } from "@/utils";
import { DownloadTaskItem } from "./download-item";
import { ListHeader } from "./list-header";

interface Props {
  filter: DownloadFilter;
  data: DownloadTaskDetails[];
  isLoading: boolean;
  error?: unknown;
  mutate: () => Promise<unknown>;
}

export function DownloadTaskList({
  filter,
  data,
  isLoading,
  error,
  mutate,
}: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const { contextMenu } = usePlatform();
  const { t } = useTranslation();
  const openNew = useDownloadDialogStore((state) => state.openNew);
  const openEdit = useDownloadDialogStore((state) => state.openEdit);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    },
    [],
  );

  useEffect(() => {
    const selectableKeys = new Set(
      data.filter((task) => !task.remoteOffline).map(taskRefKey),
    );
    setSelected((current) => current.filter((key) => selectableKeys.has(key)));
  }, [data]);

  const handleItemSelectChange = useMemoizedFn((task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    const key = taskRefKey(task);
    setSelected((current) =>
      current.includes(key)
        ? current.filter((selectedId) => selectedId !== key)
        : [...current, key],
    );
  });

  const selectItem = useMemoizedFn((task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    const key = taskRefKey(task);
    setSelected((current) =>
      current.includes(key) ? current : [...current, key],
    );
  });

  const handleSelectAll = useMemoizedFn(() => {
    const selectable = data.filter((task) => !task.remoteOffline);
    setSelected((current) =>
      current.length > 0 ? [] : selectable.map(taskRefKey),
    );
  });

  const listChecked = useMemo(() => {
    const selectableCount = data.filter((task) => !task.remoteOffline).length;
    if (selected.length === 0) return false;
    return selected.length === selectableCount ? true : "indeterminate";
  }, [data, selected.length]);

  const onStartDownload = useMemoizedFn(async (task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    if (task.origin === "docker") await startDockerDownload(task.id);
    else await startDownload(task.id);
    toast.success(t("downloadStarted"));
    await mutate();
  });

  const onStopDownload = useMemoizedFn(async (task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    if (task.origin === "docker") await stopDockerDownload(task.id);
    else await stopDownload(task.id);
    if (refreshTimeoutRef.current) clearTimeout(refreshTimeoutRef.current);
    refreshTimeoutRef.current = setTimeout(() => {
      void mutate();
      refreshTimeoutRef.current = null;
    }, 500);
  });

  const onDelete = useMemoizedFn(async (task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    if (task.origin === "docker") await deleteDockerDownloadTask(task.id);
    else await deleteDownloadTask(task.id);
    const key = taskRefKey(task);
    setSelected((current) =>
      current.filter((selectedId) => selectedId !== key),
    );
    await mutate();
  });

  const handleContext = useMemoizedFn(async (task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    const action = await contextMenu.show([
      { key: "select", label: t("select") },
      { key: "download", label: t("download") },
      { key: "refresh", label: t("refresh") },
      { key: "separator", label: "", type: "separator" },
      { key: "delete", label: t("delete") },
    ]);
    if (action === "select") selectItem(task);
    else if (action === "download") await onStartDownload(task);
    else if (action === "refresh") await mutate();
    else if (action === "delete") await onDelete(task);
  });

  const selectedTasks = useMemo(
    () => data.filter((task) => selected.includes(taskRefKey(task))),
    [data, selected],
  );

  const onDeleteItems = useMemoizedFn(async () => {
    const results = await Promise.allSettled(
      selectedTasks.map((task) =>
        task.origin === "docker"
          ? deleteDockerDownloadTask(task.id)
          : deleteDownloadTask(task.id),
      ),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    const message = t("batchDeleteResult", {
      success: results.length - failed,
      failed,
    });
    if (failed === 0) toast.success(message);
    else if (failed === results.length) toast.error(message);
    else toast.warning(message);
    setSelected([]);
    await mutate();
  });

  const onDownloadItems = useMemoizedFn(async () => {
    const results = await Promise.allSettled(
      selectedTasks.map((task) =>
        task.origin === "docker"
          ? startDockerDownload(task.id)
          : startDownload(task.id),
      ),
    );
    const failed = results.filter(
      (result) => result.status === "rejected",
    ).length;
    if (failed === 0) {
      toast.success(t("downloadStarted"));
    } else {
      const message = t("batchDownloadResult", {
        success: results.length - failed,
        failed,
      });
      if (failed === results.length) toast.error(message);
      else toast.warning(message);
    }
    setSelected([]);
    await mutate();
  });

  const handleShowDownloadForm = useMemoizedFn((task: DownloadTaskDetails) => {
    if (task.remoteOffline) return;
    tdApp.onEvent(EDIT_DOWNLOAD);
    openEdit(task);
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <ListHeader
        selected={selected}
        checked={listChecked}
        onSelectAll={handleSelectAll}
        onDeleteItems={onDeleteItems}
        onDownloadItems={onDownloadItems}
        onCancelItems={() => setSelected([])}
        filter={filter}
      />
      <div className={cn("flex w-full flex-1 shrink-0 flex-col overflow-auto")}>
        {isLoading ? <Loading /> : null}
        {!isLoading && error && data.length === 0 ? (
          <AppEmptyState
            className="h-full"
            illustration={emptyError}
            title={t("loadFailed")}
            description={t("loadFailedDescription")}
            actions={
              <Button type="button" onClick={() => void mutate()}>
                {t("refresh")}
              </Button>
            }
          />
        ) : null}
        {!isLoading && !error && data.length === 0 ? (
          <AppEmptyState
            className="h-full"
            illustration={
              filter === DownloadFilter.list ? emptyDownloads : emptyCompleted
            }
            title={
              filter === DownloadFilter.list
                ? t("emptyDownloadsTitle")
                : t("emptyCompletedTitle")
            }
            description={
              filter === DownloadFilter.list
                ? t("emptyDownloadsDescription")
                : t("emptyCompletedDescription")
            }
            actions={
              filter === DownloadFilter.list ? (
                <Button type="button" onClick={() => openNew()}>
                  <Plus />
                  {t("newDownload")}
                </Button>
              ) : (
                <Button
                  nativeButton={false}
                  render={<Link to="/" />}
                  variant="outline"
                >
                  {t("downloadList")}
                </Button>
              )
            }
          />
        ) : null}
        {data.map((task) => (
          <DownloadTaskItem
            key={taskRefKey(task)}
            task={task}
            selected={selected.includes(taskRefKey(task))}
            onSelectChange={handleItemSelectChange}
            onSelect={selectItem}
            onStartDownload={onStartDownload}
            onStopDownload={onStopDownload}
            onContextMenu={handleContext}
            onDelete={onDelete}
            onRefresh={mutate}
            onShowEditForm={handleShowDownloadForm}
          />
        ))}
      </div>
    </div>
  );
}

export const DownloadList = DownloadTaskList;
