import {
  DownloadProgress,
  DownloadStatus,
  type DownloadTaskWithFile,
} from "@mediago/common";
import { useMemoizedFn } from "ahooks";
import {
  CircleArrowDown,
  CirclePause,
  CirclePlay,
  CircleX,
  Container,
  Download,
  Pause,
  Pencil,
  Square,
  SquareTerminal,
} from "lucide-react";
import { memo, type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { DownloadTag } from "@/components/download-tag";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  formatDownloadSpeed,
  formatRecordingDuration,
  formatRecordingStartTime,
} from "@/store/download-progress";
import { cn, formatRelativeTime, fromatDateTime, isWeb, tdApp } from "@/utils";
import { TaskActionsMenu } from "./task-actions-menu";
import { TerminalDialog } from "./terminal-dialog";
import { usePlatform } from "@/hooks/use-platform";
import { useEnvPath } from "@/hooks/use-config";

interface Props {
  task: DownloadTaskDetails;
  onSelectChange: (task: DownloadTaskDetails) => void;
  onSelect: (task: DownloadTaskDetails) => void;
  selected: boolean;
  onStartDownload: (task: DownloadTaskDetails) => void;
  onStopDownload: (task: DownloadTaskDetails) => Promise<void> | void;
  onContextMenu: (task: DownloadTaskDetails) => void;
  onDelete: (task: DownloadTaskDetails) => void;
  onRefresh: () => void;
  progress?: DownloadProgress;
  onShowEditForm?: (value: DownloadTaskDetails) => void;
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
  const [stopRecordingOpen, setStopRecordingOpen] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);

  useEffect(() => {
    if (task.status !== DownloadStatus.Downloading) {
      setIsStoppingRecording(false);
    }
  }, [task.status]);

  // Handlers
  const handlePlay = useMemoizedFn(() => {
    tdApp.onEvent(PLAY_VIDEO);
    if (envPath?.playerUrl) {
      shell.open(`${envPath.playerUrl}?id=${task.id}`);
    }
  });

  const startWithEvent = useMemoizedFn((eventName: string) => {
    if (task.remoteOffline) return;
    onStartDownload(task);
    tdApp.onEvent(eventName);
  });

  const stopTask = useMemoizedFn(async () => {
    try {
      if (task.remoteOffline) return;
      await onStopDownload(task);
      tdApp.onEvent(STOP_DOWNLOAD);
    } catch {
      setIsStoppingRecording(false);
      toast.error(
        task.isLive ? t("endRecordingFailed") : t("stopDownloadFailed"),
      );
    }
  });

  const requestStop = useMemoizedFn(() => {
    if (task.isLive) {
      setStopRecordingOpen(true);
      return;
    }
    void stopTask();
  });

  const confirmStopRecording = useMemoizedFn(() => {
    setStopRecordingOpen(false);
    setIsStoppingRecording(true);
    void stopTask();
  });

  // Action buttons by status (consolidated for clarity)
  const actionButtons = useMemo<ReactNode[]>(() => {
    const buttons: ReactNode[] = [];

    const terminalBtn =
      appStore.showTerminal && !task.remoteOffline ? (
        <TerminalDialog
          key="terminal"
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
          origin={task.origin}
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
        disabled={task.remoteOffline}
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
            disabled={task.remoteOffline}
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
            title={
              task.isLive
                ? isStoppingRecording
                  ? t("endingRecording")
                  : t("endRecording")
                : t("pause")
            }
            aria-label={
              task.isLive
                ? isStoppingRecording
                  ? t("endingRecording")
                  : t("endRecording")
                : t("pause")
            }
            disabled={
              task.remoteOffline || (task.isLive && isStoppingRecording)
            }
            onClick={requestStop}
          >
            {task.isLive ? (
              <Square className="size-4" />
            ) : (
              <CirclePause className="size-4" />
            )}
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
            disabled={task.remoteOffline}
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
            title={task.isLive ? t("recordAgain") : t("continueDownload")}
            aria-label={task.isLive ? t("recordAgain") : t("continueDownload")}
            onClick={() =>
              startWithEvent(task.isLive ? RESTART_DOWNLOAD : CONTINUE_DOWNLOAD)
            }
            disabled={task.remoteOffline}
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
            disabled={task.origin === "docker" || !task.exists}
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
    isStoppingRecording,
    requestStop,
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
    if (task.origin === "docker")
      list.push(
        <DownloadTag
          key="docker"
          icon={<Container />}
          text={task.remoteOffline ? t("dockerOffline") : t("dockerSource")}
          variant={task.remoteOffline ? "muted" : "info"}
        />,
      );

    switch (task.status) {
      case DownloadStatus.Downloading:
        list.push(
          <DownloadTag
            key="downloading"
            icon={<Download />}
            text={
              task.isLive && isStoppingRecording
                ? t("endingRecording")
                : task.isLive
                  ? t("recording")
                  : t("downloading")
            }
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
        if ((task.files?.length ?? 0) > 1) {
          list.push(
            <DownloadTag
              key="artifacts"
              text={t("outputFiles", { count: task.files?.length })}
              variant="info"
            />,
          );
        }
        break;
      case DownloadStatus.Failed:
        list.push(
          task.remoteOffline ? (
            <DownloadTag
              key="failed"
              icon={<CircleX />}
              text={t("downloadFailed")}
              variant="destructive"
            />
          ) : (
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
              origin={task.origin}
            />
          ),
        );
        break;
      case DownloadStatus.Stopped:
        list.push(
          <DownloadTag
            key="pause"
            icon={task.isLive ? <Square /> : <Pause />}
            text={task.isLive ? t("recordingStopped") : t("downloadPause")}
            variant="muted"
          />,
        );
        break;
    }
    return list;
  }, [isStoppingRecording, task, t]);

  const renderDescription = useMemoizedFn(
    (item: DownloadTaskDetails): ReactNode => {
      if (item.isLive && item.status === DownloadStatus.Downloading) {
        const recordingDuration = formatRecordingDuration(
          item.recordingStartedAt,
        );
        const recordingStartTime = formatRecordingStartTime(
          item.recordingStartedAt,
          i18n.resolvedLanguage ?? i18n.language,
        );
        return (
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground-secondary">
            {recordingDuration && recordingStartTime ? (
              <>
                <span className="shrink-0 tabular-nums">
                  {t("recordedDuration")} {recordingDuration}
                </span>
                <span className="text-border-strong" aria-hidden="true">
                  ·
                </span>
                <span className="shrink-0 tabular-nums">
                  {t("recordingStartedAt")} {recordingStartTime}
                </span>
                <span className="text-border-strong" aria-hidden="true">
                  ·
                </span>
              </>
            ) : null}
            <span className="shrink-0 tabular-nums">
              {formatDownloadSpeed(item.speed)}
            </span>
          </div>
        );
      }

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
          {item.remoteOffline && item.remoteLastSyncedAt ? (
            <>
              <span className="shrink-0 text-border-strong" aria-hidden="true">
                ·
              </span>
              <span className="shrink-0 whitespace-nowrap">
                {t("dockerLastSynced", {
                  time: fromatDateTime(item.remoteLastSyncedAt),
                })}
              </span>
            </>
          ) : null}
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
          {item.status === DownloadStatus.Failed && !item.remoteOffline ? (
            <>
              <span className="shrink-0 text-border-strong" aria-hidden="true">
                ·
              </span>
              <TerminalDialog
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
                origin={item.origin}
              />
            </>
          ) : null}
        </div>
      );
    },
  );

  return (
    <>
      <div
        role="article"
        aria-label={task.name}
        className={cn(
          "relative flex flex-row gap-3 border-b px-3 py-3 transition-colors last:border-b-0 hover:bg-surface-hover",
          {
            "bg-surface-selected hover:bg-surface-selected": selected,
            "opacity-70":
              task.status === DownloadStatus.Success && !task.exists,
            "border-l-2 border-l-sky-500/50 bg-sky-500/[0.03]":
              task.origin === "docker" && !task.remoteOffline,
            "cursor-not-allowed border-l-2 border-l-muted-foreground/30 bg-muted/30 opacity-60 hover:bg-muted/30":
              task.origin === "docker" && task.remoteOffline,
          },
        )}
        onContextMenu={
          isWeb || task.remoteOffline
            ? undefined
            : (event) => {
                event.preventDefault();
                void onContextMenu(task);
              }
        }
      >
        <Checkbox
          className="mt-2"
          checked={selected}
          disabled={task.remoteOffline}
          onCheckedChange={() => onSelectChange(task)}
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
                disabled={task.remoteOffline}
                disablePlay={task.origin === "docker"}
                onSelect={() => onSelect(task)}
                onStart={() =>
                  startWithEvent(
                    task.status === DownloadStatus.Failed
                      ? RESTART_DOWNLOAD
                      : task.status === DownloadStatus.Stopped
                        ? task.isLive
                          ? RESTART_DOWNLOAD
                          : CONTINUE_DOWNLOAD
                        : DOWNLOAD_NOW,
                  )
                }
                isStoppingRecording={isStoppingRecording}
                onStop={requestStop}
                onPlay={handlePlay}
                onEdit={() => onShowEditForm?.(task)}
                onRefresh={onRefresh}
                onDelete={() => onDelete(task)}
              />
            ) : null}
          </div>
          {renderDescription(task)}
        </div>
      </div>
      <Dialog open={stopRecordingOpen} onOpenChange={setStopRecordingOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("endLiveRecordingTitle")}</DialogTitle>
            <DialogDescription>
              {t("endLiveRecordingDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setStopRecordingOpen(false)}
            >
              {t("continueRecording")}
            </Button>
            <Button type="button" onClick={confirmStopRecording}>
              {t("endAndSaveRecording")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
