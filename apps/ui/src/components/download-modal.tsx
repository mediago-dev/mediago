import { type DownloadTask, DownloadType } from "@mediago/shared-common";
import { useAsyncEffect, useMemoizedFn } from "ahooks";
import { App } from "antd";
import { CircleAlert, Download, Folder, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSWRConfig } from "swr";
import { useShallow } from "zustand/react/shallow";
import {
  createDownloadTasks,
  editDownloadTask,
  getDownloadFolders,
  startDownload,
} from "@/api/download-task";
import { MgButton, MgIconButton, MgSegment } from "@/components/mg";
import { useDockerApi } from "@/hooks/use-docker-api";
import { usePlatform } from "@/hooks/use-platform";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { useUiStore } from "@/store/ui";
import { type MgType, typeMeta } from "@/theme/mg";
import { cn, isWeb } from "@/utils";

const URL_RE = /^(file|https?|magnet):\/\/.+/i;

const TYPE_OPTIONS: { ui: MgType; value: DownloadType }[] = [
  { ui: "m3u8", value: DownloadType.m3u8 },
  { ui: "bilibili", value: DownloadType.bilibili },
  { ui: "youtube", value: DownloadType.youtube },
  { ui: "mp4", value: DownloadType.direct },
  { ui: "mediago", value: DownloadType.mediago },
];

interface BatchRow {
  idx: number;
  url: string;
  name: string;
  folder: string;
  valid: boolean;
}

function parseBatch(text: string, defaultFolder: string): BatchRow[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [url, name = "", folder = ""] = line.split(/\s+/);
      return {
        idx: i + 1,
        url,
        name,
        folder: folder || defaultFolder,
        valid: URL_RE.test(url),
      };
    });
}

const inputCls =
  "w-full rounded-[12px] border-[1.5px] border-mg-line bg-mg-surface2 px-3.5 text-mg-fg outline-none transition-colors focus:border-mg-primary focus:bg-mg-surface";

