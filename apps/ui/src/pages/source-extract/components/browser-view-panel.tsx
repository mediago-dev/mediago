import { useMemoizedFn } from "ahooks";
import {
  Container,
  LoaderCircle,
  PanelRightClose,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatSmartStreamVariant,
  selectableSmartStreamVariants,
} from "@/components/smart-stream-submit-logic";
import { appStoreSelector, useAppStore } from "@/store/app";
import {
  browserActionsSelector,
  browserSourcesSelector,
  type SourceData,
  useBrowserStore,
} from "@/store/browser";
import { usePlatform } from "@/hooks/use-platform";
import { createDownloadTasks } from "@/api/download-task";
import type { DownloadTask } from "@mediago/common";
import { filterSources } from "./source-filter";
import { sourceTypeLabel } from "./source-type-label";

interface SourceItemProps {
  item: SourceData;
  enableDocker: boolean;
  onDelete: (url: string) => void;
  onEdit: (items: SourceData[]) => void;
  onDownload: (item: SourceData) => void;
}

const SourceItem = memo(function SourceItem({
  item,
  enableDocker,
  onDelete,
  onEdit,
  onDownload,
}: SourceItemProps) {
  const { t } = useTranslation();
  const inspecting = item.mediaInfo?.status === "inspecting";
  const variants = useMemo(
    () =>
      selectableSmartStreamVariants({
        id: String(item.id),
        url: item.url,
        variants: item.mediaInfo?.variants,
      }),
    [item.id, item.mediaInfo?.variants, item.url],
  );
  const [selectedURL, setSelectedURL] = useState(item.url);

  useEffect(() => {
    setSelectedURL((current) =>
      current === item.url ||
      variants.some((variant) => variant.url === current)
        ? current
        : item.url,
    );
  }, [item.url, variants]);

  const selectedItem = useMemo(
    () => (selectedURL === item.url ? item : { ...item, url: selectedURL }),
    [item, selectedURL],
  );
  const selectedVariant = variants.find(
    (variant) => variant.url === selectedURL,
  );
  const selectedQuality =
    selectedVariant?.quality?.trim() ||
    (selectedVariant?.height ? `${selectedVariant.height}p` : undefined);

  return (
    <div className="flex flex-col gap-2 border-b px-1 py-3 last:border-b-0">
      <span
        className="block w-full truncate cursor-default text-sm text-foreground"
        title={item.name}
      >
        {item.name}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{sourceTypeLabel(item)}</Badge>
        {item.mediaInfo?.status === "inspecting" ? (
          <Badge variant="secondary">
            <LoaderCircle className="animate-spin" />
            {t("hlsInspecting")}
          </Badge>
        ) : null}
        {item.mediaInfo?.status !== "inspecting" &&
        item.mediaInfo?.playlistType === "master" ? (
          <Badge variant="secondary">
            {selectedVariant
              ? selectedQuality || t("hlsQualityUnknown")
              : t("hlsAutoBest")}
          </Badge>
        ) : null}
        {item.mediaInfo?.status !== "inspecting" &&
        item.mediaInfo &&
        !selectedVariant ? (
          <Badge
            variant="outline"
            title={
              item.mediaInfo.maxQuality
                ? t("hlsHighestAvailable", {
                    quality: item.mediaInfo.maxQuality,
                  })
                : t("hlsQualityUnknown")
            }
          >
            {item.mediaInfo.maxQuality || t("hlsQualityUnknown")}
          </Badge>
        ) : null}
      </div>
      {variants.length > 0 ? (
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {t("streamQuality")}
          </span>
          <Select
            items={[
              {
                value: item.url,
                label: item.mediaInfo?.maxQuality
                  ? `${t("hlsAutoBest")} · ${t("hlsHighestAvailable", { quality: item.mediaInfo.maxQuality })}`
                  : t("hlsAutoBest"),
              },
              ...variants.map((variant) => ({
                value: variant.url,
                label:
                  formatSmartStreamVariant(variant) || t("hlsQualityUnknown"),
              })),
            ]}
            value={selectedURL}
            onValueChange={setSelectedURL}
          >
            <SelectTrigger
              size="sm"
              className="min-w-0 flex-1"
              aria-label={`${t("streamQuality")}: ${item.name}`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              alignItemWithTrigger={false}
              className="max-w-[min(520px,calc(100vw-3rem))]"
            >
              <SelectItem value={item.url}>
                {item.mediaInfo?.maxQuality
                  ? `${t("hlsAutoBest")} · ${t("hlsHighestAvailable", { quality: item.mediaInfo.maxQuality })}`
                  : t("hlsAutoBest")}
              </SelectItem>
              {variants.map((variant) => (
                <SelectItem key={variant.url} value={variant.url}>
                  {formatSmartStreamVariant(variant) || t("hlsQualityUnknown")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}
      <div className="flex flex-row items-center justify-between gap-3">
        <div className="flex flex-row items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-6 p-0 text-destructive hover:text-destructive"
            onClick={() => onDelete(item.url)}
            title={t("delete")}
            aria-label={t("delete")}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-6 p-0"
            title={t("edit")}
            aria-label={t("edit")}
            onClick={() => onEdit([selectedItem])}
          >
            <Pencil className="size-4" />
          </Button>
          {enableDocker ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-6 p-0"
              title={t("edit")}
              aria-label={t("edit")}
              onClick={() => onEdit([selectedItem])}
            >
              <Container className="size-4" />
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={inspecting}
          onClick={() => onDownload(selectedItem)}
        >
          {t("downloadNow")}
        </Button>
      </div>
    </div>
  );
});

export function BrowserViewPanel() {
  const { tabId, sources } = useBrowserStore(
    useShallow(browserSourcesSelector),
  );
  const { enableDocker } = useAppStore(useShallow(appStoreSelector));
  const { clearSources, deleteSource, setSourcePanelCollapsed } =
    useBrowserStore(useShallow(browserActionsSelector));
  const { t } = useTranslation();
  const { browser } = usePlatform();
  const [filterQuery, setFilterQuery] = useState("");
  const deferredFilterQuery = useDeferredValue(filterQuery);
  const filteredSources = useMemo(
    () => filterSources(sources, deferredFilterQuery),
    [deferredFilterQuery, sources],
  );

  useEffect(() => {
    setFilterQuery("");
  }, [tabId]);

  const handleClear = useMemoizedFn(() => {
    clearSources(tabId);
  });

  const handleCollapse = useMemoizedFn(() => {
    setSourcePanelCollapsed(true);
  });

  const handleEdit = useMemoizedFn((items: SourceData[]) => {
    browser.showDownloadDialog(tabId, items);
  });

  const handleDownloadNow = useMemoizedFn(async (item: SourceData) => {
    try {
      const downloadTask: Omit<DownloadTask, "id"> = {
        url: item.url,
        name: item.name,
        headers: item.headers,
        type: item.type,
        folder: "",
      };
      await createDownloadTasks([downloadTask], true);
      // Badge increments via the "download-create" SSE event (see
      // apps/ui/src/api/events.ts), so no local increase() call needed.
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  });

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="mx-3 flex shrink-0 items-center gap-2 border-b py-3">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={filterQuery}
            className="pl-8"
            placeholder={t("filterSources")}
            aria-label={t("filterSources")}
            onChange={(event) => setFilterQuery(event.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          onClick={handleClear}
        >
          {t("clear")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="size-6 p-0 text-muted-foreground hover:text-foreground"
          title={t("collapse")}
          aria-label={t("collapse")}
          onClick={handleCollapse}
        >
          <PanelRightClose />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {filteredSources.length > 0 ? (
          filteredSources.map((item) => (
            <SourceItem
              key={item.id}
              item={item}
              enableDocker={enableDocker}
              onDelete={(url) => deleteSource(tabId, url)}
              onEdit={handleEdit}
              onDownload={handleDownloadNow}
            />
          ))
        ) : (
          <p
            className="flex min-h-24 items-center justify-center px-4 text-center text-sm text-muted-foreground"
            role="status"
          >
            {t("noMatchingSources")}
          </p>
        )}
      </div>
    </div>
  );
}
