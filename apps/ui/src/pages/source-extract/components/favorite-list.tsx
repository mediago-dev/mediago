import { useMemoizedFn } from "ahooks";
import { App, Form, Input, Modal, Spin } from "antd";
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ADD_FAVORITE, OPEN_FAVORITE } from "@/const";
import { getFavIcon, tdApp } from "@/utils";
import { FavItem } from "./fav-item";
import { useFavorites } from "@/hooks/use-favorites";
import { usePlatform } from "@/hooks/use-platform";
import { useBrowserActions } from "@/hooks/use-browser-actions";
import { getPageTitle } from "@/api/util";

export function FavoriteList() {
  const {
    data: favoriteList,
    isLoading,
    error,
    addFavorite,
    removeFavorite,
  } = useFavorites();
  const { contextMenu } = usePlatform();
  const { loadUrl } = useBrowserActions();
  const { t } = useTranslation();
  const { message } = App.useApp();
  const [favoriteAddForm] = Form.useForm<Favorite>();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const onClickLoadItem = useMemoizedFn((item: Favorite) => {
    loadUrl(item.url);
    tdApp.onEvent(OPEN_FAVORITE);
  });

  const handleRemoveFavorite = useMemoizedFn(async (id: number) => {
    await removeFavorite(id);
  });

  const showModal = useMemoizedFn(() => {
    setIsModalOpen(true);
    tdApp.onEvent(ADD_FAVORITE);
  });

  const handleOk = useMemoizedFn(async () => {
    try {
      const values = await favoriteAddForm.validateFields();
      const icon = getFavIcon(values.url);
      await addFavorite({
        url: values.url,
        title: values.title,
        icon,
      });
      favoriteAddForm.resetFields();

      setIsModalOpen(false);
    } catch (err: unknown) {
      message.error((err as Error).message || t("addFavoriteFailed"));
    }
  });

  const handleCancel = useMemoizedFn(() => {
    setIsModalOpen(false);
  });

  // Auto-fill the title from the page's <title> tag when the user leaves
  // the URL field, unless they already typed a title themselves.
  const handleUrlBlur = useMemoizedFn(async () => {
    const url: string = favoriteAddForm.getFieldValue("url");
    if (!url || !/^https?:\/\/.+/.test(url)) return;
    if (favoriteAddForm.getFieldValue("title")) return;
    try {
      const { data: title } = await getPageTitle(url);
      // Re-check: the user may have typed something while we were fetching.
      if (!favoriteAddForm.getFieldValue("title") && title) {
        favoriteAddForm.setFieldValue("title", title);
      }
    } catch {
      // Best-effort: leave title blank if fetch fails; server falls back to URL.
    }
  });

  const handleContextMenu = useMemoizedFn(async (item: Favorite) => {
    const action = await contextMenu.show([
      { key: "open", label: t("open") },
      { key: "separator", label: "", type: "separator" },
      { key: "delete", label: t("delete") },
    ]);
    if (action === "open") {
      loadUrl(item.url);
    } else if (action === "delete") {
      await removeFavorite(item.id);
    }
  });

  if (isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full w-full items-center justify-center text-[#f43f5e]">
        {t("loadFailed")}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-mg-bg px-[clamp(14px,2vw,26px)] py-[22px]">
      <div className="mb-[13px] text-[12.5px] font-bold uppercase tracking-[0.02em] text-mg-fg3">
        {t("materialExtraction")}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-3">
        {favoriteList.map((item) => (
          <FavItem
            key={item.id}
            onContextMenu={() => handleContextMenu(item)}
            onClick={() => onClickLoadItem(item)}
            onClose={() => handleRemoveFavorite(item.id)}
            src={item.icon}
            url={item.url}
            title={item.title}
          />
        ))}
        <FavItem
          key="add"
          add
          onClick={showModal}
          icon={<Plus size={24} strokeWidth={2} />}
          title={t("addFavorite")}
        />
      </div>
      <Modal
        open={isModalOpen}
        onOk={handleOk}
        onCancel={handleCancel}
        title={t("addShortcut")}
        width={500}
        destroyOnHidden
        okText={t("confirm")}
        cancelText={t("cancel")}
      >
        <div className="flex min-h-36 flex-col justify-center">
          <Form<Favorite> form={favoriteAddForm} autoFocus>
            <Form.Item
              name="url"
              label={t("siteUrl")}
              rules={[
                {
                  required: true,
                  message: t("pleaseEnterSiteUrl"),
                },
                {
                  pattern: /^https?:\/\/.+/,
                  message: t("pleaseEnterCorrectUrl"),
                },
              ]}
            >
              <Input
                placeholder={t("pleaseEnterSiteUrl")}
                onBlur={handleUrlBlur}
              />
            </Form.Item>
            <Form.Item name="title" label={t("siteName")}>
              <Input placeholder={t("pleaseEnterSiteName")} />
            </Form.Item>
          </Form>
        </div>
      </Modal>
    </div>
  );
}
