import { ArrowDownToLine, RotateCw, SquareCheck, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { useUiStore } from "@/store/ui";
import { cn } from "@/utils";

interface Props {
  onSelect: (id: number) => void;
  onDownload: (id: number) => void;
  onRefresh: () => void;
  onDelete: (id: number) => void;
}

/** Custom task right-click menu (design lines 498-513). State lives in useUiStore. */
export function TaskContextMenu({
  onSelect,
  onDownload,
  onRefresh,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const { ctx, closeContextMenu } = useUiStore(
    useShallow((s) => ({ ctx: s.ctx, closeContextMenu: s.closeContextMenu })),
  );

  if (!ctx.open || ctx.taskId === null || ctx.taskId === undefined) return null;
  const id = ctx.taskId;

  const run = (fn: () => void) => () => {
    fn();
    closeContextMenu();
  };

  const items = [
    {
      key: "select",
      label: t("select"),
      Icon: SquareCheck,
      danger: false,
      act: run(() => onSelect(id)),
    },
    {
      key: "download",
      label: t("download"),
      Icon: ArrowDownToLine,
      danger: false,
      act: run(() => onDownload(id)),
    },
    {
      key: "refresh",
      label: t("refresh"),
      Icon: RotateCw,
      danger: false,
      act: run(() => onRefresh()),
    },
    {
      key: "delete",
      label: t("delete"),
      Icon: Trash2,
      danger: true,
      act: run(() => onDelete(id)),
    },
  ];

  return (
    <div className="fixed inset-0 z-40" onClick={closeContextMenu}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ left: ctx.x, top: ctx.y }}
        className="absolute w-[182px] rounded-[13px] border border-mg-line bg-mg-surface p-1.5 shadow-[0_18px_50px_-12px_rgba(20,20,40,.4)] [animation:mgpop_.14s_ease]"
      >
        {items.map(({ key, label, Icon, danger, act }) => (
          <button
            key={key}
            type="button"
            onClick={act}
            className={cn(
              "flex h-[38px] w-full items-center gap-[11px] rounded-[9px] px-[11px] text-left text-[13px] font-semibold transition-colors hover:bg-mg-surface2",
              danger ? "text-[#f43f5e]" : "text-mg-fg",
            )}
          >
            <Icon size={16} strokeWidth={2.2} />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
