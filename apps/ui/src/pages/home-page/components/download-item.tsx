import {
  DownloadStatus,
  type DownloadTaskWithFile,
} from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import {
  ArrowDownToLine,
  Check,
  CircleAlert,
  Clock,
  Folder,
  Loader2,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  RotateCw,
} from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { MgIconButton, MgPill } from "@/components/mg";
import { useEnvPath } from "@/hooks/use-config";
import { usePlatform } from "@/hooks/use-platform";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";
import { useUiStore } from "@/store/ui";
import { statusMeta, typeMeta } from "@/theme/mg";
import { mapStatus, mapType, statusLabelKey } from "@/theme/mg-map";
import { cn, fromatDateTime, tdApp } from "@/utils";
import { PLAY_VIDEO } from "@/const";
import { TerminalDialog } from "./terminal-dialog";

interface Props {
  task: DownloadTaskDetails;
  selected: boolean;
  onSelectChange: (id: number) => void;
  onStart: (id: number) => void;
  onStop: (id: number) => void;
  onEdit: (task: DownloadTaskWithFile) => void;
}

function StatusGlyph({ status, color }: { status: string; color: string }) {
  const common = { size: 24, color, strokeWidth: 2.4 } as const;
  switch (status) {
    case "downloading":
    case "preparing":
      return <Loader2 {...common} className="animate-spin" />;
    case "paused":
      return <Pause size={22} color={color} fill={color} strokeWidth={0} />;
    case "success":
      return <Check {...common} />;
    case "failed":
      return <CircleAlert size={22} color={color} strokeWidth={2.4} />;
    default:
      return <Clock size={22} color={color} strokeWidth={2.2} />;
  }
}

