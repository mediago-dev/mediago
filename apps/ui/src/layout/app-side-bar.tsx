import { useMemoizedFn } from "ahooks";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadStoreSelector, useDownloadStore } from "@/store/download";
import { useUiStore } from "@/store/ui";
import { cn } from "@/utils";
import { useNavItems } from "./nav";

export function AppSideBar() {
  const { t } = useTranslation();
  const items = useNavItems();
  const collapsed = useUiStore((s) => s.sidebarCollapsed);
  const { count, clearCount } = useDownloadStore(
    useShallow(downloadStoreSelector),
  );
  const { maxRunner } = useAppStore(useShallow(appStoreSelector));

  // The sidebar only renders on tablet + desktop (mobile uses bottom nav),
  // so the hamburger's collapse flag drives the width at every width here.
  const expanded = !collapsed;
  const width = expanded ? 244 : 74;

  const onHome = useMemoizedFn(() => clearCount());

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 select-none flex-col gap-1 overflow-hidden border-r border-mg-line bg-mg-surface px-3 py-[14px] transition-[width] duration-200"
    >
      <nav className="flex flex-col gap-1">
        {items.map(({ key, to, label, Icon, active, showCount }) => (
          <Link
            key={key}
            to={to}
            title={label}
            onClick={key === "home" ? onHome : undefined}
            className={cn(
              "flex h-11 items-center gap-[13px] whitespace-nowrap rounded-[12px] px-3 text-[14px] font-semibold transition-colors",
              active
                ? "bg-mg-primary-weak text-mg-primary"
                : "text-mg-fg2 hover:bg-mg-surface2",
              !expanded && "justify-center px-0",
            )}
          >
            <Icon size={20} strokeWidth={2} className="shrink-0" />
            {expanded && <span className="flex-1">{label}</span>}
            {expanded && showCount && count > 0 && (
              <span
                className={cn(
                  "ml-auto min-w-5 rounded-[9px] px-[7px] py-[2px] text-center text-[11.5px] font-bold",
                  active
                    ? "bg-mg-primary text-white"
                    : "bg-mg-surface2 text-mg-fg3",
                )}
              >
                {count}
              </span>
            )}
          </Link>
        ))}
      </nav>

      <div className="flex-1" />

      {expanded && (
        <div className="mx-1 mb-1 mt-2 rounded-[14px] border border-mg-line bg-[linear-gradient(135deg,var(--mg-primary-weak),transparent)] p-[14px]">
          <div className="mb-[7px] flex items-center gap-2">
            <span className="size-2 rounded-full bg-[#10b981] shadow-[0_0_0_3px_rgba(16,185,129,.18)]" />
            <span className="text-[12.5px] font-bold text-mg-fg">
              {t("engineRunning")}
            </span>
          </div>
          <div className="text-[11.5px] leading-relaxed text-mg-fg2">
            {t("maxRunner")}: {maxRunner}
          </div>
        </div>
      )}
    </aside>
  );
}
