/** @vitest-environment happy-dom */

import { DownloadStatus, DownloadType } from "@mediago/common";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadTaskDetails } from "@/hooks/use-tasks";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

vi.mock("@/hooks/use-platform", () => ({
  usePlatform: () => ({ shell: { open: mocks.open } }),
}));

vi.mock("@/hooks/use-config", () => ({
  useEnvPath: () => ({ envPath: { playerUrl: "http://127.0.0.1/player" } }),
}));

const { DownloadTaskItem } = await import("./download-item");
const { useAppStore } = await import("@/store/app");

function task(
  overrides: Partial<DownloadTaskDetails> = {},
): DownloadTaskDetails {
  return {
    id: 1,
    type: DownloadType.m3u8,
    name: "Live stream",
    url: "https://example.com/live.m3u8",
    status: DownloadStatus.Downloading,
    isLive: true,
    percent: "20",
    speed: "1 MB/s",
    origin: "local",
    ...overrides,
  };
}

describe("DownloadTaskItem live recording actions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    useAppStore.setState({ showTerminal: false });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  async function renderItem(
    value: DownloadTaskDetails,
    onStopDownload = vi
      .fn<(task: DownloadTaskDetails) => Promise<void>>()
      .mockResolvedValue(undefined),
  ) {
    await act(async () => {
      root.render(
        createElement(DownloadTaskItem, {
          task: value,
          selected: false,
          onSelect: vi.fn(),
          onSelectChange: vi.fn(),
          onStartDownload: vi.fn(),
          onStopDownload,
          onContextMenu: vi.fn(),
          onDelete: vi.fn(),
          onRefresh: vi.fn(),
        }),
      );
    });
    return onStopDownload;
  }

  it("confirms a live stop and exposes a finalizing state", async () => {
    let resolve!: () => void;
    const onStopDownload = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    await renderItem(task(), onStopDownload);

    const stopButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="endRecording"]',
    );
    await act(async () => stopButton?.click());
    expect(onStopDownload).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("endLiveRecordingDescription");

    const confirm = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "endAndSaveRecording",
    );
    await act(async () => confirm?.click());

    expect(onStopDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 1, origin: "local" }),
    );
    const endingButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="endingRecording"]',
    );
    expect(endingButton?.disabled).toBe(true);
    expect(container.textContent).toContain("endingRecording");

    await act(async () => resolve());
  });

  it("continues recording when the confirmation is cancelled", async () => {
    const onStopDownload = await renderItem(task());
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="endRecording"]')
        ?.click();
    });
    const cancel = [...document.body.querySelectorAll("button")].find(
      (button) => button.textContent === "continueRecording",
    );
    await act(async () => cancel?.click());

    expect(onStopDownload).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain(
      "endLiveRecordingDescription",
    );
  });

  it("keeps the existing immediate pause behavior for non-live downloads", async () => {
    const onStopDownload = await renderItem(task({ isLive: false }));
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="pause"]')
        ?.click();
    });

    expect(onStopDownload).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: 1, origin: "local" }),
    );
    expect(document.body.textContent).not.toContain(
      "endLiveRecordingDescription",
    );
  });

  it("shows a standardized live status without a percentage progress bar", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-27T07:32:34.000Z"));
    await renderItem(
      task({
        percent: "92",
        speed: "1.55MBps",
        recordingStartedAt: "2026-08-27T07:20:00.000Z",
      }),
    );

    expect(container.querySelector('[data-slot="progress"]')).toBeNull();
    expect(container.textContent).toContain("recording");
    expect(
      [...container.querySelectorAll("span")].filter(
        (element) => element.textContent === "recording",
      ),
    ).toHaveLength(1);
    expect(container.textContent).toContain("recordedDuration");
    expect(container.textContent).toContain("00:12:34");
    expect(container.textContent).toContain("recordingStartedAt");
    expect(container.textContent).toContain("1.55 MB/s");
    expect(container.textContent).not.toContain("92%");
  });

  it("keeps percentage progress for regular downloads", async () => {
    await renderItem(task({ isLive: false, percent: "42", speed: "2.5MiB/s" }));

    expect(container.querySelector('[data-slot="progress"]')).not.toBeNull();
    expect(container.textContent).toContain("42%");
  });

  it("keeps an offline Docker task visible while disabling its actions", async () => {
    await renderItem(
      task({
        origin: "docker",
        remoteOffline: true,
        remoteLastSyncedAt: "2026-08-29T10:00:00.000Z",
        status: DownloadStatus.Ready,
        isLive: false,
      }),
    );

    expect(container.textContent).toContain("dockerOffline");
    expect(
      container
        .querySelector('[role="checkbox"]')
        ?.getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      container.querySelector<HTMLInputElement>('input[type="checkbox"]')
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="edit"]')
        ?.disabled,
    ).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="download"]',
      )?.disabled,
    ).toBe(true);
  });
});
