import { DownloadFilter } from "@mediago/shared-common";
import { Check, Play, ScrollText, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MgButton, MgIconButton } from "@/components/mg";
import { cn } from "@/utils";

interface Props {
  anySelected: boolean;
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onBatchStart: () => void;
  onBatchDelete: () => void;
  onToggleLog: () => void;
  logOpen: boolean;
  filter: DownloadFilter;
}

export function ListHeader({
  anySelected,
  selectedCount,
  totalCount,
  onSelectAll,
  onBatchStart,
  onBatchDelete,
  onToggleLog,
  logOpen,
  filter,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-mg-line bg-mg-surface p-[10px_12px]">
      <button
        type="button"
        onClick={onSelectAll}
        className="flex h-[34px] items-center gap-2 rounded-[9px] border border-mg-line bg-mg-surface2 px-3 text-[12.5px] font-semibold text-mg-fg"
      >
        <span
          className={cn(
            "flex size-[17px] items-center justify-center rounded-[5px] border-2",
            anySelected ? "border-mg-primary bg-mg-primary" : "border-mg-line2",
          )}
        >
          {anySelected && <Check size={11} color="#fff" strokeWidth={3.5} />}
        </span>
        {t("selectAll")}
      </button>

      <span className="text-[12.5px] font-semibold text-mg-fg2">
        {t("selectedItems", { count: selectedCount })}
        {totalCount > 0 ? ` / ${totalCount}` : ""}
      </span>

      <div className="flex-1" />

      {filter === DownloadFilter.list && (
        <MgButton
          variant="surface"
          size="sm"
          disabled={!anySelected}
          onClick={onBatchStart}
          className={cn(anySelected && "border-mg-primary text-mg-primary")}
        >
          <Play size={14} strokeWidth={2.2} fill="currentColor" />
          {t("batchStart")}
        </MgButton>
      )}

      <MgButton
        variant="surface"
        size="sm"
        disabled={!anySelected}
        onClick={onBatchDelete}
        className={cn(anySelected && "border-[#f43f5e] text-[#f43f5e]")}
      >
        <Trash2 size={14} strokeWidth={2.2} />
        {t("delete")}
      </MgButton>

      <MgIconButton
        variant="surface"
        size="sm"
        title="log"
        onClick={onToggleLog}
        className={cn(logOpen && "border-mg-primary text-mg-primary")}
      >
        <ScrollText size={15} strokeWidth={2} />
      </MgIconButton>
    </div>
  );
}
