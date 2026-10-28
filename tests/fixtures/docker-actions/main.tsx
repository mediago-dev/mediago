import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AppLanguage, DownloadType } from "../../../packages/common/src";
import i18n from "../../../apps/ui/src/i18n";
import "../../../apps/ui/src/globals.css";
import { BrowserViewPanel } from "../../../apps/ui/src/pages/source-extract/components/browser-view-panel";
import DownloadForm from "../../../apps/ui/src/components/download-form";
import { Button } from "../../../apps/ui/src/components/ui/button";
import { Toaster } from "../../../apps/ui/src/components/ui/toast";
import { useAppStore } from "../../../apps/ui/src/store/app";
import { useBrowserStore } from "../../../apps/ui/src/store/browser";
import type { DownloadFormItem } from "../../../apps/ui/src/store/download-dialog";
import { setupHttp } from "../../../apps/ui/src/utils/http";

setupHttp("http://127.0.0.1:9900");
useAppStore
  .getState()
  .setAppStore({ enableDocker: true, language: AppLanguage.ZH });
await i18n.changeLanguage("zh");
const store = useBrowserStore.getState();
store.addSource(store.activeTabId, {
  id: "preview-source",
  name: "示例视频",
  documentURL: "https://example.com/watch",
  url: "https://example.com/master.m3u8",
  type: DownloadType.m3u8,
  headers: "Referer: https://example.com/watch",
  mediaInfo: {
    status: "ready",
    playlistType: "master",
    maxQuality: "1080p",
    variants: [
      { url: "https://example.com/720.m3u8", height: 720 },
      { url: "https://example.com/1080.m3u8", height: 1080 },
    ],
  },
});

function Fixture() {
  const [editor, setEditor] = useState<DownloadFormItem>();
  const [editing, setEditing] = useState(false);
  const enabled = useAppStore((state) => state.enableDocker);
  const openEditor = (origin: "local" | "docker", id?: number) => {
    setEditing(true);
    setEditor({
      origin,
      id,
      name: "待编辑的视频",
      url: "https://example.com/video.mp4",
      type: DownloadType.direct,
      headers: "Referer: https://example.com/watch",
      folder: "series",
    });
  };
  return (
    <Toaster>
      <main
        style={{
          maxWidth: 760,
          margin: "0 auto",
          padding: 32,
          display: "grid",
          gap: 24,
        }}
      >
        <h1 className="text-xl font-semibold">Docker 操作回归</h1>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) =>
              useAppStore
                .getState()
                .setAppStore({ enableDocker: event.target.checked })
            }
          />
          启用 Docker
        </label>
        <div className="flex gap-3">
          <Button
            onClick={() => {
              setEditing(false);
              setEditor({
                name: "待下载的视频",
                url: "https://example.com/video.mp4",
                type: DownloadType.direct,
              });
            }}
          >
            新建下载任务
          </Button>
          <Button onClick={() => openEditor("local", 77)}>编辑本地任务</Button>
          <Button onClick={() => openEditor("local")}>编辑提取素材</Button>
          <Button onClick={() => openEditor("docker", 42)}>
            编辑 Docker 任务
          </Button>
        </div>
        <section
          className="border bg-surface"
          style={{ height: 290, width: 380, borderRadius: 12, padding: 8 }}
        >
          <BrowserViewPanel />
        </section>
        {editor && (
          <DownloadForm
            key={`${editor.origin}-${editor.id}`}
            id="fixture-editor"
            open
            isEdit={editing}
            initialValues={editor}
            onOpenChange={(open) => {
              if (!open) setEditor(undefined);
            }}
          />
        )}
      </main>
    </Toaster>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
