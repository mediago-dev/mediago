import { type Conversion } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { App, Pagination } from "antd";
import {
  FolderOpen,
  Music2,
  Pause,
  Play,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  MgButton,
  MgCard,
  MgIconButton,
  MgPill,
  MgSegment,
} from "@/components/mg";
import Loading from "@/components/loading";
import { ADD_CONVERT_TASK, DELETE_CONVERT, START_CONVERT } from "@/const";
import { useConversions } from "@/hooks/use-conversions";
import { usePlatform } from "@/hooks/use-platform";
import { isWeb, tdApp } from "@/utils";

const OUTPUT_FORMAT = "mp3";

type Quality = "high" | "medium" | "low";

/**
 * Status meta — colors lifted from the source design (MediaGo.dc.html
 * `cstMeta`, lines 926-932). Each entry also carries the i18n key used for
 * its pill label. `pending` reuses the existing key; the other three use
 * dedicated convert-status keys (see report for proposed additions).
 */
const STATUS_META: Record<
  string,
  { color: string; bg: string; labelKey: string }
> = {
  pending: {
    color: "#94a3b8",
    bg: "rgba(148,163,184,.14)",
    labelKey: "pending",
  },
  converting: {
    color: "#3b82f6",
    bg: "rgba(59,130,246,.14)",
    labelKey: "converting",
  },
  done: { color: "#10b981", bg: "rgba(16,185,129,.14)", labelKey: "done" },
  failed: { color: "#f43f5e", bg: "rgba(244,63,94,.13)", labelKey: "failed" },
};

const FALLBACK_META = STATUS_META.pending;

