import { useMemoizedFn } from "ahooks";
import {
  ArrowLeft,
  ArrowRight,
  Combine,
  EyeOff,
  House,
  PanelRightOpen,
  RefreshCw,
  Smartphone,
  Star,
  X,
} from "lucide-react";
import { type KeyboardEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useShallow } from "zustand/react/shallow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { appStoreSelector, useAppStore } from "@/store/app";
import {
  BrowserStatus,
  browserNavSelector,
  browserSourcePanelSelector,
  PageMode,
  browserActionsSelector,
  useBrowserStore,
} from "@/store/browser";
import { cn } from "@/utils";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { useFavorites } from "@/hooks/use-favorites";
import { usePlatform } from "@/hooks/use-platform";

interface Props {
  page: boolean;
}

export function ToolBar({ page }: Props) {
  const { data: favoriteList, addFavorite, removeFavorite } = useFavorites();
  const { browser, app, contextMenu } = usePlatform();
  const { goBack, goHome, goto, reload } = useBrowserActions();
  const store = useBrowserStore(useShallow(browserNavSelector));
  const { sourceCount, sourcePanelCollapsed } = useBrowserStore(
    useShallow(browserSourcePanelSelector),
  );
  const { setSourcePanelCollapsed, updateTab } = useBrowserStore(
    useShallow(browserActionsSelector),
  );
  const appStore = useAppStore(useShallow(appStoreSelector));
  const [switchingDeviceMode, setSwitchingDeviceMode] = useState(false);
  const { t } = useTranslation();

  const disabled =
    store.status !== BrowserStatus.Loaded || store.mode !== PageMode.Browser;

  const onToggleDeviceMode = useMemoizedFn(async () => {
    if (switchingDeviceMode) return;
    setSwitchingDeviceMode(true);
    try {
      await browser.setDeviceMode(store.tabId, !store.isMobile);
    } catch {
      toast.error(t("switchDeviceModeFailed"));
    } finally {
      setSwitchingDeviceMode(false);
    }
  });

  const curIsFavorite = useMemo(() => {
    return favoriteList.find((item) => item.url === store.url);
  }, [favoriteList, store.url]);

  const onInputKeyDown = useMemoizedFn(
    async (e: KeyboardEvent<HTMLInputElement>) => {
      if (!store.url || e.key !== "Enter") return;
      goto(store.url);
    },
  );

  const onClickGoBack = useMemoizedFn(async () => {
    await goBack(store.tabId);
  });

  const onInputContextMenu = useMemoizedFn(() => {
    contextMenu.show([
      { key: "copy", label: t("copy"), role: "copy" },
      { key: "paste", label: t("paste"), role: "paste" },
    ]);
  });

  const onClickEnter = useMemoizedFn(() => {
    if (!store.url) return;
    goto(store.url);
  });

  const onClickAddFavorite = useMemoizedFn(async () => {
    if (curIsFavorite) {
      await removeFavorite(curIsFavorite.id);
    } else {
      await addFavorite({
        url: store.url,
        title: store.title || store.url,
      });
    }
  });

  const onCombineToHome = useMemoizedFn(() => {
    app.combineToHomePage();
  });

  const onExpandSourcePanel = useMemoizedFn(() => {
    setSourcePanelCollapsed(false);
  });

  const expandSourcePanelLabel = `${t("expand")} · ${t("sniffedResourceCount", {
    count: sourceCount,
  })}`;

  return (
    <div className="flex h-11 shrink-0 flex-row items-center gap-2 border-b bg-surface px-3">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "text-muted-foreground hover:text-foreground",
          store.isMobile &&
            "bg-surface-selected text-brand hover:bg-surface-selected hover:text-brand",
          switchingDeviceMode && "cursor-progress",
        )}
        title={store.isMobile ? t("disableMobileMode") : t("enableMobileMode")}
        aria-label={
          store.isMobile ? t("disableMobileMode") : t("enableMobileMode")
        }
        aria-pressed={store.isMobile}
        disabled={switchingDeviceMode}
        onClick={onToggleDeviceMode}
      >
        <Smartphone />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        disabled={disabled}
        title={t("home")}
        aria-label={t("home")}
        onClick={() => goHome(store.tabId)}
      >
        <House />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        disabled={store.mode === PageMode.Default}
        title={t("back")}
        aria-label={t("back")}
        onClick={onClickGoBack}
      >
        <ArrowLeft />
      </Button>
      {store.mode === PageMode.Browser &&
      store.status === BrowserStatus.Loading ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title={t("cancle")}
          aria-label={t("cancle")}
          onClick={() => goHome(store.tabId)}
        >
          <X />
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          disabled={disabled}
          title={t("refresh")}
          aria-label={t("refresh")}
          onClick={() => reload(store.tabId)}
        >
          <RefreshCw />
        </Button>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        title={curIsFavorite ? t("cancelFavorite") : t("favorite")}
        aria-label={curIsFavorite ? t("cancelFavorite") : t("favorite")}
        onClick={onClickAddFavorite}
        disabled={disabled}
      >
        <Star className={cn(curIsFavorite && "fill-current")} />
      </Button>
      <div className="relative min-w-0 flex-1">
        {appStore.privacy ? (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("privacy")}
                    className="absolute left-3 top-1/2 z-10 flex -translate-y-1/2 cursor-pointer items-center rounded-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  />
                }
              >
                <EyeOff className="size-4" />
              </TooltipTrigger>
              <TooltipContent side="top">{t("privacy")}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ) : null}
        <Input
          key="url-input"
          className={cn("h-8", { "pl-9": appStore.privacy })}
          value={store.url}
          onChange={(e) => {
            const url = e.target.value;
            updateTab(store.tabId, { url });
          }}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
          onKeyDown={onInputKeyDown}
          onContextMenu={onInputContextMenu}
          placeholder={t("pleaseEnterUrl")}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:text-foreground"
        title={t("visit")}
        aria-label={t("visit")}
        onClick={onClickEnter}
        disabled={!store.url}
      >
        <ArrowRight />
      </Button>
      {sourcePanelCollapsed && sourceCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="relative overflow-visible text-muted-foreground hover:text-foreground"
          title={expandSourcePanelLabel}
          aria-label={expandSourcePanelLabel}
          onClick={onExpandSourcePanel}
        >
          <PanelRightOpen />
          <Badge
            variant="destructive"
            className="pointer-events-none absolute -right-1 -top-1 h-4 min-w-4 px-1 text-[10px] leading-none tabular-nums shadow-sm"
          >
            {sourceCount > 99 ? "99+" : sourceCount}
          </Badge>
        </Button>
      ) : null}
      {page ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-foreground"
          title={t("mergeToMainWindow")}
          aria-label={t("mergeToMainWindow")}
          onClick={onCombineToHome}
        >
          <Combine />
        </Button>
      ) : null}
    </div>
  );
}
