import { useMemoizedFn } from "ahooks";
import { App } from "antd";
import { DownloadType, type DownloadTask } from "@mediago/shared-common";
import { Container, Download, Pencil, Radio, Trash2 } from "lucide-react";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { MgButton, MgPill } from "@/components/mg";
import { appStoreSelector, useAppStore } from "@/store/app";
import {
  browserSourcesSelector,
  type SourceData,
  setBrowserSelector,
  useBrowserStore,
} from "@/store/browser";
import { usePlatform } from "@/hooks/use-platform";
import { createDownloadTasks } from "@/api/download-task";

/** Short type tag + color, mirroring the redesign's HLS-blue / MP4-green split. */
const TYPE_META: Record<string, { label: string; color: string; bg: string }> =
  {
    [DownloadType.m3u8]: {
      label: "HLS",
      color: "#3b82f6",
      bg: "rgba(59,130,246,.13)",
    },
    [DownloadType.bilibili]: {
      label: "B站",
      color: "#fb7299",
      bg: "rgba(251,114,153,.13)",
    },
    [DownloadType.youtube]: {
      label: "YT",
      color: "#f43f5e",
      bg: "rgba(244,63,94,.13)",
    },
    [DownloadType.direct]: {
      label: "MP4",
      color: "#10b981",
      bg: "rgba(16,185,129,.13)",
    },
    [DownloadType.mediago]: {
      label: "MG",
      color: "#8b5cf6",
      bg: "rgba(139,92,246,.13)",
    },
  };

function typeMeta(type: DownloadType) {
  return (
    TYPE_META[type] ?? {
      label: String(type).toUpperCase(),
      color: "#10b981",
      bg: "rgba(16,185,129,.13)",
    }
  );
}

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
  const meta = typeMeta(item.type);

  return (
    <div className="rounded-[13px] border border-mg-line bg-mg-surface2 p-[12px_13px]">
      <div className="mb-[7px] flex items-center gap-2">
        <MgPill color={meta.color} bg={meta.bg} className="text-[10px]">
          {meta.label}
        </MgPill>
        <span
          className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-mg-fg"
          title={item.name}
        >
          {item.name}
        </span>
      </div>
      <div
        className="mb-[10px] truncate font-mono text-[10.5px] text-mg-fg3"
        title={item.url}
      >
        {item.url}
      </div>
      <div className="flex items-center gap-[10px]">
        <div className="flex-1" />
        <button
          type="button"
          title={t("delete")}
          onClick={() => onDelete(item.url)}
          className="flex size-[30px] cursor-pointer items-center justify-center rounded-lg border border-mg-line bg-mg-surface text-mg-fg2 transition-colors hover:text-[#f43f5e]"
        >
          <Trash2 size={13} strokeWidth={2} />
        </button>
        {enableDocker && (
          <button
            type="button"
            title={t("edit")}
            onClick={() => onEdit([item])}
            className="flex size-[30px] cursor-pointer items-center justify-center rounded-lg border border-mg-line bg-mg-surface text-mg-fg2 transition-colors hover:text-mg-fg"
          >
            <Container size={13} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          title={t("edit")}
          onClick={() => onEdit([item])}
          className="flex size-[30px] cursor-pointer items-center justify-center rounded-lg border border-mg-line bg-mg-surface text-mg-fg2 transition-colors hover:text-mg-fg"
        >
          <Pencil size={13} strokeWidth={2} />
        </button>
        <MgButton
          variant="primary"
          size="sm"
          className="h-[30px] rounded-lg px-3 text-[11.5px]"
          onClick={() => onDownload(item)}
        >
          <Download size={13} strokeWidth={2.4} />
          {t("download")}
        </MgButton>
      </div>
    </div>
  );
});

export function BrowserViewPanel() {
  const { sources } = useBrowserStore(useShallow(browserSourcesSelector));
  const { enableDocker } = useAppStore(useShallow(appStoreSelector));
  const { deleteSource, clearSources } = useBrowserStore(
    useShallow(setBrowserSelector),
  );
  const { t } = useTranslation();
  const { browser } = usePlatform();
  const { message } = App.useApp();

  const handleClear = useMemoizedFn(() => {
    clearSources();
  });

  const handleEdit = useMemoizedFn((items: SourceData[]) => {
    browser.showDownloadDialog(items);
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
      message.error((e as Error).message);
    }
  });

  return (
    <div className="flex h-full flex-col bg-mg-surface">
      {/* sniffer header */}
      <div className="flex flex-none items-center gap-[9px] border-b border-mg-line p-[14px_16px]">
        <span className="size-[9px] rounded-full bg-[#10b981] shadow-[0_0_0_3px_rgba(16,185,129,.18)]" />
        <span className="flex items-center gap-[7px] text-[13.5px] font-extrabold text-mg-fg">
          <Radio size={15} strokeWidth={2} className="text-mg-fg2" />
          {t("materialExtraction")}
        </span>
        <MgPill
          color="var(--mg-primary)"
          bg="var(--mg-primary-weak)"
          className="text-[11px]"
        >
          {sources.length}
        </MgPill>
        <div className="flex-1" />
        <button
          type="button"
          title={t("clear")}
          onClick={handleClear}
          className="flex h-[30px] cursor-pointer items-center rounded-lg border border-mg-line bg-transparent px-[11px] text-[11.5px] font-semibold text-mg-fg3 transition-colors hover:text-mg-fg2"
        >
          {t("clear")}
        </button>
      </div>

      {/* resource list */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-[10px]">
        {sources.map((item) => (
          <SourceItem
            key={item.id}
            item={item}
            enableDocker={enableDocker}
            onDelete={deleteSource}
            onEdit={handleEdit}
            onDownload={handleDownloadNow}
          />
        ))}
      </div>
    </div>
  );
}
