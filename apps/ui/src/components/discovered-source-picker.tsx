import { AlertTriangle, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  formatSmartStreamVariant,
  selectableSmartStreamVariants,
  type PreparedSmartStreamSource,
} from "./smart-stream-submit-logic";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";

export function defaultSelectedSourceIds(
  sources: readonly PreparedSmartStreamSource[],
): string[] {
  return sources
    .filter((source) => source.available)
    .map((source) => source.id);
}

export function defaultSelectedVariantUrls(
  sources: readonly PreparedSmartStreamSource[],
): Record<string, string> {
  return Object.fromEntries(
    sources
      .filter((source) => selectableSmartStreamVariants(source).length > 0)
      .map((source) => [source.id, source.url]),
  );
}

interface DiscoveredSourcePickerProps {
  busy: boolean;
  onCancel: () => void;
  onConfirm: (
    sourceIds: string[],
    names: Record<string, string>,
    variantUrls: Record<string, string>,
  ) => void;
  open: boolean;
  partial: boolean;
  sources: PreparedSmartStreamSource[];
}

export function DiscoveredSourcePicker({
  busy,
  onCancel,
  onConfirm,
  open,
  partial,
  sources,
}: DiscoveredSourcePickerProps) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [variantUrls, setVariantUrls] = useState<Record<string, string>>({});
  const hasInvalidName = selected.some(
    (sourceId) => !(names[sourceId] ?? "").trim(),
  );

  useEffect(() => {
    if (!open) return;
    setSelected(defaultSelectedSourceIds(sources));
    setNames(
      Object.fromEntries(sources.map((source) => [source.id, source.name])),
    );
    setVariantUrls(defaultSelectedVariantUrls(sources));
  }, [open, sources]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !busy) onCancel();
      }}
    >
      <DialogContent className="grid max-h-[min(720px,calc(100vh-2rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-[620px]">
        <DialogHeader className="border-b px-6 py-4 pr-14">
          <DialogTitle>{t("selectDiscoveredSources")}</DialogTitle>
          <DialogDescription>
            {t("selectDiscoveredSourcesDescription")}
          </DialogDescription>
          {partial ? (
            <p
              className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400"
              role="status"
            >
              <AlertTriangle className="size-3.5" />
              {t("discoveryPartialResults")}
            </p>
          ) : null}
        </DialogHeader>
        <div className="min-h-0 space-y-2 overflow-y-auto px-6 py-4">
          {sources.map((source) => {
            const checked = selected.includes(source.id);
            const variants = selectableSmartStreamVariants(source);
            return (
              <div
                key={source.id}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border bg-surface-subtle/40 p-3"
              >
                <Checkbox
                  aria-label={source.title || source.url}
                  checked={checked}
                  disabled={!source.available || busy}
                  onCheckedChange={(nextChecked) => {
                    setSelected((current) =>
                      nextChecked
                        ? [...new Set([...current, source.id])]
                        : current.filter((id) => id !== source.id),
                    );
                  }}
                />
                <div className="min-w-0 space-y-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <Radio className="size-3.5 shrink-0 text-muted-foreground" />
                    <span
                      className="truncate text-xs text-muted-foreground"
                      title={source.url}
                    >
                      {source.url}
                    </span>
                    {!source.available ? (
                      <Badge variant="outline">
                        {t("downloadAlreadyExists")}
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="w-12 shrink-0 text-xs text-muted-foreground">
                      {t("streamQuality")}
                    </span>
                    {variants.length > 0 ? (
                      <Select
                        items={[
                          {
                            value: source.url,
                            label: source.quality
                              ? `${t("hlsAutoBest")} · ${t("hlsHighestAvailable", { quality: source.quality })}`
                              : t("hlsAutoBest"),
                          },
                          ...variants.map((variant) => ({
                            value: variant.url,
                            label:
                              formatSmartStreamVariant(variant) ||
                              t("hlsQualityUnknown"),
                          })),
                        ]}
                        value={variantUrls[source.id] ?? source.url}
                        disabled={!source.available || !checked || busy}
                        onValueChange={(url) =>
                          setVariantUrls((current) => ({
                            ...current,
                            [source.id]: url,
                          }))
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="min-w-0 flex-1"
                          aria-label={`${t("streamQuality")}: ${source.title || source.url}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent
                          alignItemWithTrigger={false}
                          className="max-w-[min(520px,calc(100vw-3rem))]"
                        >
                          <SelectItem value={source.url}>
                            {source.quality
                              ? `${t("hlsAutoBest")} \u00b7 ${t("hlsHighestAvailable", { quality: source.quality })}`
                              : t("hlsAutoBest")}
                          </SelectItem>
                          {variants.map((variant) => (
                            <SelectItem key={variant.url} value={variant.url}>
                              {formatSmartStreamVariant(variant) ||
                                t("hlsQualityUnknown")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="outline">
                        {source.quality || t("hlsQualityUnknown")}
                      </Badge>
                    )}
                  </div>
                  <Input
                    value={names[source.id] ?? source.name}
                    disabled={!source.available || busy}
                    aria-label={t("videoName")}
                    onChange={(event) =>
                      setNames((current) => ({
                        ...current,
                        [source.id]: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
        <DialogFooter className="border-t bg-surface-subtle/60 px-6 py-4">
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={onCancel}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={busy || selected.length === 0 || hasInvalidName}
            onClick={() => onConfirm(selected, names, variantUrls)}
          >
            {busy ? t("creatingDownloadTasks") : t("confirmDownloadSources")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
