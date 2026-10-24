import type { DragEvent } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OUTPUT_FORMATS,
  QUALITY_OPTIONS,
  type ConversionOutputType,
  type StagedMediaFile,
} from "./converter-page-logic";
import { ConversionFilePicker } from "./converter-workbench";

interface ConversionSettingsDialogProps {
  open: boolean;
  files: StagedMediaFile[];
  isDragging: boolean;
  outputType: ConversionOutputType;
  outputFormat: string;
  quality: string;
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onBrowse: () => void;
  onDrop: (event: DragEvent<HTMLButtonElement>) => void;
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void;
  onDragLeave: (event: DragEvent<HTMLButtonElement>) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
  onOutputTypeChange: (type: ConversionOutputType) => void;
  onOutputFormatChange: (format: string) => void;
  onQualityChange: (quality: string) => void;
  onSubmit: (startImmediately: boolean) => void;
}

const OUTPUT_TYPES = ["video", "audio"] as const;

const QUALITY_LABEL_KEYS: Record<string, string> = {
  high: "conversionQualityHigh",
  medium: "conversionQualityMedium",
  low: "conversionQualityLow",
};

export function ConversionSettingsDialog({
  open,
  files,
  isDragging,
  outputType,
  outputFormat,
  quality,
  isSubmitting,
  onOpenChange,
  onBrowse,
  onDrop,
  onDragOver,
  onDragLeave,
  onRemove,
  onClear,
  onOutputTypeChange,
  onOutputFormatChange,
  onQualityChange,
  onSubmit,
}: ConversionSettingsDialogProps) {
  const { t } = useTranslation();
  const hasFiles = files.length > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isSubmitting) onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        className="grid max-h-[calc(100vh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[680px]"
        showCloseButton={!isSubmitting}
      >
        <DialogHeader className="px-6 pb-4 pt-6">
          <DialogTitle>{t("createConversionTask")}</DialogTitle>
          <DialogDescription>{t("createConversionTaskHint")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 overflow-y-auto px-6 pb-5">
          <ConversionFilePicker
            files={files}
            isDragging={isDragging}
            disabled={isSubmitting}
            onBrowse={onBrowse}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onRemove={onRemove}
            onClear={onClear}
          />

          <div className="grid gap-3 border-t pt-4">
            <div className="text-sm font-semibold text-foreground">
              {t("conversionSettings")}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="grid gap-2">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="conversion-output-type"
                >
                  {t("outputType")}
                </label>
                <Select
                  value={outputType}
                  items={OUTPUT_TYPES.map((type) => ({
                    value: type,
                    label: t(type === "video" ? "videoOutput" : "audioOutput"),
                  }))}
                  disabled={isSubmitting}
                  onValueChange={(value) =>
                    onOutputTypeChange(value as ConversionOutputType)
                  }
                >
                  <SelectTrigger
                    id="conversion-output-type"
                    className="w-full bg-surface-raised"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTPUT_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {t(type === "video" ? "videoOutput" : "audioOutput")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="conversion-output-format"
                >
                  {t("outputFormat")}
                </label>
                <Select
                  value={outputFormat}
                  items={OUTPUT_FORMATS[outputType].map((format) => ({
                    value: format,
                    label: format,
                  }))}
                  disabled={isSubmitting}
                  onValueChange={onOutputFormatChange}
                >
                  <SelectTrigger
                    id="conversion-output-format"
                    className="w-full bg-surface-raised uppercase"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTPUT_FORMATS[outputType].map((format) => (
                      <SelectItem
                        key={format}
                        value={format}
                        className="uppercase"
                      >
                        {format}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <label
                  className="text-sm font-medium text-foreground"
                  htmlFor="conversion-quality"
                >
                  {t("quality")}
                </label>
                <Select
                  value={quality}
                  items={QUALITY_OPTIONS.map((option) => ({
                    value: option,
                    label: t(QUALITY_LABEL_KEYS[option]),
                  }))}
                  disabled={isSubmitting}
                  onValueChange={onQualityChange}
                >
                  <SelectTrigger
                    id="conversion-quality"
                    className="w-full bg-surface-raised"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {QUALITY_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {t(QUALITY_LABEL_KEYS[option])}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={!hasFiles || isSubmitting}
            onClick={() => onSubmit(false)}
          >
            {t("addSelectedToQueue")}
          </Button>
          <Button
            type="button"
            disabled={!hasFiles || isSubmitting}
            aria-busy={isSubmitting}
            onClick={() => onSubmit(true)}
          >
            {isSubmitting
              ? t("addingConversionTasks")
              : t("startSelectedConversions", { count: files.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
