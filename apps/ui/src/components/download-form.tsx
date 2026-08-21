import { useAsyncEffect, useMemoizedFn } from "ahooks";
import { Container, Download, ListPlus } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import {
  createDownloadTasks,
  editDownloadTask,
  getDownloadFolders,
  startDownload,
} from "@/api/download-task";
import { Button } from "@/components/ui/button";
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
import { usePlatform } from "@/hooks/use-platform";
import { appStoreSelector, useAppStore } from "@/store/app";
import type { DownloadFormItem } from "@/store/download-dialog";
import { tdApp } from "@/utils";
import { DownloadFormFields } from "./download-form-fields";
import {
  buildDownloadTasks,
  createDownloadFormValues,
  resolveEditTaskId,
} from "./download-form-logic";

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
  const { t } = useTranslation();
  const { contextMenu } = usePlatform();
  const { addVideosToDocker } = useDockerApi();
  const form = useForm<DownloadFormItem>({
    defaultValues: createDownloadFormValues(initialValues),
  });

  useEffect(() => {
    if (!open) {
      setAdvancedOpen(false);
      return;
    }

    const values = createDownloadFormValues(initialValues);
    form.reset(values);
    setAdvancedOpen(Boolean(values.folder?.trim() || values.headers?.trim()));
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
    if (!nextOpen) setAdvancedOpen(false);
  });

  const showTextMenu = useMemoizedFn(() => {
    contextMenu.show([
      { key: "copy", label: t("copy"), role: "copy" },
      { key: "paste", label: t("paste"), role: "paste" },
    ]);
  });

  const submit = useMemoizedFn(async (intent: SubmitIntent) => {
    if (submittingIntent || !(await form.trigger())) return;

    setSubmittingIntent(intent);
    try {
      const values = form.getValues();
      const tasks = buildDownloadTasks(values);

      if (intent === "docker") {
        await addVideosToDocker({ items: tasks });
        toast.success(t("addToDockerSuccess"));
        return;
      }

      const editId = resolveEditTaskId(values.id);
      if (isEdit && editId !== undefined) {
        await editDownloadTask(editId, tasks[0]);
        if (intent === "download-now") {
          await startDownload(editId);
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
      toast.error((error as Error)?.message || t("pleaseEnterCorrectFormInfo"));
    } finally {
      setSubmittingIntent(null);
    }
  });

  const submitting = submittingIntent !== null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
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
            videoFolders={videoFolders}
          />
        </form>

        <DialogFooter className="border-t bg-surface-subtle/60 px-6 py-4 sm:px-7">
          <Button
            type="button"
            variant="ghost"
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            {t("cancel")}
          </Button>
          <div className="flex flex-wrap justify-end gap-2">
            {enableDocker ? (
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => submit("docker")}
              >
                <Container className="size-4" />
                {t("addToDocker")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => submit("save")}
            >
              <ListPlus className="size-4" />
              {isEdit ? t("save") : t("addToList")}
            </Button>
            <Button
              type="button"
              disabled={submitting}
              onClick={() => submit("download-now")}
            >
              <Download className="size-4" />
              {t("downloadNow")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
