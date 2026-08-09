import { useMemoizedFn } from "ahooks";
import { Input, Tooltip } from "antd";
import {
  ChevronLeft,
  EyeOff,
  House,
  Lock,
  Monitor,
  RotateCw,
  Send,
  Share2,
  Smartphone,
  Star,
  X,
} from "lucide-react";
import { type KeyboardEvent, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { MgIconButton } from "@/components/mg";
import {
  appStoreSelector,
  setAppStoreSelector,
  useAppStore,
} from "@/store/app";
import {
  BrowserStatus,
  browserNavSelector,
  PageMode,
  setBrowserSelector,
  useBrowserStore,
} from "@/store/browser";
import { cn, getFavIcon } from "@/utils";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { useFavorites } from "@/hooks/use-favorites";
import { usePlatform } from "@/hooks/use-platform";

interface Props {
  page: boolean;
}

export function ToolBar({ page }: Props) {
  const { data: favoriteList, addFavorite, removeFavorite } = useFavorites();
  const { browser, app, contextMenu } = usePlatform();
  const { goto, goHome } = useBrowserActions();
  const store = useBrowserStore(useShallow(browserNavSelector));
  const { setBrowserStore } = useBrowserStore(useShallow(setBrowserSelector));
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const { t } = useTranslation();

  const disabled =
    store.status !== BrowserStatus.Loaded || store.mode !== PageMode.Browser;
  const isLoading =
    store.mode === PageMode.Browser && store.status === BrowserStatus.Loading;

  // Set default UA
  const onSetDefaultUA = useMemoizedFn(() => {
    const nextMode = !appStore.isMobile;
    browser.setUserAgent(nextMode);
    setAppStore({
      isMobile: nextMode,
    });
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
    const back = await browser.back();
    if (!back) {
      setBrowserStore({ url: "", title: "", mode: PageMode.Default });
    }
  });

  const onInputContextMenu = useMemoizedFn(() => {
    contextMenu.show([
      { key: "copy", label: t("copy") },
      { key: "paste", label: t("paste") },
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
      const icon = getFavIcon(store.url);
      await addFavorite({
        url: store.url,
        title: store.title || store.url,
        icon,
      });
    }
  });

  const onCombineToHome = useMemoizedFn(() => {
    app.combineToHomePage({
      url: store.url,
      sourceList: [],
    });
  });

  // UA toggle label. `mobile`/`desktop` are not yet in the i18n resources,
  // so we render with a default value until the keys are added.
  const uaLabel = appStore.isMobile
    ? t("mobile", { defaultValue: "手机" })
    : t("desktop", { defaultValue: "桌面" });

  return (
    <div
      className={cn(
        "flex flex-none flex-wrap items-center gap-2 border-b border-mg-line bg-mg-surface px-[clamp(14px,2vw,22px)] py-[13px]",
        { "rounded-lg": !page },
      )}
    >
      {/* nav button group */}
      <div className="flex gap-[3px]">
        <MgIconButton
          variant="soft"
          size="lg"
          title={t("back")}
          disabled={store.mode === PageMode.Default}
          onClick={onClickGoBack}
        >
          <ChevronLeft size={17} strokeWidth={2.2} />
        </MgIconButton>
        {isLoading ? (
          <MgIconButton
            variant="soft"
            size="lg"
            title={t("cancle")}
            onClick={goHome}
          >
            <X size={16} strokeWidth={2.2} />
          </MgIconButton>
        ) : (
          <MgIconButton
            variant="soft"
            size="lg"
            title={t("refresh")}
            disabled={disabled}
            onClick={() => goto(store.url)}
          >
            <RotateCw size={16} strokeWidth={2.2} />
          </MgIconButton>
        )}
        <MgIconButton
          variant="soft"
          size="lg"
          title={t("home")}
          disabled={disabled}
          onClick={goHome}
        >
          <House size={16} strokeWidth={2.2} />
        </MgIconButton>
      </div>

      {/* address bar */}
      <div className="flex h-[38px] min-w-[180px] flex-1 items-center gap-[9px] rounded-[11px] border-[1.5px] border-mg-line bg-mg-surface2 px-[13px]">
        <Lock size={14} strokeWidth={2.2} className="shrink-0 text-[#10b981]" />
        <Input
          key="url-input"
          variant="borderless"
          value={store.url}
          onChange={(e) => {
            const url = e.target.value;
            setBrowserStore({ url });
          }}
          onFocus={(e) => {
            e.target.select();
          }}
          onKeyDown={onInputKeyDown}
          onContextMenu={onInputContextMenu}
          placeholder={t("pleaseEnterUrl")}
          className="min-w-0 flex-1 !bg-transparent !px-0 font-mono !text-[12.5px] !text-mg-fg"
          prefix={
            appStore.privacy ? (
              <Tooltip placement="top" title={t("privacy")}>
                <EyeOff size={14} className="text-mg-fg3" />
              </Tooltip>
            ) : undefined
          }
          suffix={
            <button
              type="button"
              title={t("visit")}
              disabled={!store.url}
              onClick={onClickEnter}
              className="flex cursor-pointer items-center justify-center text-mg-fg3 transition-colors hover:text-mg-primary disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send size={14} strokeWidth={2.2} />
            </button>
          }
        />
      </div>

      {/* UA toggle pill */}
      <button
        type="button"
        title={t("switchToMobileMode")}
        onClick={onSetDefaultUA}
        className="flex h-[38px] cursor-pointer items-center gap-[7px] rounded-[11px] border border-mg-line bg-mg-surface px-[13px] text-[12.5px] font-semibold text-mg-fg2 transition-colors hover:text-mg-fg"
      >
        {appStore.isMobile ? (
          <Smartphone size={15} strokeWidth={2} />
        ) : (
          <Monitor size={15} strokeWidth={2} />
        )}
        {uaLabel}
      </button>

      {/* bookmark */}
      <button
        type="button"
        title={curIsFavorite ? t("cancelFavorite") : t("favorite")}
        onClick={onClickAddFavorite}
        disabled={disabled}
        className="flex size-[38px] cursor-pointer items-center justify-center rounded-[11px] border border-mg-line bg-mg-surface text-[#f59e0b] transition-[border-color,filter] hover:border-mg-line2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Star
          size={17}
          strokeWidth={1.5}
          fill={curIsFavorite ? "#f59e0b" : "none"}
        />
      </button>

      {page && (
        <button
          type="button"
          title={t("mergeToMainWindow")}
          onClick={onCombineToHome}
          className="flex size-[38px] cursor-pointer items-center justify-center rounded-[11px] border border-mg-line bg-mg-surface text-mg-fg2 transition-colors hover:text-mg-fg"
        >
          <Share2 size={16} strokeWidth={2} className="rotate-180" />
        </button>
      )}
    </div>
  );
}
