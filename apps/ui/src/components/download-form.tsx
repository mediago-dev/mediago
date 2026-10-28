import { useAsyncEffect, useMemoizedFn } from "ahooks";
import { Download, ListPlus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "@/components/ui/toast";
import { useShallow } from "zustand/react/shallow";
import {
  createDownloadTasks,
  editDownloadTask,
  getDownloadFolders,
  startDownload,
} from "@/api/download-task";
import {
  editDockerDownloadTask,
  startDockerDownload,
} from "@/api/docker-download-task";
import { Button } from "@/components/ui/button";
import { DockerIcon } from "@/components/docker-icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ADD_TO_LIST, DOWNLOAD_NOW } from "@/const";
import { useDockerApi } from "@/hooks/use-docker-api";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { usePlatform } from "@/hooks/use-platform";
import { useSmartStreamSubmit } from "@/hooks/use-smart-stream-submit";
import { appStoreSelector, useAppStore } from "@/store/app";
import { useConfigStore } from "@/store/config";
import {
  SMART_DOWNLOAD_TYPE,
  type DownloadFormItem,
} from "@/store/download-dialog";
import { tdApp } from "@/utils";
import { isWeb } from "@/environment";
import { DiscoveredSourcePicker } from "./discovered-source-picker";
import { DownloadFormFields } from "./download-form-fields";
import { DownloadTargetField } from "./download-network-fields";
import {
  buildDownloadTasks,
  createDownloadFormValues,
  resolveEditTaskId,
  resolveSmartSubmitMode,
  type SmartSubmitMode,
} from "./download-form-logic";
import { M3u8ValidationDialog } from "./m3u8-validation-dialog";
import { StreamDiscoveryFallbackDialog } from "./stream-discovery-fallback-dialog";
import { StreamDiscoveryProgressDialog } from "./stream-discovery-progress-dialog";

export type { DownloadFormItem } from "@/store/download-dialog";

export interface DownloadFormProps {
  id: string;
  initialValues: DownloadFormItem;
  isEdit?: boolean;
  onConfirm?: (values: DownloadFormItem) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}

export type SubmitIntent = "save" | "download-now" | "docker";

export default function DownloadForm({
  id,
  initialValues,
  isEdit = false,
  onConfirm,
  onOpenChange,
  open,
}: DownloadFormProps) {
  const { enableDocker } = useAppStore(useShallow(appStoreSelector));
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submittingIntent, setSubmittingIntent] = useState<SubmitIntent | null>(
    null,
  );
  const [videoFolders, setVideoFolders] = useState<string[]>([]);
  const formId = useId();
  const pendingSmartIntent = useRef<SubmitIntent | null>(null);
  const pendingSmartMode = useRef<SmartSubmitMode | null>(null);
  const { t } = useTranslation();
  const { app, contextMenu } = usePlatform();
  const { createTab, loadUrl } = useBrowserActions();
  const { addVideosToDocker } = useDockerApi();
  const smartStream = useSmartStreamSubmit();
  const form = useForm<DownloadFormItem>({
    defaultValues: createDownloadFormValues(initialValues),
  });
  const downloadTarget =
    useWatch({ control: form.control, name: "downloadTarget" }) ?? "local";
  const existingTask =
    isEdit && resolveEditTaskId(initialValues.id) !== undefined;
  const dockerTarget = !isWeb && downloadTarget === "docker";

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false);
      return;
    }

    const values = createDownloadFormValues(initialValues);
    form.reset(values);
    setAdvancedOpen(
      Boolean(
        values.folder?.trim() ||
        values.headers?.trim() ||
        values.proxyMode !== "inherit",
      ),
    );
  }, [form, initialValues, open]);

  useAsyncEffect(async () => {
    if (!open) return;
    try {
      const fetchedFolders = await getDownloadFolders();
      if (Array.isArray(fetchedFolders)) setVideoFolders(fetchedFolders);
    } catch {
      // Go Core may not be ready yet, ignore.
    }
  }, [open]);

  const setOpen = useMemoizedFn((nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setAdvancedOpen(false);
      pendingSmartIntent.current = null;
      pendingSmartMode.current = null;
      void smartStream.cancel();
    }
  });

  const showTextMenu = useMemoizedFn(() => {
    contextMenu.show([
      { key: "copy", label: t("copy"), role: "copy" },
      { key: "paste", label: t("paste"), role: "paste" },
    ]);
  });

  const openSourceExtract = useMemoizedFn(async (requestedURL?: string) => {
    const url = requestedURL?.trim() || form.getValues("url")?.trim();
    if (!url) return false;

    await app.showBrowserWindow();
    const tabId = await createTab();
    if (!tabId) return false;

    smartStream.dismissFallback();
    pendingSmartIntent.current = null;
    pendingSmartMode.current = null;
    setOpen(false);
    void loadUrl(url, tabId);
    return true;
  });

  const beginSourceInspection = useMemoizedFn(
    async (
      values: DownloadFormItem,
      intent: SubmitIntent,
      mode: SmartSubmitMode,
    ) => {
      pendingSmartIntent.current = intent;
      pendingSmartMode.current = mode;
      const result = await smartStream.begin(
        values,
        {
          startDownload: intent === "download-now",
          target:
            intent === "docker" ||
            (!isWeb && values.downloadTarget === "docker")
              ? "docker"
              : "local",
        },
        { allowBrowserDiscovery: mode === "smart" },
      );
      return result;
    },
  );

  const submit = useMemoizedFn(async (intent: SubmitIntent) => {
    if (submittingIntent || !(await form.trigger())) return;

    setSubmittingIntent(intent);
    try {
      const values = form.getValues();
      const target =
        intent === "docker" || (!isWeb && values.downloadTarget === "docker")
          ? "docker"
          : "local";
      if (target === "docker" && !enableDocker)
        throw new Error(t("dockerDownloadSetupHelp"));
      const smartSubmitMode = resolveSmartSubmitMode(values, isEdit);
      if (smartSubmitMode) {
        await beginSourceInspection(values, intent, smartSubmitMode);
        return;
      }
      const tasks = buildDownloadTasks(values, isWeb ? "docker" : target);

      if (
        target === "docker" &&
        (!existingTask ||
          initialValues.origin !== "docker" ||
          intent === "docker")
      ) {
        await addVideosToDocker({
          items: tasks,
          immediate: intent === "download-now",
        });
        toast.add({ title: t("addToDockerSuccess"), type: "success" });
        setOpen(false);
        onConfirm?.(values);
        return;
      }

      const editId = resolveEditTaskId(values.id);
      if (isEdit && editId !== undefined) {
        if (values.origin === "docker") {
          await editDockerDownloadTask(editId, tasks[0]);
        } else {
          await editDownloadTask(editId, tasks[0]);
        }
        if (intent === "download-now") {
          if (values.origin === "docker") {
            await startDockerDownload(editId);
          } else {
            await startDownload(editId);
          }
        }
      } else {
        await createDownloadTasks(tasks, intent === "download-now");
      }

      if (intent === "save" && !isEdit) {
        tdApp.onEvent(ADD_TO_LIST, { id });
      }
      if (intent === "download-now") {
        tdApp.onEvent(DOWNLOAD_NOW, { id });
      }

      setOpen(false);
      onConfirm?.(values);
    } catch (error: unknown) {
      if ((error as Error)?.name !== "AbortError") {
        toast.add({
          title: (error as Error)?.message || t("pleaseEnterCorrectFormInfo"),
          type: "error",
        });
      }
    } finally {
      setSubmittingIntent(null);
    }
  });

  const submitting = submittingIntent !== null;
  const smartPhase = smartStream.view.machine.phase;
  const smartBusy = smartPhase === "probing" || smartPhase === "discovering";

  const confirmDiscoveredSources = useMemoizedFn(
    async (
      sourceIds: string[],
      names: Record<string, string>,
      variantUrls: Record<string, string>,
    ) => {
      const intent = pendingSmartIntent.current;
      if (!intent) return;
      setSubmittingIntent(intent);
      try {
        await smartStream.confirm(sourceIds, names, variantUrls);
        const values = form.getValues();
        if (intent === "docker" || dockerTarget)
          toast.add({ title: t("addToDockerSuccess"), type: "success" });
        if (intent === "save") tdApp.onEvent(ADD_TO_LIST, { id });
        if (intent === "download-now") tdApp.onEvent(DOWNLOAD_NOW, { id });
        pendingSmartIntent.current = null;
        pendingSmartMode.current = null;
        setOpen(false);
        onConfirm?.(values);
      } catch (error) {
        toast.add({
          title:
            error instanceof Error
              ? error.message
              : t("pleaseEnterCorrectFormInfo"),
          type: "error",
        });
      } finally {
        setSubmittingIntent(null);
      }
    },
  );

  const cancelSmartStream = useMemoizedFn(() => {
    pendingSmartIntent.current = null;
    pendingSmartMode.current = null;
    void smartStream.cancel();
  });

  const useSmartDownload = useMemoizedFn(async () => {
    const intent = pendingSmartIntent.current;
    if (!intent) return;

    form.setValue("type", SMART_DOWNLOAD_TYPE, {
      shouldDirty: true,
      shouldValidate: true,
    });
    useConfigStore.getState().setLastDownloadTypes(SMART_DOWNLOAD_TYPE);
    smartStream.dismissFallback();
    setSubmittingIntent(intent);
    try {
      await beginSourceInspection(form.getValues(), intent, "smart");
    } catch (error: unknown) {
      if ((error as Error)?.name !== "AbortError") {
        toast.add({
          title: (error as Error)?.message || t("pleaseEnterCorrectFormInfo"),
          type: "error",
        });
      }
    } finally {
      setSubmittingIntent(null);
    }
  });

  const smartProgressOpen =
    smartPhase === "probing" || smartPhase === "discovering";
  const smartPickerOpen =
    smartPhase === "selecting" || smartPhase === "creating";
  const smartFallbackOpen = Boolean(smartStream.view.fallbackReason);
  const smartWorkflowOpen =
    pendingSmartMode.current !== null &&
    (smartProgressOpen || smartPickerOpen || smartFallbackOpen);

  return (
    <>
      <Dialog open={open && !smartWorkflowOpen} onOpenChange={setOpen}>
        <DialogContent className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[680px] max-sm:bottom-0 max-sm:top-auto max-sm:max-h-[94vh] max-sm:translate-y-0 max-sm:rounded-b-none">
          <DialogHeader className="border-b px-6 py-4 pr-14 sm:px-7 sm:pr-14">
            <DialogTitle>
              {isEdit ? t("editDownload") : t("newDownload")}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {t("pleaseEnterCorrectFormInfo")}
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-4 overflow-y-auto px-6 py-5 sm:px-7"
            onSubmit={(event) => event.preventDefault()}
          >
            <DownloadTargetField
              form={form}
              formId={formId}
              enabled={enableDocker}
              locked={existingTask}
            />
            {resolveEditTaskId(initialValues.id) !== undefined ? (
              <input
                type="hidden"
                {...form.register("id", { valueAsNumber: true })}
              />
            ) : null}
            <DownloadFormFields
              advancedOpen={advancedOpen}
              form={form}
              formId={formId}
              isEdit={isEdit}
              onAdvancedOpenChange={setAdvancedOpen}
              onShowTextMenu={showTextMenu}
              videoFolders={dockerTarget ? [] : videoFolders}
            />
          </form>

          <DialogFooter className="border-t bg-surface-subtle/60 px-6 py-4 sm:px-7">
            <Button
              type="button"
              variant="ghost"
              disabled={smartPhase === "creating"}
              onClick={() => setOpen(false)}
            >
              {t("cancel")}
            </Button>
            <div className="flex flex-wrap justify-end gap-2">
              {enableDocker &&
              existingTask &&
              initialValues.origin !== "docker" ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={submitting || smartBusy}
                  onClick={() => submit("docker")}
                >
                  <DockerIcon className="size-4" />
                  {t("copyToDocker")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                disabled={submitting || smartBusy}
                onClick={() => submit("save")}
              >
                <ListPlus className="size-4" />
                {existingTask
                  ? t("save")
                  : dockerTarget
                    ? t("addToDockerList")
                    : t("addToList")}
              </Button>
              <Button
                type="button"
                disabled={submitting || smartBusy}
                onClick={() => submit("download-now")}
              >
                <Download className="size-4" />
                {dockerTarget ? t("downloadOnDocker") : t("downloadNow")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <StreamDiscoveryProgressDialog
        open={open && smartProgressOpen}
        phase={smartPhase}
        url={form.getValues("url")}
        onCancel={cancelSmartStream}
      />
      <DiscoveredSourcePicker
        busy={smartPhase === "creating" || submitting}
        open={open && smartPickerOpen}
        partial={smartStream.view.partial}
        sources={smartStream.view.sources}
        onCancel={cancelSmartStream}
        onConfirm={confirmDiscoveredSources}
      />
      <StreamDiscoveryFallbackDialog
        canOpenSourceExtract={!isWeb}
        open={
          open &&
          Boolean(smartStream.view.fallbackReason) &&
          pendingSmartMode.current === "smart"
        }
        onClose={() => {
          pendingSmartIntent.current = null;
          pendingSmartMode.current = null;
          smartStream.dismissFallback();
        }}
        onOpenSourceExtract={() => void openSourceExtract()}
      />
      <M3u8ValidationDialog
        open={
          open &&
          Boolean(smartStream.view.fallbackReason) &&
          pendingSmartMode.current === "hls-only"
        }
        onCancel={cancelSmartStream}
        onUseSmartDownload={() => void useSmartDownload()}
      />
    </>
  );
}
