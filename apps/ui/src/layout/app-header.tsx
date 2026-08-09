import { AppLanguage, AppTheme } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { Globe, Menu, Moon, Sun } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import {
  appStoreSelector,
  setAppStoreSelector,
  useAppStore,
} from "@/store/app";
import { themeSelector, useSessionStore } from "@/store/session";
import { useUiStore } from "@/store/ui";
import { cn, resolveAppLanguage } from "@/utils";
import { MgIconButton } from "@/components/mg";

interface Props {
  className?: string;
}

export function AppHeader({ className }: Props) {
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);
  const { language, theme: _appTheme } = useAppStore(
    useShallow(appStoreSelector),
  );
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { theme } = useSessionStore(useShallow(themeSelector));

  const lang = resolveAppLanguage(language);
  const isDark = theme === "dark";
  const langLabel = lang === "zh" ? "中文" : lang.toUpperCase();

  // Hamburger only exists on tablet/desktop (mobile uses the bottom nav),
  // so it always toggles the sidebar.
  const onMenu = useMemoizedFn(() => toggleSidebar());
  const toggleLang = useMemoizedFn(() =>
    setAppStore({ language: lang === "zh" ? AppLanguage.EN : AppLanguage.ZH }),
  );
  const toggleTheme = useMemoizedFn(() =>
    setAppStore({ theme: isDark ? AppTheme.Light : AppTheme.Dark }),
  );

  return (
    <header
      className={cn(
        "z-20 flex h-[60px] shrink-0 select-none items-center gap-[14px] border-b border-mg-line bg-mg-surface px-[18px]",
        className,
      )}
    >
      {!isMobile && (
        <MgIconButton variant="ghost" size="lg" title="menu" onClick={onMenu}>
          <Menu size={20} strokeWidth={2.2} />
        </MgIconButton>
      )}

      <div className="flex items-center gap-[11px]">
        <div className="size-[34px] overflow-hidden rounded-[10px] shadow-[0_4px_12px_-2px_rgba(91,91,245,.5)]">
          <svg
            viewBox="0 0 1024 1024"
            className="size-full"
            aria-label="MediaGo"
          >
            <defs>
              <linearGradient id="mgLogo" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#5b5bf5" />
                <stop offset="1" stopColor="#9b6bff" />
              </linearGradient>
            </defs>
            <rect width="1024" height="1024" fill="url(#mgLogo)" />
            <rect
              x="304"
              y="406"
              width="40"
              height="212"
              rx="20"
              fill="#c9b8ff"
              opacity="0.3"
            />
            <rect
              x="378"
              y="374"
              width="48"
              height="276"
              rx="24"
              fill="#c9b8ff"
              opacity="0.6"
            />
            <path
              d="M470 348 Q470 322 493 336 L744 494 Q768 510 744 526 L493 688 Q470 702 470 676 Z"
              fill="#ffffff"
            />
          </svg>
        </div>
        <span className="text-[16px] font-extrabold leading-none tracking-[-0.02em] text-mg-fg">
          MediaGo
        </span>
      </div>

      <div className="flex-1" />

      <button
        type="button"
        onClick={toggleLang}
        className="flex h-9 cursor-pointer items-center gap-[7px] rounded-[10px] border border-mg-line bg-mg-surface px-3 text-[12.5px] font-semibold text-mg-fg2 transition-colors hover:border-mg-line2 hover:text-mg-fg"
      >
        <Globe size={16} strokeWidth={2} />
        <span>{langLabel}</span>
      </button>

      <MgIconButton
        variant="surface"
        size="md"
        title="theme"
        onClick={toggleTheme}
      >
        {isDark ? (
          <Sun size={17} strokeWidth={2} />
        ) : (
          <Moon size={17} strokeWidth={2} />
        )}
      </MgIconButton>

      <div className="h-6 w-px bg-mg-line" />

      <button
        type="button"
        title="account"
        onClick={() => navigate("/signin")}
        className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-[linear-gradient(135deg,#ff8a5b,#ff5b9b)] text-[13px] font-bold text-white"
      >
        M
      </button>
    </header>
  );
}
