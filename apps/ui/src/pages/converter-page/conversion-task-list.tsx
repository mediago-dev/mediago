import type { Conversion, ConversionResponse } from "@mediago/common";
import {
  CircleAlert,
  FolderOpen,
  Play,
  RefreshCw,
  Square,
  Trash2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import emptyConversions from "@/assets/images/empty-states/empty-conversions.png";
import { AppEmptyState } from "@/components/app-empty-state";
import { DownloadTag } from "@/components/download-tag";
import Loading from "@/components/loading";
import { Button } from "@/components/ui/button";
import { PaginationControl } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getConversionErrorKey,
  getConversionStatusKey,
  getPathExtension,
  getPathFileName,
  isConversionCancelled,
} from "./converter-page-logic";

interface ConversionTaskListProps {
  data?: ConversionResponse;
  error?: unknown;
  isLoading: boolean;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  onRefresh: () => void;
  onStart: (id: number) => void;
  onStop: (id: number) => void;
  onDelete: (id: number) => void;
  onOpenFolder: (path: string) => void;
  onConvertAll: () => void;
  onStopAll: () => void;
  onClearCompleted: () => void;
}

type StatusTagVariant = "brand" | "success" | "destructive" | "muted";

function getStatusTagVariant(
  status: string,
  isCancelled: boolean,
): StatusTagVariant {
  switch (status) {
    case "converting":
      return "brand";
    case "done":
      return "success";
    case "failed":
      return isCancelled ? "muted" : "destructive";
    default:
      return "muted";
  }
}

export function ConversionTaskList({
  data,
  error,
  isLoading,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onRefresh,
  onStart,
  onStop,
  onDelete,
  onOpenFolder,
  onConvertAll,
  onStopAll,
  onClearCompleted,
}: ConversionTaskListProps) {
  const { t } = useTranslation();
  const tasks = data?.list ?? [];
  const convertingCount = tasks.filter(
    (task) => task.status === "converting",
  ).length;
  const retryableCount = tasks.filter(
    (task) => task.status === "pending" || task.status === "failed",
  ).length;
  const completedCount = tasks.filter((task) => task.status === "done").length;

  const renderStatusTag = (item: Conversion) => {
    const cancelled = isConversionCancelled(item.error);
    const hasFailureReason = item.status === "failed" && Boolean(item.error);
    const statusTag = (
      <DownloadTag
        text={t(getConversionStatusKey(item.status, item.error))}
        variant={getStatusTagVariant(item.status, cancelled)}
        className={hasFailureReason ? "cursor-help" : undefined}
      />
    );

    if (!hasFailureReason) return statusTag;

    const errorMessage = t(getConversionErrorKey(item.error));
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className="inline-flex cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
              tabIndex={0}
              aria-label={errorMessage}
            />
          }
        >
          {statusTag}
        </TooltipTrigger>
        <TooltipContent className="max-w-72" side="top" sideOffset={6}>
          {t("failReason")}: {errorMessage}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderActions = (item: Conversion) => {
    if (item.status === "converting") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onStop(item.id)}
          aria-label={t("stop")}
          title={t("stop")}
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      );
    }

    if (item.status === "done") {
      return (
        <>
          {item.outputPath ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onOpenFolder(item.outputPath)}
              aria-label={t("openFolder")}
              title={t("openFolder")}
            >
              <FolderOpen className="size-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onDelete(item.id)}
            aria-label={t("delete")}
            title={t("delete")}
          >
            <Trash2 className="size-4" />
          </Button>
        </>
      );
    }

    return (
      <>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onStart(item.id)}
          aria-label={t(item.status === "failed" ? "retryConversion" : "start")}
          title={t(item.status === "failed" ? "retryConversion" : "start")}
        >
          <Play className="size-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onDelete(item.id)}
          aria-label={t("delete")}
          title={t("delete")}
        >
          <Trash2 className="size-4" />
        </Button>
      </>
    );
  };

  return (
    <TooltipProvider delay={250}>
      <section className="flex min-h-72 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex min-w-0 items-center">
            <h2 className="shrink-0 text-sm font-semibold text-foreground">
              {t("conversionTasks")}
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {convertingCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onStopAll}
              >
                <Square className="size-3.5 fill-current" />
                {t("stopAllConversions")}
              </Button>
            ) : null}
            {retryableCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onConvertAll}
              >
                <Play className="size-3.5" />
                {t("convertAll")}
              </Button>
            ) : null}
            {completedCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearCompleted}
              >
                <Trash2 className="size-3.5" />
                {t("clearCompletedConversions")}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {isLoading ? <Loading /> : null}

          {!isLoading && error && tasks.length === 0 ? (
            <div className="flex h-full min-h-44 flex-col items-center justify-center px-6 text-center">
              <CircleAlert className="mb-2 size-7 text-destructive" />
              <div className="text-sm font-medium text-foreground">
                {t("loadFailed")}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {t("loadFailedDescription")}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={onRefresh}
              >
                <RefreshCw className="size-3.5" />
                {t("refresh")}
              </Button>
            </div>
          ) : null}

          {!isLoading && !error && tasks.length === 0 ? (
            <AppEmptyState
              className="h-full min-h-44"
              illustration={emptyConversions}
              title={t("emptyConversionsTitle")}
              description={t("emptyConversionsDescription")}
            />
          ) : null}

          {!isLoading && tasks.length > 0 ? (
            <div>
              {tasks.map((item) => {
                const sourceExtension = getPathExtension(item.path);
                const itemName = item.name || getPathFileName(item.path);
                const progress = Math.min(
                  100,
                  Math.max(0, Math.round(Number(item.progress) || 0)),
                );
                const showProgress =
                  item.status === "converting" && progress > 0;

                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b px-4 py-3 transition-colors last:border-b-0 hover:bg-surface-hover [content-visibility:auto]"
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <div
                          className="min-w-28 flex-1 truncate text-sm text-foreground"
                          title={itemName}
                        >
                          {itemName}
                        </div>
                        <DownloadTag
                          text={`${sourceExtension || "—"} → ${
                            item.outputFormat || "—"
                          }`}
                          variant="muted"
                          className="uppercase"
                        />
                        {renderStatusTag(item)}
                      </div>

                      {showProgress ? (
                        <div className="mt-2 flex max-w-xl items-center gap-2">
                          <Progress
                            value={progress}
                            className="h-1.5 rounded-none"
                          />
                          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-foreground-secondary">
                            {progress}%
                          </span>
                        </div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 justify-end gap-0.5">
                      {renderActions(item)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>

        {(data?.total ?? 0) > 0 ? (
          <PaginationControl
            className="shrink-0 justify-end border-t px-3 py-2"
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            isLoading={isLoading}
            onPageChange={onPageChange}
            onPageSizeChange={onPageSizeChange}
          />
        ) : null}
      </section>
    </TooltipProvider>
  );
}
