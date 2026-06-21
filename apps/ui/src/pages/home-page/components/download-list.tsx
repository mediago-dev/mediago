import {
  DownloadFilter,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { App } from "antd";
import { Download } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteDownloadTask,
  startDownload,
  stopDownload,
} from "@/api/download-task";
import { MgButton } from "@/components/mg";
import { TaskContextMenu } from "@/components/task-context-menu";
import { useTasks } from "@/hooks/use-tasks";
import { useUiStore } from "@/store/ui";
import { DownloadTaskItem } from "./download-item";
import { DownloadLogPanel } from "./download-log-panel";
import { ListHeader } from "./list-header";

interface Props {
  filter: DownloadFilter;
}

function Skeletons() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex h-24 items-center gap-4 rounded-[16px] border border-mg-line bg-mg-surface p-[18px] [animation:mgpulse_1.4s_ease-in-out_infinite]"
        >
          <div className="size-[54px] shrink-0 rounded-[13px] bg-mg-surface2" />
          <div className="flex flex-1 flex-col gap-2.5">
            <div className="h-[13px] w-2/5 rounded-md bg-mg-surface2" />
            <div className="h-2.5 w-3/5 rounded-md bg-mg-surface2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DownloadTaskList({ filter }: Props) {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { data, isLoading, mutate } = useTasks(filter);
  const openEditDownload = useUiStore((s) => s.openEditDownload);
  const openNewDownload = useUiStore((s) => s.openNewDownload);
  const [selected, setSelected] = useState<number[]>([]);
  const [logOpen, setLogOpen] = useState(false);

  const isList = filter === DownloadFilter.list;
  const anySelected = selected.length > 0;

  const toggleSelect = useMemoizedFn((id: number) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    ),
  );
  const addSelect = useMemoizedFn((id: number) =>
    setSelected((prev) => (prev.includes(id) ? prev : [...prev, id])),
  );
  const selectAll = useMemoizedFn(() =>
    setSelected((prev) => (prev.length ? [] : data.map((x) => x.id))),
  );

  const onStart = useMemoizedFn(async (id: number) => {
    await startDownload(id);
    message.success(t("downloadStarted"));
    mutate();
  });
  const onStop = useMemoizedFn(async (id: number) => {
    await stopDownload(id);
    setTimeout(() => mutate(), 500);
  });
  const onEdit = useMemoizedFn((task: DownloadTaskWithFile) =>
    openEditDownload(task),
  );
  const onDelete = useMemoizedFn(async (id: number) => {
    await deleteDownloadTask(id);
    mutate();
  });

  const onBatchStart = useMemoizedFn(async () => {
    await Promise.allSettled(selected.map((id) => startDownload(id)));
    message.success(t("downloadStarted"));
    setSelected([]);
    mutate();
  });
  const onBatchDelete = useMemoizedFn(async () => {
    await Promise.allSettled(selected.map((id) => deleteDownloadTask(id)));
    setSelected([]);
    mutate();
  });

  return (
    <div className="flex flex-1 flex-col">
      <ListHeader
        anySelected={anySelected}
        selectedCount={selected.length}
        totalCount={data.length}
        onSelectAll={selectAll}
        onBatchStart={onBatchStart}
        onBatchDelete={onBatchDelete}
        onToggleLog={() => setLogOpen((v) => !v)}
        logOpen={logOpen}
        filter={filter}
      />

      {logOpen && <DownloadLogPanel tasks={data} />}

      {isLoading ? (
        <Skeletons />
      ) : data.length === 0 ? (
        <div className="py-[70px] text-center">
          <div className="mx-auto mb-[22px] flex size-[90px] items-center justify-center rounded-[26px] bg-mg-primary-weak">
            <Download size={42} className="text-mg-primary" strokeWidth={1.7} />
          </div>
          <h3 className="mb-2 text-[18px] font-bold text-mg-fg">
            {isList ? t("emptyDownloadsTitle") : t("emptyCompletedTitle")}
          </h3>
          <p className="mb-[22px] text-[13.5px] text-mg-fg2">
            {isList ? t("emptyDownloadsSub") : t("emptyCompletedSub")}
          </p>
          {isList && (
            <MgButton
              variant="primary"
              size="lg"
              onClick={() => openNewDownload()}
            >
              {t("newDownload")}
            </MgButton>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {data.map((task) => (
            <DownloadTaskItem
              key={task.id}
              task={task}
              selected={selected.includes(task.id)}
              onSelectChange={toggleSelect}
              onStart={onStart}
              onStop={onStop}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}

      <TaskContextMenu
        onSelect={addSelect}
        onDownload={onStart}
        onRefresh={() => mutate()}
        onDelete={onDelete}
      />
    </div>
  );
}

export const DownloadList = DownloadTaskList;
