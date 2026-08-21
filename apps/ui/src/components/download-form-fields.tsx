import { DownloadType } from "@mediago/shared-common";
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Controller, type UseFormReturn, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import type { DownloadFormItem } from "@/store/download-dialog";
import { cn } from "@/utils";
import { BatchDownloadField } from "./batch-download-field";
import { DOWNLOAD_URL_RE } from "./download-form-logic";

const DOWNLOAD_TYPE_OPTIONS = [
  { value: DownloadType.m3u8, labelKey: "streamMedia" },
  { value: DownloadType.bilibili, labelKey: "bilibiliMedia" },
  { value: DownloadType.youtube, labelKey: "youtubeMedia" },
  { value: DownloadType.direct, labelKey: "direct" },
  { value: DownloadType.mediago, labelKey: "mediagoMedia" },
] as const;

interface FormRowProps {
  children: ReactNode;
  error?: string;
  errorId?: string;
  htmlFor: string;
  label: ReactNode;
  required?: boolean;
}

function FormRow({
  children,
  error,
  errorId,
  htmlFor,
  label,
  required,
}: FormRowProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start sm:gap-x-4 sm:gap-y-0">
      <label
        htmlFor={htmlFor}
        className="flex min-h-8 items-center text-sm font-medium"
      >
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-1 text-destructive">
            *
          </span>
        ) : null}
      </label>
      <div className="min-w-0 space-y-2">
        {children}
        {error ? (
          <p id={errorId} role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}

interface DownloadFormFieldsProps {
  advancedOpen: boolean;
  form: UseFormReturn<DownloadFormItem>;
  formId: string;
  isEdit: boolean;
  onAdvancedOpenChange: (open: boolean) => void;
  onShowTextMenu: () => void;
  videoFolders: string[];
}

export function DownloadFormFields({
  advancedOpen,
  form,
  formId,
  isEdit,
  onAdvancedOpenChange,
  onShowTextMenu,
  videoFolders,
}: DownloadFormFieldsProps) {
  const { t } = useTranslation();
  const { setLastDownloadTypes, setLastIsBatch } = useConfigStore(
    useShallow(downloadFormSelector),
  );
  const isBatch = useWatch({ control: form.control, name: "batch" });
  const selectedType = useWatch({ control: form.control, name: "type" });

  return (
    <>
      {!isEdit ? (
        <FormRow htmlFor={`${formId}-single-mode`} label={t("downloadMode")}>
          <Controller
            control={form.control}
            name="batch"
            render={({ field }) => {
              const batchMode = Boolean(field.value);
              const selectMode = (nextBatchMode: boolean) => {
                field.onChange(nextBatchMode);
                setLastIsBatch(nextBatchMode);
              };

              return (
                <div
                  role="group"
                  aria-label={t("downloadMode")}
                  className="grid grid-cols-2 rounded-md bg-surface-subtle p-1"
                >
                  <button
                    id={`${formId}-single-mode`}
                    type="button"
                    aria-pressed={!batchMode}
                    onClick={() => selectMode(false)}
                    className={cn(
                      "h-[30px] rounded-sm px-2.5 text-sm font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/15",
                      !batchMode &&
                        "bg-surface-raised text-foreground shadow-sm",
                    )}
                  >
                    {t("singleDownload")}
                  </button>
                  <button
                    type="button"
                    aria-pressed={batchMode}
                    onClick={() => selectMode(true)}
                    className={cn(
                      "h-[30px] rounded-sm px-2.5 text-sm font-medium text-muted-foreground outline-none transition-[background-color,color,box-shadow] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/15",
                      batchMode &&
                        "bg-surface-raised text-foreground shadow-sm",
                    )}
                  >
                    {t("batchDownload")}
                  </button>
                </div>
              );
            }}
          />
        </FormRow>
      ) : null}

      <FormRow
        errorId={`${formId}-type-error`}
        htmlFor={`${formId}-type`}
        label={t("videoType")}
        required
        error={form.formState.errors.type?.message}
      >
        <Controller
          control={form.control}
          name="type"
          rules={{ required: t("pleaseEnterVideoName") }}
          render={({ field }) => (
            <Select
              value={field.value}
              disabled={isEdit}
              onValueChange={(value) => {
                const type = value as DownloadType;
                field.onChange(type);
                setLastDownloadTypes(type);
              }}
            >
              <SelectTrigger
                id={`${formId}-type`}
                className="w-full"
                aria-invalid={Boolean(form.formState.errors.type)}
                aria-describedby={
                  form.formState.errors.type
                    ? `${formId}-type-error`
                    : undefined
                }
              >
                <SelectValue placeholder={t("pleaseSelectVideoType")} />
              </SelectTrigger>
              <SelectContent>
                {DOWNLOAD_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </FormRow>

      {!isBatch ? (
        <FormRow
          errorId={`${formId}-name-error`}
          htmlFor={`${formId}-name`}
          label={t("videoName")}
          required={selectedType !== DownloadType.bilibili}
          error={form.formState.errors.name?.message}
        >
          <Input
            id={`${formId}-name`}
            placeholder={t("pleaseEnterVideoName")}
            onContextMenu={onShowTextMenu}
            aria-invalid={Boolean(form.formState.errors.name)}
            aria-describedby={
              form.formState.errors.name ? `${formId}-name-error` : undefined
            }
            {...form.register("name", {
              validate: (value) =>
                isBatch ||
                selectedType === DownloadType.bilibili ||
                value?.trim()
                  ? true
                  : t("pleaseEnterCorrectFormInfo"),
            })}
          />
        </FormRow>
      ) : null}

      {isBatch && !isEdit ? (
        <FormRow
          errorId={`${formId}-batch-list-error`}
          htmlFor={`${formId}-batch-list`}
          label={t("videoLink")}
          required
          error={form.formState.errors.batchList?.message}
        >
          <BatchDownloadField
            form={form}
            formId={formId}
            onShowTextMenu={onShowTextMenu}
          />
        </FormRow>
      ) : null}

      {!isBatch || isEdit ? (
        <FormRow
          errorId={`${formId}-url-error`}
          htmlFor={`${formId}-url`}
          label={t("videoLink")}
          required
          error={form.formState.errors.url?.message}
        >
          <Input
            id={`${formId}-url`}
            placeholder={t("pleaseEnterOnlineVideoUrlOrDragM3U8Here")}
            onContextMenu={onShowTextMenu}
            aria-invalid={Boolean(form.formState.errors.url)}
            aria-describedby={
              form.formState.errors.url ? `${formId}-url-error` : undefined
            }
            {...form.register("url", {
              validate: (value) => {
                if (isBatch && !isEdit) return true;
                if (!value?.trim()) return t("pleaseEnterOnlineVideoUrl");
                return DOWNLOAD_URL_RE.test(value.trim())
                  ? true
                  : t("pleaseEnterCorrectVideoLink");
              },
            })}
            onDrop={(event) => {
              const file = event.dataTransfer.files[0] as
                | (File & { path?: string })
                | undefined;
              if (!file?.path) return;
              form.setValue("url", `file://${file.path}`, {
                shouldDirty: true,
                shouldValidate: true,
              });
            }}
          />
        </FormRow>
      ) : null}

      <details
        open={advancedOpen}
        onToggle={(event) => onAdvancedOpenChange(event.currentTarget.open)}
        className="group border-t border-border/70 pt-1"
      >
        <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-1 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/15 [&::-webkit-details-marker]:hidden">
          <span>{t("moreSettings")}</span>
          <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
        </summary>
        <div className="space-y-4 pt-3">
          {!isBatch ? (
            <FormRow htmlFor={`${formId}-folder`} label={t("folder")}>
              <Input
                id={`${formId}-folder`}
                list={`${formId}-folder-options`}
                placeholder={t("pleaseInputVideoFolder")}
                {...form.register("folder")}
              />
              <datalist id={`${formId}-folder-options`}>
                {videoFolders.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
            </FormRow>
          ) : null}

          {selectedType === DownloadType.m3u8 ||
          selectedType === DownloadType.mediago ||
          isBatch ? (
            <FormRow
              htmlFor={`${formId}-headers`}
              label={t("additionalHeaders")}
            >
              <Textarea
                id={`${formId}-headers`}
                rows={4}
                placeholder="Origin: https://example.com"
                onContextMenu={onShowTextMenu}
                aria-describedby={`${formId}-headers-help`}
                {...form.register("headers")}
              />
              <p
                id={`${formId}-headers-help`}
                className="text-xs leading-relaxed text-muted-foreground"
              >
                {t("additionalHeadersHelp")}
              </p>
            </FormRow>
          ) : null}
        </div>
      </details>
    </>
  );
}