const Converter = () => {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const {
    data,
    isLoading,
    mutate,
    addConversion,
    deleteConversion,
    startConversion,
    stopConversion,
  } = useConversions({ current: page, pageSize });
  const { dialog, shell } = usePlatform();
  const { message } = App.useApp();
  const [quality, setQuality] = useState<Quality>("medium");
  const [filePath, setFilePath] = useState("");

  const handleBrowseFile = useMemoizedFn(async () => {
    if (isWeb) return;
    try {
      const paths = await dialog.open({ type: "file" });
      const file = paths?.[0];
      if (file) setFilePath(file);
    } catch (e: unknown) {
      message.error((e as Error).message);
    }
  });

  const handleAdd = useMemoizedFn(async (startImmediately: boolean) => {
    if (!filePath) {
      message.warning(t("pleaseSelectFile"));
      return;
    }
    try {
      const name = filePath.split(/[/\\]/).pop() || filePath;
      const conv = await addConversion({
        name,
        path: filePath,
        outputFormat: OUTPUT_FORMAT,
        quality,
      });
      tdApp.onEvent(ADD_CONVERT_TASK);
      if (startImmediately && conv?.id !== undefined && conv?.id !== null) {
        await startConversion(conv.id);
      }
      setFilePath("");
    } catch (e: unknown) {
      message.error((e as Error).message);
    }
  });

  const handleStart = useMemoizedFn(async (id: number) => {
    tdApp.onEvent(START_CONVERT);
    try {
      await startConversion(id);
    } catch (e: unknown) {
      message.error((e as Error).message);
    }
  });

  const handleStop = useMemoizedFn(async (id: number) => {
    try {
      await stopConversion(id);
    } catch (e: unknown) {
      message.error((e as Error).message);
    }
  });

  const handleDelete = useMemoizedFn(async (id: number) => {
    tdApp.onEvent(DELETE_CONVERT);
    await deleteConversion(id);
  });

  const handleOpenFolder = useMemoizedFn(async (targetPath: string) => {
    try {
      const sep = Math.max(
        targetPath.lastIndexOf("/"),
        targetPath.lastIndexOf("\\"),
      );
      const dir = sep > 0 ? targetPath.slice(0, sep) : targetPath;
      await shell.open(dir);
    } catch {
      // ignore — folder may have been removed
    }
  });

  const handleConvertAll = useMemoizedFn(async () => {
    // If a file is staged, add it first, then start everything pending/failed.
    if (filePath) {
      await handleAdd(false);
    }
    const pending = (data?.list ?? []).filter(
      (item) => item.status === "pending" || item.status === "failed",
    );
    if (!pending.length) return;
    tdApp.onEvent(START_CONVERT);
    await Promise.allSettled(pending.map((item) => startConversion(item.id)));
    mutate();
  });

  const list = data?.list ?? [];
  const showEmpty = !isLoading && list.length === 0;

  const renderActions = (item: Conversion) => {
    const startBtn = (
      <MgIconButton
        variant="primary"
        title={t("start")}
        onClick={() => handleStart(item.id)}
      >
        <Play size={15} strokeWidth={2.4} />
      </MgIconButton>
    );
    return (
      <div className="flex gap-[6px]">
        {item.status === "pending" && startBtn}
        {item.status === "failed" && startBtn}
        {item.status === "converting" && (
          <MgIconButton title={t("stop")} onClick={() => handleStop(item.id)}>
            <Pause size={15} strokeWidth={2.2} />
          </MgIconButton>
        )}
        {item.status === "done" && item.outputPath && (
          <MgIconButton
            title={t("openFolder")}
            onClick={() => handleOpenFolder(item.outputPath)}
          >
            <FolderOpen size={15} strokeWidth={2.2} />
          </MgIconButton>
        )}
        <MgIconButton
          title={t("delete")}
          className="text-mg-fg3"
          onClick={() => handleDelete(item.id)}
        >
          <Trash2 size={14} strokeWidth={2.2} />
        </MgIconButton>
      </div>
    );
  };

  return (
    <div className="h-full overflow-auto bg-mg-bg">
      <div className="mx-auto max-w-[980px] px-[clamp(16px,3vw,34px)] pb-[90px] pt-6">
        {/* heading */}
        <div className="mb-5">
          <h1 className="m-0 text-[clamp(22px,2.4vw,28px)] font-extrabold tracking-[-0.03em] text-mg-fg">
            {t("converter")}
          </h1>
          <p className="mt-[5px] text-[13.5px] text-mg-fg2">
            {t("convertSubtitle")}
          </p>
        </div>

        {/* add panel */}
        <MgCard className="mb-5 flex flex-col gap-[15px] rounded-[18px] p-[18px]">
          <button
            type="button"
            onClick={handleBrowseFile}
            disabled={isWeb}
            className="flex h-[90px] cursor-pointer flex-col items-center justify-center gap-[9px] rounded-[14px] border-[1.5px] border-dashed border-mg-line2 bg-mg-surface2 text-mg-fg2 transition-colors hover:border-mg-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <UploadCloud
              size={26}
              strokeWidth={2}
              className="text-mg-primary"
            />
            <span className="text-[13.5px] font-bold text-mg-fg">
              {t("browse")}
            </span>
          </button>

          {filePath && (
            <div className="-mt-1 truncate font-mono text-[11.5px] text-mg-fg3">
              {filePath}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <div className="mb-[7px] text-[12px] font-bold text-mg-fg2">
                {t("outputFormat")}
              </div>
              <div className="flex h-[38px] items-center gap-2 rounded-[10px] bg-mg-primary-weak px-4 text-[13px] font-extrabold text-mg-primary">
                <Music2 size={15} strokeWidth={2} />
                MP3
              </div>
            </div>

            <div>
              <div className="mb-[7px] text-[12px] font-bold text-mg-fg2">
                {t("quality")}
              </div>
              <MgSegment<Quality>
                value={quality}
                onChange={setQuality}
                options={[
                  { value: "high", label: t("qualityHigh") },
                  { value: "medium", label: t("qualityMedium") },
                  { value: "low", label: t("qualityLow") },
                ]}
              />
            </div>

            <div className="flex-1" />

            <MgButton
              variant="surface"
              size="md"
              onClick={() => handleAdd(false)}
            >
              {t("addToList")}
            </MgButton>
            <MgButton variant="primary" size="md" onClick={handleConvertAll}>
              {t("convertAll")}
            </MgButton>
          </div>
        </MgCard>

        {/* task list */}
        {isLoading && <Loading />}

        {showEmpty && (
          <MgCard className="flex flex-col items-center justify-center gap-2 rounded-[18px] py-16">
            <Music2 size={30} strokeWidth={1.6} className="text-mg-fg3" />
            <span className="text-[13.5px] text-mg-fg3">{t("noData")}</span>
          </MgCard>
        )}

        {!isLoading && list.length > 0 && (
          <div className="flex flex-col gap-[11px]">
            {list.map((item) => {
              const meta = STATUS_META[item.status] ?? FALLBACK_META;
              const showBar =
                item.status === "converting" || item.status === "failed";
              const sourcePath =
                item.status === "done" && item.outputPath
                  ? item.outputPath
                  : item.path;
              return (
                <MgCard
                  key={item.id}
                  className="flex flex-wrap items-center gap-[14px] rounded-[15px] p-[15px_17px]"
                >
                  {/* icon chip */}
                  <div
                    style={{ color: meta.color, background: meta.bg }}
                    className="flex size-[46px] flex-none items-center justify-center rounded-[12px]"
                  >
                    <Music2 size={22} strokeWidth={2} />
                  </div>

                  {/* body */}
                  <div className="min-w-[200px] flex-1">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="max-w-[300px] truncate text-[14px] font-bold text-mg-fg">
                        {item.name}
                      </span>
                      <MgPill className="bg-mg-surface2 text-mg-fg3 text-[10px]">
                        {(item.quality || quality).toUpperCase()}
                      </MgPill>
                    </div>
                    <div className="mb-2 truncate font-mono text-[11.5px] text-mg-fg3">
                      {sourcePath}
                    </div>
                    {showBar && (
                      <div className="flex items-center gap-[10px]">
                        <div className="h-[7px] flex-1 overflow-hidden rounded-[5px] bg-mg-surface2">
                          <div
                            style={{
                              width: `${item.progress ?? 0}%`,
                              background: meta.color,
                            }}
                            className="h-full rounded-[5px] transition-[width]"
                          />
                        </div>
                        <span
                          style={{ color: meta.color }}
                          className="min-w-[38px] text-right text-[12px] font-bold"
                        >
                          {item.progress ?? 0}%
                        </span>
                      </div>
                    )}
                    {item.status === "failed" && item.error && (
                      <div className="mt-[5px] text-[11.5px] text-[#f43f5e]">
                        {item.error}
                      </div>
                    )}
                  </div>

                  {/* status + actions */}
                  <div className="flex flex-col items-end gap-[9px]">
                    <MgPill
                      color={meta.color}
                      bg={meta.bg}
                      className="px-[10px] py-1 text-[11.5px]"
                    >
                      {t(meta.labelKey)}
                    </MgPill>
                    {renderActions(item)}
                  </div>
                </MgCard>
              );
            })}
          </div>
        )}

        {!isLoading && (data?.total ?? 0) > pageSize && (
          <Pagination
            className="mt-4 flex justify-end"
            current={page}
            pageSize={pageSize}
            onChange={(p, ps) => {
              setPage(p);
              setPageSize(ps);
            }}
            total={data?.total ?? 0}
          />
        )}
      </div>
    </div>
  );
};

export default Converter;
