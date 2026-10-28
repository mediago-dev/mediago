/** @vitest-environment happy-dom */

import { DownloadType } from "@mediago/common";
import { act, createElement, type PropsWithChildren } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  remoteCreate: vi.fn(),
  localCreate: vi.fn(),
  remoteEdit: vi.fn(),
  localEdit: vi.fn(),
  showDownloadDialog: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/i18n/app-language", () => ({ syncAppLanguage: vi.fn() }));
vi.mock("@/environment", () => ({ isWeb: false }));
vi.mock("@/components/ui/toast", () => ({ toast: { add: mocks.toast } }));
vi.mock("@/api/docker-download-task", () => ({
  createDockerDownloadTasks: mocks.remoteCreate,
  editDockerDownloadTask: mocks.remoteEdit,
  startDockerDownload: vi.fn(),
}));
vi.mock("@/api/download-task", () => ({
  createDownloadTasks: mocks.localCreate,
  editDownloadTask: mocks.localEdit,
  startDownload: vi.fn(),
  getDownloadFolders: vi.fn(async () => []),
}));
vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({
    browser: { showDownloadDialog: mocks.showDownloadDialog },
    app: {},
    contextMenu: { show: vi.fn() },
  }),
}));
vi.mock("@/hooks/use-browser-actions", () => ({
  useBrowserActions: () => ({}),
}));
vi.mock("@/hooks/use-smart-stream-submit", () => ({
  useSmartStreamSubmit: () => ({
    view: { machine: { phase: "idle" }, sources: [], partial: false },
    cancel: vi.fn(),
  }),
}));
function testDialog({ children }: PropsWithChildren) {
  return createElement("div", null, children);
}

vi.mock("@/components/ui/dialog", () => {
  return {
    Dialog: testDialog,
    DialogContent: testDialog,
    DialogDescription: testDialog,
    DialogFooter: testDialog,
    DialogHeader: testDialog,
    DialogTitle: testDialog,
  };
});
vi.mock("@/components/download-form-fields", () => ({
  DownloadFormFields: () => null,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: PropsWithChildren<{
    value: string;
    onValueChange: (value: string) => void;
  }>) =>
    createElement(
      "select",
      {
        value,
        onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
          onValueChange(event.target.value),
      },
      children,
    ),
  SelectContent: ({ children }: PropsWithChildren) => children,
  SelectItem: ({ children, value }: PropsWithChildren<{ value: string }>) =>
    createElement("option", { value }, children),
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const { BrowserViewPanel } =
  await import("@/pages/source-extract/components/browser-view-panel");
const { default: DownloadForm } = await import("./download-form");
const { useAppStore } = await import("@/store/app");
const { useBrowserStore } = await import("@/store/browser");

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remoteCreate.mockResolvedValue([]);
  mocks.remoteEdit.mockResolvedValue(undefined);
  useAppStore.setState({ enableDocker: true });
  useBrowserStore.getState().reset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderSource(inspecting = false) {
  const store = useBrowserStore.getState();
  store.addSource(store.activeTabId, {
    id: "source-1",
    name: "Episode",
    url: "https://example.com/master.m3u8",
    documentURL: "https://example.com/watch",
    headers: "Referer: https://example.com/watch",
    type: DownloadType.m3u8,
    mediaInfo: {
      status: inspecting ? "inspecting" : "ready",
      playlistType: "master",
      variants: [{ url: "https://example.com/720.m3u8", height: 720 }],
    },
  });
  await act(async () => root.render(createElement(BrowserViewPanel)));
}

function dockerButton() {
  return container.querySelector<HTMLButtonElement>(
    'button[aria-label="addToDocker"]',
  );
}

function requiredControl<T>(control: T | null | undefined): T {
  if (!control) throw new Error("Expected UI control");
  return control;
}

test("source action sends the selected stream and headers to Docker without opening edit", async () => {
  await renderSource();
  const select = requiredControl(container.querySelector("select"));
  await act(async () => {
    select.value = "https://example.com/720.m3u8";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => requiredControl(dockerButton()).click());
  expect(mocks.remoteCreate).toHaveBeenCalledExactlyOnceWith(
    [
      {
        url: "https://example.com/720.m3u8",
        name: "Episode",
        headers: "Referer: https://example.com/watch",
        type: DownloadType.m3u8,
        folder: "",
      },
    ],
    false,
  );
  expect(mocks.showDownloadDialog).not.toHaveBeenCalled();
  expect(mocks.localCreate).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "addToDockerSuccess",
    type: "success",
  });
});

test("source action blocks repeated sends and recovers after a Docker failure", async () => {
  let reject!: (error: Error) => void;
  mocks.remoteCreate.mockReturnValueOnce(
    new Promise((_, fail) => {
      reject = fail;
    }),
  );
  await renderSource();
  await act(async () => {
    requiredControl(dockerButton()).click();
    requiredControl(dockerButton()).click();
  });
  expect(mocks.remoteCreate).toHaveBeenCalledTimes(1);
  expect(requiredControl(dockerButton()).disabled).toBe(true);
  await act(async () => reject(new Error("Docker unavailable")));
  expect(mocks.toast).toHaveBeenCalledWith({
    title: "Docker unavailable",
    type: "error",
  });
  expect(requiredControl(dockerButton()).disabled).toBe(false);
  await act(async () => requiredControl(dockerButton()).click());
  expect(mocks.remoteCreate).toHaveBeenCalledTimes(2);
});

test("source action is unavailable during inspection and hidden when Docker is disabled", async () => {
  await renderSource(true);
  expect(requiredControl(dockerButton()).disabled).toBe(true);
  await act(async () => useAppStore.setState({ enableDocker: false }));
  expect(dockerButton()).toBeNull();
});

async function renderEditor(origin: "local" | "docker", id?: number) {
  await act(async () =>
    root.render(
      createElement(DownloadForm, {
        id: "editor",
        initialValues: {
          id,
          origin,
          name: "Edited episode",
          url: "https://example.com/video.mp4",
          type: DownloadType.direct,
          headers: "Referer: https://example.com",
          folder: "series",
        },
        isEdit: true,
        open: true,
        onOpenChange: vi.fn(),
      }),
    ),
  );
}

test.each([42])(
  "local edit/overlay can send a new remote task without changing the local task (id=%s)",
  async (id) => {
    await renderEditor("local", id);
    const button = [...container.querySelectorAll("button")].find(
      (node) => node.textContent === "copyToDocker",
    );
    expect(button).toBeDefined();
    await act(async () => requiredControl(button).click());
    expect(mocks.remoteCreate).toHaveBeenCalledExactlyOnceWith(
      [
        {
          name: "Edited episode",
          url: "https://example.com/video.mp4",
          type: DownloadType.direct,
          headers: "Referer: https://example.com",
          folder: "series",
        },
      ],
      false,
    );
    expect(mocks.localEdit).not.toHaveBeenCalled();
    expect(mocks.localCreate).not.toHaveBeenCalled();
  },
);

test("editing an existing Docker task saves to Docker without offering a duplicate send", async () => {
  await renderEditor("docker", 42);
  expect(container.textContent).not.toContain("addToDocker");
  const save = [...container.querySelectorAll("button")].find(
    (node) => node.textContent === "save",
  );
  await act(async () => requiredControl(save).click());
  expect(mocks.remoteEdit).toHaveBeenCalledWith(
    42,
    expect.objectContaining({ name: "Edited episode" }),
  );
  expect(mocks.remoteCreate).not.toHaveBeenCalled();
  expect(mocks.localEdit).not.toHaveBeenCalled();
});
