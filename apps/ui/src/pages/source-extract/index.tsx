import { useAsyncEffect, useMemoizedFn } from "ahooks";
import { type FC, useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import PageContainer from "@/components/page-container";
import { setAppStoreSelector, useAppStore } from "@/store/app";
import {
  BrowserStatus,
  PageMode,
  setBrowserSelector,
  useBrowserStore,
} from "@/store/browser";
import { cn } from "@/utils";
import { BrowserView } from "./components/browser-view";
import { FavoriteList } from "./components/favorite-list";
import { ToolBar } from "./components/tool-bar";
import { usePlatform } from "@/hooks/use-platform";
import { getConfig } from "@/api/config";

interface SourceExtractProps {
  page?: boolean;
}

const SourceExtract: FC<SourceExtractProps> = ({ page = false }) => {
  const { on, off, app } = usePlatform();
  const { setAppStore } = useAppStore(useShallow(setAppStoreSelector));
  const mode = useBrowserStore((s) => s.mode);
  const title = useBrowserStore((s) => s.title);
  const { setBrowserStore } = useBrowserStore(useShallow(setBrowserSelector));
  const originTitle = useRef(document.title);

  useEffect(() => {
    const unsubscribe = useBrowserStore.subscribe(
      (state) => ({
        url: state.url,
        title: state.title,
        mode: state.mode,
        status: state.status,
      }),
      (selected) => {
        app.setSharedState(selected);
      },
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useAsyncEffect(async () => {
    try {
      const configData = await getConfig();
      setAppStore(configData);
    } catch {
      // ignore
    }
  }, []);

  useAsyncEffect(async () => {
    const state = await app.getSharedState();
    if (state) setBrowserStore(state as Partial<BrowserStore>);
  }, []);

  useEffect(() => {
    on("browser:domReady", onDomReady);
    on("browser:failLoad", onFailLoad);
    on("browser:didNavigate", onDidNavigate);
    on("browser:didNavigateInPage", onDidNavigateInPage);

    return () => {
      off("browser:domReady", onDomReady);
      off("browser:failLoad", onFailLoad);
      off("browser:didNavigate", onDidNavigate);
      off("browser:didNavigateInPage", onDidNavigateInPage);
    };
  }, []);

  const setPageInfo = useMemoizedFn(({ url, title: pageTitle }: UrlDetail) => {
    setBrowserStore({ url, title: pageTitle });
  });

  const onDomReady = useMemoizedFn((...args: unknown[]) => {
    setPageInfo(args[1] as UrlDetail);
  });

  const onFailLoad = useMemoizedFn((...args: unknown[]) => {
    const data = args[1] as { code: number; desc: string };
    setBrowserStore({
      status: BrowserStatus.Failed,
      errCode: data.code,
      errMsg: data.desc,
    });
  });

  const onDidNavigate = useMemoizedFn((...args: unknown[]) => {
    setPageInfo(args[1] as UrlDetail);
    setBrowserStore({ status: BrowserStatus.Loaded });
  });

  const onDidNavigateInPage = useMemoizedFn((...args: unknown[]) => {
    setPageInfo(args[1] as UrlDetail);
  });

  useEffect(() => {
    document.title = title || document.title;
    return () => {
      document.title = originTitle.current;
    };
  }, [title]);

  return (
    <PageContainer
      className={cn("flex flex-col p-0", { "gap-2": !page })}
      wrapperClassName={cn("bg-mg-bg", { "p-0": page })}
    >
      <ToolBar page={page} />
      <div className="flex flex-1 overflow-hidden">
        {mode === PageMode.Browser ? <BrowserView /> : <FavoriteList />}
      </div>
    </PageContainer>
  );
};

export default SourceExtract;
