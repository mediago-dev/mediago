import { useMemoizedFn } from "ahooks";
import { Empty, Space, Spin, Splitter } from "antd";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { MgButton } from "@/components/mg";
import WebView from "@/components/web-view";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { usePlatform } from "@/hooks/use-platform";
import {
  BrowserStatus,
  browserErrorSelector,
  browserSourcesSelector,
  setBrowserSelector,
  type SourceData,
  useBrowserStore,
} from "@/store/browser";
import { BrowserViewPanel } from "./browser-view-panel";

export function BrowserView() {
  const { on, off } = usePlatform();
  const { goto, goHome } = useBrowserActions();
  const { status, errMsg, errCode } = useBrowserStore(
    useShallow(browserErrorSelector),
  );
  const { sources } = useBrowserStore(useShallow(browserSourcesSelector));
  const url = useBrowserStore((s) => s.url);
  const { addSource } = useBrowserStore(useShallow(setBrowserSelector));
  const { t } = useTranslation();

  const onSourceDetected = useMemoizedFn((...args: unknown[]) => {
    addSource(args[1] as SourceData);
  });

  useEffect(() => {
    on("browser:sourceDetected", onSourceDetected);

    return () => {
      off("browser:sourceDetected", onSourceDetected);
    };
  }, []);

  const renderContent = useMemoizedFn(() => {
    // Loading or Loaded: show the WebView so the native WebContentsView is visible
    if (status === BrowserStatus.Loading || status === BrowserStatus.Loaded) {
      return (
        <div className="relative h-full w-full flex-1 bg-mg-bg">
          <WebView className="h-full w-full flex-1" />
          {status === BrowserStatus.Loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-mg-bg/60">
              <Spin />
            </div>
          )}
        </div>
      );
    }

    // Load failure
    if (status === BrowserStatus.Failed) {
      return (
        <div className="flex h-full w-full flex-row items-center justify-center bg-mg-bg">
          <Empty description={`${errMsg || t("loadFailed")} (${errCode})`}>
            <Space>
              <MgButton variant="surface" size="sm" onClick={goHome}>
                {t("backToHome")}
              </MgButton>
              <MgButton variant="primary" size="sm" onClick={() => goto(url)}>
                {t("refresh")}
              </MgButton>
            </Space>
          </Empty>
        </div>
      );
    }

    return null;
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {!sources.length ? (
        renderContent()
      ) : (
        <Splitter className="flex h-full flex-1">
          <Splitter.Panel>{renderContent()}</Splitter.Panel>
          <Splitter.Panel min="20%" max="70%" defaultSize={320}>
            <BrowserViewPanel />
          </Splitter.Panel>
        </Splitter>
      )}
    </div>
  );
}
