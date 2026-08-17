import {
  DownloadProgress,
  DownloadStatus,
  type DownloadTask,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import {
  CircleArrowDown,
  CirclePause,
  CirclePlay,
  CircleX,
  Download,
  Pause,
  Pencil,
  SquareTerminal,
} from "lucide-react";
import { memo, type ReactNode, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { DownloadTag } from "@/components/download-tag";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  CONTINUE_DOWNLOAD,
  DOWNLOAD_NOW,
  PLAY_VIDEO,
  RESTART_DOWNLOAD,
  STOP_DOWNLOAD,
} from "@/const";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";
import { appStoreSelector, useAppStore } from "@/store/app";
import { cn, formatRelativeTime, fromatDateTime, isWeb, tdApp } from "@/utils";
import { TaskActionsMenu } from "./task-actions-menu";
import { TerminalDialog } from "./terminal-dialog";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";

interface Props {
  task: DownloadTaskDetails;
  onSelectChange: (id: number) => void;
  onSelect: (id: number) => void;
  selected: boolean;
  onStartDownload: (id: number) => void;
  onStopDownload: (taskId: number) => void;
  onContextMenu: (taskId: number) => void;
  onDelete: (taskId: number) => void;
  onRefresh: () => void;
  progress?: DownloadProgress;
  onShowEditForm?: (value: DownloadTask) => void;
  downloadStatus?: DownloadStatus;
}

export const DownloadTaskItem = memo(function DownloadTaskItem({
  task,
  onSelectChange,
  onSelect,
  selected,
  onStartDownload,
  onStopDownload,
  onContextMenu,
  onDelete,
  onRefresh,
  onShowEditForm,
}: Props) {
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { t, i18n } = useTranslation();
  const { shell } = usePlatform();
  const { envPath } = useEnvPath();

  // Handlers
  const handlePlay = useMemoizedFn(() => {
    tdApp.onEvent(PLAY_VIDEO);
    if (envPath?.playerUrl) {
      shell.open(`${envPath.playerUrl}?id=${task.id}`);
    }
  });

  const startWithEvent = useMemoizedFn((eventName: string) => {
    onStartDownload(task.id);
    tdApp.onEvent(eventName);
  });

  const handleStop = useMemoizedFn(() => {
    onStopDownload(task.id);
    tdApp.onEvent(STOP_DOWNLOAD);
  });

  // Action buttons by status (consolidated for clarity)
  const actionButtons = useMemo<ReactNode[]>(() => {
    const buttons: ReactNode[] = [];

    const terminalBtn = appStore.showTerminal ? (
      <TerminalDialog
        key="terminal"
        asChild
        trigger={
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("terminal")}
            aria-label={t("terminal")}
          >
            <SquareTerminal className="size-[19px]" />
          </Button>
        }
        title={task.name}
        id={task.id}
      />
    ) : null;

    const editBtn = (
      <Button
        key="edit"
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        title={t("edit")}
        aria-label={t("edit")}
        onClick={() => onShowEditForm?.(task)}
      >
        <Pencil className="size-[17px]" />
      </Button>
    );

    switch (task.status) {
      case DownloadStatus.Ready:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <Button
            key="download"
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("download")}
            aria-label={t("download")}
            onClick={() => startWithEvent(DOWNLOAD_NOW)}
          >
            <CircleArrowDown className="size-4" />
          </Button>,
        );
        break;
      case DownloadStatus.Downloading:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(
          <Button
            key="stop"
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("pause")}
            aria-label={t("pause")}
            onClick={handleStop}
          >
            <CirclePause className="size-4" />
          </Button>,
        );
        break;
      case DownloadStatus.Failed:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <Button
            key="redownload"
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("redownload")}
            aria-label={t("redownload")}
            onClick={() => startWithEvent(RESTART_DOWNLOAD)}
          >
            <CircleArrowDown className="size-4" />
          </Button>,
        );
        break;
      case DownloadStatus.Pending:
        buttons.push(<span key="pending">{t("pending")}</span>);
        break;
      case DownloadStatus.Stopped:
        if (terminalBtn) buttons.push(terminalBtn);
        buttons.push(editBtn);
        buttons.push(
          <Button
            key="restart"
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("continueDownload")}
            aria-label={t("continueDownload")}
            onClick={() => startWithEvent(CONTINUE_DOWNLOAD)}
          >
            <CircleArrowDown className="size-4" />
          </Button>,
        );
        break;
      default:
        // Success
        buttons.push(
          <Button
            key="play"
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:text-foreground"
            title={t("playVideo")}
            aria-label={t("playVideo")}
            disabled={!task.exists}
            onClick={handlePlay}
          >
            <CirclePlay className="size-4" />
          </Button>,
        );
        break;
    }

    return buttons;
  }, [
    appStore.showTerminal,
    handlePlay,
    handleStop,
    task,
    onShowEditForm,
    startWithEvent,
    t,
  ]);

  const renderTitle = useMemoizedFn((item: DownloadTaskWithFile): ReactNode => {
    return (
      <div
        className={cn("truncate text-sm text-foreground", {
          "text-brand": selected,
        })}
        title={item.name}
      >
        {item.folder ? `${item.folder}/` : item.folder}
        {item.name}
      </div>
    );
  });

  const tags = useMemo<ReactNode[]>(() => {
    const list: ReactNode[] = [];
    if (task.isLive)
      list.push(
        <DownloadTag key="live" text={t("liveResource")} variant="info" />,
      );

    switch (task.status) {
      case DownloadStatus.Downloading:
        list.push(
          <DownloadTag
            key="downloading"
            icon={<Download />}
            text={t("downloading")}
            variant="brand"
          />,
        );
        break;
      case DownloadStatus.Success:
        list.push(
          <DownloadTag
            key="success"
            text={t("downloadSuccess")}
            variant="success"
          />,
        );
        if (!task.exists) {
          list.push(
            <DownloadTag
              key="notExists"
              text={t("fileNotExist")}
              variant="muted"
            />,
          );
        }
        break;
      case DownloadStatus.Failed:
        list.push(
          <TerminalDialog
            key="failed"
            trigger={
              <DownloadTag
                icon={<CircleX />}
                text={t("downloadFailed")}
                variant="destructive"
                className="cursor-pointer"
              />
            }
            title={task.name}
            id={task.id}
          />,
        );
        break;
      case DownloadStatus.Stopped:
        list.push(
          <DownloadTag
            key="pause"
            icon={<Pause />}
            text={t("downloadPause")}
            variant="muted"
          />,
        );
        break;
    }
    return list;
  }, [task, t]);

  const renderDescription = useMemoizedFn(
    (item: DownloadTaskDetails): ReactNode => {
      if (item.percent && item.status === DownloadStatus.Downloading) {
        const val = Math.round(Number(item.percent));

        return (
          <div className="flex flex-row items-center gap-2 text-xs text-foreground-secondary">
            <Progress value={val} className="rounded-none" />
            <div className="min-w-5 shrink-0">{val}%</div>
            <div className="min-w-20 shrink-0">{item.speed}</div>
          </div>
        );
      }
      const exactCreatedTime = fromatDateTime(item.createdDate);
      const createdDate = item.createdDate ? new Date(item.createdDate) : null;
      const createdDateTime =
        createdDate && Number.isFinite(createdDate.getTime())
          ? createdDate.toISOString()
          : undefined;
      const relativeCreatedTime = formatRelativeTime(
        item.createdDate,
        i18n.resolvedLanguage ?? i18n.language,
      );
      const displayedCreatedTime = relativeCreatedTime || exactCreatedTime;

      return (
        <div className="relative flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <div className="min-w-0 shrink truncate" title={item.url}>
            {item.url}
          </div>
          {displayedCreatedTime ? (
            <>
              <span className="shrink-0 text-border-strong" aria-hidden="true">
                ·
              </span>
              <time
                className="shrink-0 whitespace-nowrap"
                dateTime={createdDateTime}
                title={`${t("createdAt")} ${exactCreatedTime}`}
              >
                {t("createdAt")} {displayedCreatedTime}
              </time>
            </>
          ) : null}
          {item.status === DownloadStatus.Failed ? (
            <>
              <span className="shrink-0 text-border-strong" aria-hidden="true">
                ·
              </span>
              <TerminalDialog
                asChild
                trigger={
                  <button
                    type="button"
                    className="shrink-0 cursor-pointer whitespace-nowrap text-destructive underline-offset-2 hover:underline"
                  >
                    {t("viewFailureReason")}
                  </button>
                }
                title={item.name}
                id={item.id}
              />
            </>
          ) : null}
        </div>
      );
    },
  );

  return (
    <div
      role="article"
      aria-label={task.name}
      className={cn(
        "relative flex flex-row gap-3 border-b px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-hover",
        {
          "bg-surface-selected hover:bg-surface-selected": selected,
          "opacity-70": task.status === DownloadStatus.Success && !task.exists,
        },
      )}
      onContextMenu={
        isWeb
          ? undefined
          : (event) => {
              event.preventDefault();
              void onContextMenu(task.id);
            }
      }
    >
      <Checkbox
        className="mt-2"
        checked={selected}
        onCheckedChange={() => onSelectChange(task.id)}
      />
      <div className={cn("flex flex-1 flex-col gap-1 overflow-hidden")}>
        <div className="relative flex flex-row items-center gap-2">
          {renderTitle(task)}
          <div className="flex shrink-0 grow flex-row gap-2">{tags}</div>
          <div
            className={cn(
              "flex flex-row items-center gap-1",
              isWeb && "hidden",
            )}
          >
            {actionButtons}
          </div>
          {isWeb ? (
            <TaskActionsMenu
              task={task}
              onSelect={() => onSelect(task.id)}
              onStart={() =>
                startWithEvent(
                  task.status === DownloadStatus.Failed
                    ? RESTART_DOWNLOAD
                    : task.status === DownloadStatus.Stopped
                      ? CONTINUE_DOWNLOAD
                      : DOWNLOAD_NOW,
                )
              }
              onStop={handleStop}
              onPlay={handlePlay}
              onEdit={() => onShowEditForm?.(task)}
              onRefresh={onRefresh}
              onDelete={() => onDelete(task.id)}
            />
          ) : null}
        </div>
        {renderDescription(task)}
      </div>
    </div>
  );
});
