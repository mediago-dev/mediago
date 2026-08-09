import { useAsyncEffect } from "ahooks";
import { Plus } from "lucide-react";
import { type FC, useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { getConfig } from "@/api/config";
import { DownloadModal } from "@/components/download-modal";
import { CHANGE_PAGE } from "@/const";
import { useBreakpoint } from "@/hooks/use-breakpoint";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import { useUiStore } from "@/store/ui";
import { cn, tdApp } from "@/utils";
import { AppBottomNav } from "./app-bottom-nav";
import { AppHeader } from "./app-header";
import { AppSideBar } from "./app-side-bar";

const AppLayout: FC = () => {
  const location = useLocation();
  const { isMobile } = useBreakpoint();
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const openNewDownload = useUiStore((s) => s.openNewDownload);

  useAsyncEffect(async () => {
    try {
      const configData = await getConfig();
      setAppStore(configData as Record<string, unknown>);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    tdApp.onEvent(CHANGE_PAGE, { page: location.pathname });
  }, [location.pathname]);

  // FAB shows on the list views only; fade/scale (not mount/unmount) so it
  // doesn't pop a box in/out when switching the bottom nav.
  const onListView = location.pathname === "/" || location.pathname === "/done";

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-mg-bg text-mg-fg">
      <AppHeader />
      <div className="flex min-h-0 flex-1">
        {!isMobile && <AppSideBar />}
        <main className="relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Outlet />
        </main>
      </div>
      {isMobile && <AppBottomNav />}

      {isMobile && (
        <button
          type="button"
          title="new download"
          onClick={openNewDownload}
          className={cn(
            "fixed bottom-20 right-[18px] z-30 flex size-14 items-center justify-center rounded-[18px] bg-mg-primary text-white shadow-[0_10px_26px_-8px_rgba(91,91,245,.7)] transition-[opacity,transform] duration-200",
            onListView
              ? "scale-100 opacity-100"
              : "pointer-events-none scale-90 opacity-0",
          )}
        >
          <Plus size={26} strokeWidth={2.6} />
        </button>
      )}

      <DownloadModal />
    </div>
  );
};

export default AppLayout;
