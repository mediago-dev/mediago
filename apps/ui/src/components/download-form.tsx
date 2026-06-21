import {
  CloudDownloadOutlined,
  DockerOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { useAsyncEffect, useMemoizedFn } from "ahooks";
import {
  App,
  AutoComplete,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Switch,
} from "antd";
import { forwardRef, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { ADD_TO_LIST, DOWNLOAD_NOW } from "@/const";
import { usePlatform } from "@/hooks/use-platform";
import { createDownloadTasks, getDownloadFolders } from "@/api/download-task";
import { useDockerApi } from "@/hooks/use-docker-api";
import { appStoreSelector, useAppStore } from "@/store/app";
import { downloadFormSelector, useConfigStore } from "@/store/config";
import { tdApp } from "@/utils";
import { DownloadTask, DownloadType } from "@mediago/shared-common";
import { BatchUrlTextarea } from "./batchurl-textarea";

const { TextArea } = Input;

export interface DownloadFormItem {
  batch?: boolean;
  batchList?: string;
  name?: string;
  type?: DownloadType;
  headers?: string;
  url?: string;
  id?: number;
  folder?: string;
}

export interface DownloadFormProps {
  isEdit?: boolean;
  destroyOnClose?: boolean;
  onFormVisibleChange?: (open: boolean) => void;
  onConfirm?: (values: DownloadFormItem) => void;
  id: string;
}

export interface DownloadFormRef {
  setFieldsValue: (value: DownloadFormItem) => void;
  getFieldsValue: () => DownloadFormItem;
  openModal: (value: DownloadFormItem) => void;
}

export interface DownloadTaskForm extends DownloadTask {
  batch?: boolean;
  batchList?: string;
}

interface Options {
  label: string;
  value: string;
}

export default forwardRef<DownloadFormRef, DownloadFormProps>(
  function DownloadForm(
    { isEdit, destroyOnClose, onFormVisibleChange, id, onConfirm },
    ref,
  ) {
    const { enableDocker } = useAppStore(useShallow(appStoreSelector));
    const [modalOpen, setModalOpen] = useState(false);
    const [form] = Form.useForm<DownloadFormItem>();
    const { t } = useTranslation();
    const { message } = App.useApp();
    const { setLastDownloadTypes, setLastIsBatch } = useConfigStore(
      useShallow(downloadFormSelector),
    );
    const [folders, setFolders] = useState<Options[]>([]);
    const [videoFolders, setVideoFolders] = useState<string[]>([]);
    const { contextMenu } = usePlatform();
    const { addVideosToDocker } = useDockerApi();

    useAsyncEffect(async () => {
      if (modalOpen) {
        try {
          const fetchedFolders = await getDownloadFolders();
          if (Array.isArray(fetchedFolders)) {
            setVideoFolders(fetchedFolders);
            setFolders(() =>
              fetchedFolders.map((f) => ({
                value: f,
                label: f,
              })),
            );
          }
        } catch {
          // Go Core may not be ready yet, ignore
        }
      }
    }, [modalOpen]);

    useImperativeHandle(ref, () => {
      return {
        openModal: (value) => {
          setModalOpen(true);
          // Defer so the Form is mounted before setting values
          queueMicrotask(() => form.setFieldsValue(value));
        },
        setFieldsValue: (value) => {
          form.setFieldsValue(value);
        },
        getFieldsValue: () => {
          return form.getFieldsValue();
        },
      };
    }, []);

    const handleValuesChange = useMemoizedFn(
      (values: Record<string, unknown>) => {
        const { type, batch } = values;
        if (type) {
          setLastDownloadTypes(type);
        }
        if (batch !== null && batch !== undefined) {
          setLastIsBatch(batch);
        }
      },
    );

    const afterOpenChange = useMemoizedFn((open: boolean) => {
      onFormVisibleChange?.(open);

      if (!open) {
        form.resetFields();
      }
    });

    const handleSave = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }

      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks);
        // Badge increments via the "download-create" SSE event
        // (apps/ui/src/api/events.ts); drives both the main window and
        // the overlay-dialog WebContents from a single source.
        setModalOpen(false);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(ADD_TO_LIST, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleAddToDocker = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }

      try {
        const tasks = await getFormItems();
        await addVideosToDocker({ items: tasks });

        message.success(t("addToDockerSuccess"));
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleDownloadNow = useMemoizedFn(async () => {
      try {
        await form.validateFields();
      } catch {
        return;
      }
      try {
        const tasks = await getFormItems();
        await createDownloadTasks(tasks, true);
        // Badge increments via the "download-create" SSE event; see
        // handleSave comment.
        setModalOpen(false);
        onConfirm?.(form.getFieldsValue());
        tdApp.onEvent(DOWNLOAD_NOW, { id });
      } catch (e: unknown) {
        message.error((e as Error)?.message || t("pleaseEnterCorrectFormInfo"));
      }
    });

    const handleSearchFolder = useMemoizedFn((val: string) => {
      return setFolders(() => {
        const videoOptions = videoFolders.map((f) => ({ value: f, label: f }));
        if (!val) return videoOptions;
        return [{ value: val, label: val }, ...videoOptions];
      });
    });

    const getFormItems = useMemoizedFn(async () => {
      const { batch } = form.getFieldsValue();
      if (batch) {
        const {
          batchList = "",
          headers,
          type = DownloadType.m3u8,
        } = form.getFieldsValue();

        const tasks: Omit<DownloadTask, "id">[] = await Promise.all(
          batchList.split("\n").map(async (line: string) => {
            const [url, customName, folder] = line.trim().split(" ");
            return {
              url: url.trim(),
              name: customName?.trim(),
              headers,
              type,
              folder,
            };
          }),
        );

        return tasks;
      } else {
        const {
          name = "",
          url = "",
          headers,
          type = DownloadType.m3u8,
          folder,
        } = form.getFieldsValue();

        const task: Omit<DownloadTask, "id"> = {
          name,
          url,
          headers,
          type,
          folder,
        };

        return [task];
      }
    });

    return (
      <Modal
        open={modalOpen}
        key={isEdit ? "edit" : "new"}
        title={isEdit ? t("editDownload") : t("newDownload")}
        width="min(500px, calc(100vw - 24px))"
        className="mediago-download-modal"
        onCancel={() => setModalOpen(false)}
        afterOpenChange={afterOpenChange}
        destroyOnHidden={destroyOnClose}
        footer={[
          <Button key="cancel" onClick={() => setModalOpen(false)}>
            {t("cancel")}
          </Button>,
          enableDocker && (
            <Button
              key="docker"
              onClick={handleAddToDocker}
              icon={<DockerOutlined />}
            >
              {t("addToDocker")}
            </Button>
          ),
          <Button
            key="submit"
            onClick={handleSave}
            icon={<UnorderedListOutlined />}
          >
            {t("addToList")}
          </Button>,
          <Button
            key="link"
            type="primary"
            onClick={handleDownloadNow}
            icon={<CloudDownloadOutlined />}
          >
            {t("downloadNow")}
          </Button>,
        ]}
      >
        <Form
          form={form}
          autoFocus
          labelCol={{ xs: { span: 24 }, sm: { span: 5 } }}
          wrapperCol={{ xs: { span: 24 }, sm: { span: 19 } }}
          layout="horizontal"
          colon={false}
          labelWrap
          onValuesChange={handleValuesChange}
        >
          <Form.Item name="id" hidden>
            <Input />
          </Form.Item>
          <Form.Item hidden={isEdit} label={t("batchDownload")} name={"batch"}>
            <Switch />
          </Form.Item>
          <Form.Item
            key="type"
            name="type"
            label={t("videoType")}
            rules={[
              {
                required: true,
                message: t("pleaseEnterVideoName"),
              },
            ]}
          >
            <Select
              disabled={isEdit}
              options={[
                {
                  label: t("streamMedia"),
                  value: "m3u8",
                },
                {
                  label: t("bilibiliMedia"),
                  value: "bilibili",
                },
                {
                  label: t("youtubeMedia"),
                  value: "youtube",
                },
                {
                  label: t("direct"),
                  value: "direct",
                },
                {
                  label: t("mediagoMedia"),
                  value: "mediago",
                },
              ]}
              placeholder={t("pleaseSelectVideoType")}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              const isBatch = formInstance.getFieldValue("batch");
              if (isBatch) {
                return null;
              }

              return (
                <Form.Item
                  shouldUpdate
                  name="name"
                  label={t("videoName")}
                  rules={[
                    {
                      required:
                        formInstance.getFieldsValue().type !== "bilibili",
                      message: t("pleaseEnterCorrectFormInfo"),
                    },
                  ]}
                >
                  <Input
                    placeholder={t("pleaseEnterVideoName")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (isEdit || !formInstance.getFieldValue("batch")) {
                return null;
              }
              return (
                <Form.Item
                  label={t("videoLink")}
                  name="batchList"
                  required
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterVideoLink"),
                    },
                    {
                      validator: (_, value) => {
                        const lines = value.split("\n");
                        for (const line of lines) {
                          const params = line.trim().split(" ");
                          if (params.length > 3) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                          const [url] = params;
                          if (!/^(https?):\/\/.+/.test(url)) {
                            return Promise.reject(
                              new Error(t("pleaseEnterCorrectBatchList")),
                            );
                          }
                        }
                        return Promise.resolve();
                      },
                    },
                  ]}
                >
                  <BatchUrlTextarea
                    rows={5}
                    placeholder={t("videoLikeDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (formInstance.getFieldValue("batch") && !isEdit) {
                return null;
              }
              return (
                <Form.Item
                  name="url"
                  label={t("videoLink")}
                  required
                  rules={[
                    {
                      required: true,
                      message: t("pleaseEnterOnlineVideoUrl"),
                    },
                    {
                      pattern: /^(file|https?):\/\/.+/,
                      message: t("pleaseEnterCorrectVideoLink"),
                    },
                  ]}
                >
                  <Input
                    placeholder={t("pleaseEnterOnlineVideoUrlOrDragM3U8Here")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                    onDrop={(e) => {
                      const file = e.dataTransfer.files[0] as File & {
                        path: string;
                      };
                      formInstance.setFieldValue("url", `file://${file.path}`);
                      formInstance.validateFields(["url"]);
                    }}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (formInstance.getFieldValue("batch")) {
                return null;
              }
              return (
                <Form.Item name="folder" label={t("folder")}>
                  <AutoComplete
                    placeholder={t("pleaseInputVideoFolder")}
                    optionFilterProp="label"
                    options={folders}
                    onSearch={handleSearchFolder}
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
          <Form.Item noStyle shouldUpdate>
            {(formInstance) => {
              if (
                formInstance.getFieldValue("type") !== "m3u8" &&
                formInstance.getFieldValue("type") !== "mediago" &&
                !formInstance.getFieldValue("batch")
              ) {
                return null;
              }
              return (
                <Form.Item label={t("additionalHeaders")} name="headers">
                  <TextArea
                    rows={4}
                    placeholder={t("additionalHeadersDescription")}
                    onContextMenu={() =>
                      contextMenu.show([
                        { key: "copy", label: t("copy") },
                        { key: "paste", label: t("paste") },
                      ])
                    }
                  />
                </Form.Item>
              );
            }}
          </Form.Item>
        </Form>
      </Modal>
    );
  },
);
