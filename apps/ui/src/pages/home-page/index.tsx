import { QrcodeOutlined } from "@ant-design/icons";
import { DownloadFilter } from "@mediago/shared-common";
import { useMemoizedFn } from "ahooks";
import { Pagination, Popover, QRCode } from "antd";
import { FolderOpen, Plus } from "lucide-react";
import { type FC, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import type { DownloadFormItem } from "@/components/download-form";
import { MgButton } from "@/components/mg";
import { CLICK_DOWNLOAD } from "@/const";
import { useEnvPath } from "@/hooks/use-config";
import { usePlatform } from "@/hooks/use-platform";
import { useTasks } from "@/hooks/use-tasks";
import { useUrlInvoke } from "@/hooks/use-url-invoke";
import { appStoreSelector, useAppStore } from "@/store/app";
import { useUiStore } from "@/store/ui";
import { isWeb, tdApp } from "@/utils";
import { DownloadList } from "./components/download-list";

interface Props {
  filter?: DownloadFilter;
}

const HomePage: FC<Props> = ({ filter = DownloadFilter.list }) => {
  const { t } = useTranslation();
  const { shell } = usePlatform();
  const appStore = useAppStore(useShallow(appStoreSelector));
  const { envPath } = useEnvPath();
  const openNewDownload = useUiStore((s) => s.openNewDownload);
  const { pagination, total, mutate, setPage, setPageSize } = useTasks(filter);

  const isList = filter === DownloadFilter.list;

  // The page state is shared between Downloads (/) and Completed (/done);
  // reset to page 1 on filter switch so a deep page can't strand the list
  // on an empty result with the pagination control hidden.
  useEffect(() => {
    setPage(1);
  }, [filter, setPage]);

  useUrlInvoke({
    onOpenForm: (item: DownloadFormItem) => {
      openNewDownload({
        url: item.url,
        name: item.name,
        type: item.type,
        headers: item.headers,
        folder: item.folder,
        batch: item.batch,
        batchList: item.batchList,
      });
    },
    refresh: () => mutate(),
  });

  const handleNew = useMemoizedFn(() => {
    tdApp.onEvent(CLICK_DOWNLOAD);
    openNewDownload();
  });

  return (
    <div className="mx-auto max-w-[1180px] px-[clamp(16px,3vw,34px)] pb-[90px] pt-6">
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <div className="min-w-0">
          <h1 className="text-[clamp(22px,2.4vw,28px)] font-extrabold tracking-[-0.03em] text-mg-fg">
            {isList ? t("downloadList") : t("downloadComplete")}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-mg-fg2">
            {isList ? t("manageAllTasks") : t("completedTasksDesc")}
          </p>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2.5">
          {!isWeb && (
            <MgButton
              variant="surface"
              onClick={() => shell.open(appStore.local)}
            >
              <FolderOpen size={16} strokeWidth={2} />
              {t("openFolder")}
            </MgButton>
          )}
          {!isList && !isWeb && appStore.enableMobilePlayer && (
            <Popover
              placement="bottomRight"
              content={
                <div className="flex flex-col items-center gap-1">
                  <QRCode value={envPath?.playerUrl || ""} />
                  <div className="text-xs">{t("scanToWatch")}</div>
                </div>
              }
            >
              <MgButton variant="surface">
                <QrcodeOutlined />
                {t("playOnMobile")}
              </MgButton>
            </Popover>
          )}
          {isList && (
            <MgButton variant="primary" onClick={handleNew}>
              <Plus size={17} strokeWidth={2.4} />
              {t("newDownload")}
            </MgButton>
          )}
        </div>
      </div>

      <DownloadList filter={filter} />

      {total > pagination.pageSize && (
        <Pagination
          className="mt-6 flex justify-center"
          current={pagination.page}
          pageSize={pagination.pageSize}
          total={total}
          onChange={(page, pageSize) => {
            setPage(page);
            setPageSize(pageSize);
          }}
        />
      )}
    </div>
  );
};

export default HomePage;