export function DownloadModal() {
  const { t } = useTranslation();
  const { message } = App.useApp();
  const { mutate } = useSWRConfig();
  const { dialog } = usePlatform();
  const { addVideosToDocker } = useDockerApi();
  const { enableDocker, local } = useAppStore(useShallow(appStoreSelector));
  const {
    lastIsBatch,
    lastDownloadTypes,
    setLastIsBatch,
    setLastDownloadTypes,
  } = useConfigStore(useShallow(downloadFormSelector));

  const { open, mode, editTask, prefill, close } = useUiStore(
    useShallow((s) => ({
      open: s.downloadModalOpen,
      mode: s.downloadModalMode,
      editTask: s.editTask,
      prefill: s.prefill,
      close: s.closeDownloadModal,
    })),
  );
  const isEdit = mode === "edit";

  const [type, setType] = useState<DownloadType>(DownloadType.m3u8);
  const [batch, setBatch] = useState(false);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [folder, setFolder] = useState("");
  const [headers, setHeaders] = useState("");
  const [batchText, setBatchText] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [folders, setFolders] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // initialize when opened
  useEffect(() => {
    if (!open) return;
    setUrlTouched(false);
    if (isEdit && editTask) {
      setType(editTask.type ?? DownloadType.m3u8);
      setBatch(false);
      setName(editTask.name ?? "");
      setUrl(editTask.url ?? "");
      setFolder(editTask.folder ?? local ?? "");
      setHeaders(editTask.headers ?? "");
      setBatchText("");
    } else {
      setType(prefill?.type ?? lastDownloadTypes ?? DownloadType.m3u8);
      setBatch(prefill?.batch ?? lastIsBatch ?? false);
      setName(prefill?.name ?? "");
      setUrl(prefill?.url ?? "");
      setFolder(prefill?.folder ?? local ?? "");
      setHeaders(prefill?.headers ?? "");
      setBatchText(prefill?.batchList ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useAsyncEffect(async () => {
    if (!open) return;
    try {
      const f = await getDownloadFolders();
      if (Array.isArray(f)) setFolders(f);
    } catch {
      // Go Core may not be ready
    }
  }, [open]);

  const pickType = useMemoizedFn((v: DownloadType) => {
    setType(v);
    setLastDownloadTypes(v);
  });
  const pickBatch = useMemoizedFn((v: boolean) => {
    setBatch(v);
    setLastIsBatch(v);
  });

  const browseFolder = useMemoizedFn(async () => {
    try {
      const res = await dialog.open({ type: "directory" });
      if (Array.isArray(res) && res[0]) setFolder(res[0]);
    } catch {
      // ignore
    }
  });

  const urlError = urlTouched && url.trim() !== "" && !URL_RE.test(url);
  const batchRows = batch ? parseBatch(batchText, folder || local || "") : [];
  const validCount = batchRows.filter((r) => r.valid).length;
  const invalidCount = batchRows.length - validCount;

  const buildTasks = (): Omit<DownloadTask, "id">[] | null => {
    if (batch) {
      const tasks = batchRows
        .filter((r) => r.valid)
        .map((r) => ({
          url: r.url,
          name: r.name || undefined,
          headers: headers || undefined,
          type,
          folder: r.folder || undefined,
        }));
      return tasks.length ? tasks : null;
    }
    if (!URL_RE.test(url)) return null;
    return [
      {
        name: name || undefined,
        url,
        headers: headers || undefined,
        type,
        folder: folder || undefined,
      },
    ];
  };

  const refresh = () =>
    mutate(
      (key) =>
        typeof key === "object" &&
        key !== null &&
        (key as { key?: string }).key === "api/tasks",
    );

  const submit = useMemoizedFn(async (now: boolean) => {
    setUrlTouched(true);
    const tasks = buildTasks();
    if (!tasks) {
      message.error(t("pleaseEnterCorrectFormInfo"));
      return;
    }
    setSubmitting(true);
    try {
      if (isEdit && editTask) {
        await editDownloadTask(editTask.id, tasks[0]);
        if (now) await startDownload(editTask.id);
      } else {
        await createDownloadTasks(tasks, now);
      }
      close();
      refresh();
      message.success(t("addTaskSuccess"));
    } catch (e) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setSubmitting(false);
    }
  });

  const addToDocker = useMemoizedFn(async () => {
    const tasks = buildTasks();
    if (!tasks) {
      message.error(t("pleaseEnterCorrectFormInfo"));
      return;
    }
    try {
      await addVideosToDocker({ items: tasks });
      message.success(t("addToDockerSuccess"));
    } catch (e) {
      message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    }
  });

  if (!open) return null;

  return (
    <div
      onClick={close}
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(15,15,30,.5)] backdrop-blur-[4px] [animation:mgfade_.18s_ease]"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-[min(620px,100%)] flex-col overflow-hidden rounded-t-[24px] bg-mg-surface [animation:mgpop_.22s_cubic-bezier(.2,.9,.3,1)]"
      >
        {/* header */}
        <div className="flex items-start gap-3.5 border-b border-mg-line px-[22px] pb-3.5 pt-5">
          <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[13px] bg-mg-primary-weak">
            <Download size={22} className="text-mg-primary" strokeWidth={2.2} />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-extrabold tracking-[-0.02em] text-mg-fg">
              {isEdit ? t("editDownload") : t("newDownload")}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-mg-fg2">{t("modalSub")}</p>
          </div>
          <MgIconButton variant="soft" onClick={close} title={t("cancel")}>
            <X size={17} strokeWidth={2.4} />
          </MgIconButton>
        </div>

        {/* single / batch tabs */}
        {!isEdit && (
          <div className="px-[22px] pt-4">
            <MgSegment
              variant="card"
              className="flex w-full"
              itemClassName="flex-1"
              value={batch ? "batch" : "single"}
              onChange={(v) => pickBatch(v === "batch")}
              options={[
                { value: "single", label: t("singleDownload") },
                { value: "batch", label: t("batchDownload") },
              ]}
            />
          </div>
        )}

        {/* body */}
        <div className="flex flex-col gap-4 overflow-y-auto px-[22px] py-[18px]">
          {/* type picker */}
          <div>
            <label className="mb-2 block text-[12.5px] font-bold text-mg-fg2">
              {t("videoType")}
            </label>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(96px,1fr))] gap-2">
              {TYPE_OPTIONS.map((o) => {
                const meta = typeMeta(o.ui);
                const on = type === o.value;
                return (
                  <button
                    key={o.ui}
                    type="button"
                    onClick={() => pickType(o.value)}
                    className={cn(
                      "flex h-16 flex-col items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] transition-colors",
                      on
                        ? "border-mg-primary bg-mg-primary-weak"
                        : "border-mg-line bg-mg-surface2",
                    )}
                  >
                    <span className="text-[18px]">{meta.glyph}</span>
                    <span
                      style={{ color: on ? "var(--mg-primary)" : meta.color }}
                      className="text-[11.5px] font-bold"
                    >
                      {meta.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {!batch ? (
            <>
              <Field label={t("videoName")}>
                <input
                  className={cn(inputCls, "h-11 text-[14px]")}
                  value={name}
                  placeholder={t("pleaseEnterVideoName")}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field label={t("videoLink")}>
                <input
                  className={cn(
                    inputCls,
                    "h-11 font-mono text-[12.5px]",
                    urlError && "border-[#f43f5e]",
                  )}
                  value={url}
                  placeholder={t("pleaseEnterOnlineVideoUrl")}
                  onChange={(e) => setUrl(e.target.value)}
                  onBlur={() => setUrlTouched(true)}
                />
                {urlError && (
                  <div className="mt-1.5 flex items-center gap-1.5 text-[11.5px] text-[#f43f5e]">
                    <CircleAlert size={13} strokeWidth={2.2} />
                    {t("pleaseEnterCorrectVideoLink")}
                  </div>
                )}
              </Field>
              <Field label={t("folder")}>
                <div className="flex gap-2">
                  <input
                    className={cn(
                      inputCls,
                      "h-11 flex-1 font-mono text-[12.5px]",
                    )}
                    value={folder}
                    list="mg-folders"
                    placeholder={t("pleaseInputVideoFolder")}
                    onChange={(e) => setFolder(e.target.value)}
                  />
                  <datalist id="mg-folders">
                    {folders.map((f) => (
                      <option key={f} value={f} />
                    ))}
                  </datalist>
                  {!isWeb && (
                    <MgIconButton
                      variant="soft"
                      size="lg"
                      className="size-11"
                      onClick={browseFolder}
                      title={t("selectFolder")}
                    >
                      <Folder size={18} strokeWidth={2} />
                    </MgIconButton>
                  )}
                </div>
              </Field>
              <Field
                label={
                  <>
                    {t("additionalHeaders")}{" "}
                    <span className="font-medium text-mg-fg3">
                      {t("optional")}
                    </span>
                  </>
                }
              >
                <textarea
                  className={cn(
                    inputCls,
                    "h-[70px] resize-y py-2.5 font-mono text-[12px] leading-relaxed",
                  )}
                  value={headers}
                  placeholder={"Referer: https://...\nUser-Agent: ..."}
                  onChange={(e) => setHeaders(e.target.value)}
                />
              </Field>
            </>
          ) : (
            <>
              <Field
                label={
                  <div className="flex items-center justify-between">
                    <span>{t("videoLink")}</span>
                    <span className="font-mono text-[11px] font-normal text-mg-fg3">
                      url [name] [folder]
                    </span>
                  </div>
                }
              >
                <textarea
                  className={cn(
                    inputCls,
                    "h-[120px] resize-y py-3 font-mono text-[12px] leading-[1.7]",
                  )}
                  value={batchText}
                  placeholder={t("videoLikeDescription")}
                  onChange={(e) => setBatchText(e.target.value)}
                />
              </Field>
              <div>
                <div className="mb-2.5 flex items-center gap-2">
                  <span className="text-[12.5px] font-bold text-mg-fg2">
                    {t("parsePreview")}
                  </span>
                  <span className="rounded-md bg-mg-primary-weak px-2 py-0.5 text-[11px] font-bold text-mg-primary">
                    {t("validCount", { count: validCount })}
                  </span>
                  {invalidCount > 0 && (
                    <span className="rounded-md bg-[rgba(245,158,11,.14)] px-2 py-0.5 text-[11px] font-bold text-[#d97706]">
                      {t("invalidCount", { count: invalidCount })}
                    </span>
                  )}
                </div>
                {batchRows.length === 0 ? (
                  <div className="rounded-[12px] border-[1.5px] border-dashed border-mg-line p-[26px] text-center text-[12.5px] text-mg-fg3">
                    {t("batchEmptyHint")}
                  </div>
                ) : (
                  <div className="max-h-[200px] overflow-y-auto rounded-[12px] border border-mg-line">
                    {batchRows.map((r) => (
                      <div
                        key={r.idx}
                        className={cn(
                          "flex items-center gap-2.5 border-b border-mg-line px-3.5 py-2.5 last:border-b-0",
                          !r.valid && "bg-[rgba(245,158,11,.06)]",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-[22px] shrink-0 items-center justify-center rounded-[7px] text-[11px] font-extrabold",
                            r.valid
                              ? "bg-mg-primary-weak text-mg-primary"
                              : "bg-[rgba(245,158,11,.16)] text-[#d97706]",
                          )}
                        >
                          {r.idx}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div
                            className={cn(
                              "truncate text-[13px] font-bold",
                              r.valid ? "text-mg-fg" : "text-mg-fg2",
                            )}
                          >
                            {r.name || r.url}
                          </div>
                          <div className="truncate font-mono text-[11px] text-mg-fg3">
                            {r.url}
                          </div>
                        </div>
                        {r.valid ? (
                          <span className="text-[#10b981]">✓</span>
                        ) : (
                          <CircleAlert
                            size={17}
                            className="text-[#d97706]"
                            strokeWidth={2.2}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Field label={t("sharedHeaders")}>
                <textarea
                  className={cn(
                    inputCls,
                    "h-14 resize-y py-2.5 font-mono text-[12px] leading-relaxed",
                  )}
                  value={headers}
                  placeholder={"Referer: https://..."}
                  onChange={(e) => setHeaders(e.target.value)}
                />
              </Field>
            </>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center gap-2.5 border-t border-mg-line px-[22px] py-3.5">
          {enableDocker && (
            <MgButton variant="surface" size="lg" onClick={addToDocker}>
              {t("addToDocker")}
            </MgButton>
          )}
          <div className="flex-1" />
          <MgButton
            variant="surface"
            size="lg"
            disabled={submitting}
            onClick={() => submit(false)}
          >
            {t("addToList")}
          </MgButton>
          <MgButton
            variant="primary"
            size="lg"
            disabled={submitting}
            onClick={() => submit(true)}
          >
            <Download size={16} strokeWidth={2.2} />
            {t("downloadNow")}
          </MgButton>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-[12.5px] font-bold text-mg-fg2">
        {label}
      </label>
      {children}
    </div>
  );
}