export const DownloadTaskItem = memo(function DownloadTaskItem({
  task,
  selected,
  onSelectChange,
  onStart,
  onStop,
  onEdit,
}: Props) {
  const { t } = useTranslation();
  const { shell } = usePlatform();
  const { envPath } = useEnvPath();
  const openContextMenu = useUiStore((s) => s.openContextMenu);

  const mg = mapStatus(task.status);
  const sm = statusMeta(mg);
  const tm = typeMeta(mapType(task.type));

  const status = task.status;
  const isDownloading = status === DownloadStatus.Downloading;
  const isSuccess = status === DownloadStatus.Success;
  const isFailed = status === DownloadStatus.Failed;
  const exists = task.exists !== false;

  const percent = Math.min(
    100,
    Math.max(0, Math.round(Number(task.percent) || 0)),
  );
  const showProgress = !isSuccess && !isFailed;
  const statusLabel = t(statusLabelKey[mg]);

  const handlePlay = useMemoizedFn(() => {
    tdApp.onEvent(PLAY_VIDEO);
    if (envPath?.playerUrl) shell.open(`${envPath.playerUrl}?id=${task.id}`);
  });

  const handleRowCtx = useMemoizedFn((e: React.MouseEvent) => {
    e.preventDefault();
    openContextMenu(
      task.id,
      Math.min(e.clientX, window.innerWidth - 195),
      Math.min(e.clientY, window.innerHeight - 185),
    );
  });

  const handleMore = useMemoizedFn((e: React.MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    openContextMenu(
      task.id,
      Math.min(r.left - 150, window.innerWidth - 195),
      r.bottom + 6,
    );
  });

  return (
    <div
      onContextMenu={handleRowCtx}
      className={cn(
        "flex items-start gap-[15px] rounded-[16px] border bg-mg-surface p-[16px_18px] transition-[border-color,box-shadow] hover:shadow-[0_8px_24px_-14px_rgba(20,20,40,.3)]",
        selected ? "border-mg-primary" : "border-mg-line",
        isSuccess && !exists && "opacity-70",
      )}
    >
      {/* checkbox */}
      <button
        type="button"
        aria-label="select"
        onClick={() => onSelectChange(task.id)}
        className={cn(
          "mt-0.5 flex size-[21px] shrink-0 items-center justify-center rounded-[6px] border-2 transition-colors",
          selected
            ? "border-mg-primary bg-mg-primary"
            : "border-mg-line2 bg-transparent",
        )}
      >
        {selected && <Check size={12} color="#fff" strokeWidth={3.5} />}
      </button>

      {/* status chip */}
      <div
        style={{ background: sm.bg }}
        className="flex size-[52px] shrink-0 items-center justify-center rounded-[13px]"
      >
        <StatusGlyph status={mg} color={sm.color} />
      </div>

      {/* body */}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span
            className="max-w-full truncate text-[15px] font-bold tracking-[-0.01em] text-mg-fg"
            title={task.name}
          >
            {task.name}
          </span>
          <MgPill
            color={tm.color}
            bg={tm.bg}
            className="uppercase tracking-[.03em]"
          >
            {tm.label}
          </MgPill>
          {task.isLive && (
            <MgPill color="#f43f5e" bg="rgba(244,63,94,.13)">
              <span className="size-1.5 animate-[mgpulse_1.2s_infinite] rounded-full bg-[#f43f5e]" />
              {t("live")}
            </MgPill>
          )}
          {isSuccess && !exists && (
            <MgPill color="var(--mg-fg3)" bg="rgba(148,163,184,.16)">
              {t("fileNotExist")}
            </MgPill>
          )}
        </div>

        <div className="mb-2.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12px] text-mg-fg3">
          {task.folder && (
            <span className="inline-flex max-w-[240px] items-center gap-1.5 truncate">
              <Folder size={13} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{task.folder}</span>
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} strokeWidth={2} className="shrink-0" />
            {fromatDateTime(task.createdDate)}
          </span>
        </div>

        {showProgress && (
          <div className="flex items-center gap-3">
            <div className="relative h-2 flex-1 overflow-hidden rounded-md bg-mg-surface2">
              <div
                className="h-full rounded-md"
                style={{
                  width: `${percent}%`,
                  background: sm.bar,
                  ...(isDownloading
                    ? {
                        backgroundSize: "28px 100%",
                        animation: "mgbar .8s linear infinite",
                      }
                    : {}),
                }}
              />
            </div>
            <span
              style={{ color: sm.color }}
              className="min-w-[42px] text-right text-[12.5px] font-bold tabular-nums"
            >
              {percent}%
            </span>
            {isDownloading && (
              <span className="min-w-16 text-right text-[11.5px] font-semibold text-mg-fg2 tabular-nums">
                {task.speed}
              </span>
            )}
          </div>
        )}

        {isFailed && (
          <TerminalDialog
            asChild
            trigger={
              <button
                type="button"
                className="inline-flex max-w-full items-center gap-1.5 rounded-[10px] bg-[rgba(244,63,94,.1)] px-[11px] py-2 text-left text-[12px] font-semibold text-[#f43f5e]"
              >
                <CircleAlert size={14} strokeWidth={2.2} className="shrink-0" />
                <span className="truncate">{t("failReason")}</span>
              </button>
            }
            title={task.name}
            id={task.id}
          />
        )}
      </div>

      {/* right: status pill + actions */}
      <div className="flex shrink-0 flex-col items-end gap-2.5">
        <MgPill
          color={sm.color}
          bg={sm.bg}
          className="px-2.5 py-1 text-[11.5px]"
        >
          {statusLabel}
        </MgPill>
        <div className="flex gap-1.5">
          {isSuccess && (
            <MgIconButton
              variant={exists ? "primary" : "soft"}
              disabled={!exists}
              title={t("playVideo")}
              onClick={handlePlay}
            >
              <Play size={15} fill="currentColor" strokeWidth={0} />
            </MgIconButton>
          )}
          {status === DownloadStatus.Stopped && (
            <MgIconButton
              variant="primary"
              title={t("continueDownload")}
              onClick={() => onStart(task.id)}
            >
              <Play size={15} fill="currentColor" strokeWidth={0} />
            </MgIconButton>
          )}
          {status === DownloadStatus.Ready && (
            <MgIconButton
              variant="primary"
              title={t("download")}
              onClick={() => onStart(task.id)}
            >
              <ArrowDownToLine size={15} strokeWidth={2.4} />
            </MgIconButton>
          )}
          {isDownloading && (
            <MgIconButton
              variant="surface"
              title={t("pause")}
              onClick={() => onStop(task.id)}
            >
              <Pause size={14} fill="currentColor" strokeWidth={0} />
            </MgIconButton>
          )}
          {isFailed && (
            <MgIconButton
              variant="danger"
              title={t("redownload")}
              onClick={() => onStart(task.id)}
            >
              <RotateCw size={15} strokeWidth={2.2} />
            </MgIconButton>
          )}
          {(status === DownloadStatus.Ready ||
            status === DownloadStatus.Pending ||
            status === DownloadStatus.Stopped ||
            isFailed) && (
            <MgIconButton
              variant="surface"
              title={t("edit")}
              onClick={() => onEdit(task)}
            >
              <Pencil size={14} strokeWidth={2} />
            </MgIconButton>
          )}
          <MgIconButton
            variant="surface"
            title={t("more")}
            onClick={handleMore}
          >
            <MoreHorizontal size={16} strokeWidth={2} />
          </MgIconButton>
        </div>
      </div>
    </div>
  );
});
