import { DownloadStatus, type DownloadTaskWithFile } from "@mediago/common";
import {
  CirclePlay,
  Download,
  ListChecks,
  MoreHorizontal,
  Pause,
  Pencil,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Props {
  onDelete: () => void;
  onEdit: () => void;
  onPlay: () => void;
  onRefresh: () => void;
  onSelect: () => void;
  onStart: () => void;
  onStop: () => void;
  isStoppingRecording?: boolean;
  task: DownloadTaskWithFile;
  disabled?: boolean;
  disablePlay?: boolean;
}

export function TaskActionsMenu({
  onDelete,
  onEdit,
  onPlay,
  onRefresh,
  onSelect,
  onStart,
  onStop,
  isStoppingRecording = false,
  task,
  disabled = false,
  disablePlay = false,
}: Props) {
  const { t } = useTranslation();
  const canRestart =
    task.status === DownloadStatus.Ready ||
    task.status === DownloadStatus.Failed ||
    task.status === DownloadStatus.Stopped;
  const canEdit = canRestart;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
          />
        }
      >
        <MoreHorizontal />
        {t("actions")}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuItem onClick={onSelect}>
          <ListChecks />
          {t("select")}
        </DropdownMenuItem>
        {canRestart ? (
          <DropdownMenuItem onClick={onStart}>
            <Download />
            {task.status === DownloadStatus.Failed
              ? t("redownload")
              : task.status === DownloadStatus.Stopped
                ? task.isLive
                  ? t("recordAgain")
                  : t("continueDownload")
                : t("download")}
          </DropdownMenuItem>
        ) : null}
        {task.status === DownloadStatus.Downloading ? (
          <DropdownMenuItem
            disabled={task.isLive && isStoppingRecording}
            onClick={onStop}
          >
            {task.isLive ? <Square /> : <Pause />}
            {task.isLive
              ? isStoppingRecording
                ? t("endingRecording")
                : t("endRecording")
              : t("pause")}
          </DropdownMenuItem>
        ) : null}
        {task.status === DownloadStatus.Success ? (
          <DropdownMenuItem
            disabled={disablePlay || !task.exists}
            onClick={onPlay}
          >
            <CirclePlay />
            {t("playVideo")}
          </DropdownMenuItem>
        ) : null}
        {canEdit ? (
          <DropdownMenuItem onClick={onEdit}>
            <Pencil />
            {t("edit")}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onClick={onRefresh}>
          <RefreshCw />
          {t("refresh")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 />
          {t("delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
