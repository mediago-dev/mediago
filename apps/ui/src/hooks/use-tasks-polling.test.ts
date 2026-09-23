/** @vitest-environment happy-dom */

import {
  DownloadFilter,
  DownloadStatus,
  DownloadType,
  type DownloadTaskResponse,
} from "@mediago/common";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, unstable_serialize } from "swr";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getDockerTasks } from "@/api/docker-download-task";
import { getDownloadTasks } from "@/api/download-task";
import { useAppStore } from "@/store/app";
import { useDockerDownloadStore } from "@/store/docker-downloads";
import { useHomeStore } from "@/store/home";
import { useTasks } from "./use-tasks";

vi.mock("@/api/download-task", () => ({ getDownloadTasks: vi.fn() }));
vi.mock("@/api/docker-download-task", () => ({ getDockerTasks: vi.fn() }));

const remoteTask = {
  id: 7,
  name: "remote video",
  type: DownloadType.m3u8,
  url: "https://example.com/video.m3u8",
  status: DownloadStatus.Downloading,
};

let root: Root;
let container: HTMLDivElement;
let cache: Map<string, { data: unknown }>;
let current: ReturnType<typeof useTasks>;

function TaskProbe() {
  current = useTasks();
  return createElement(
    "div",
    { "data-offline": current.dockerOffline },
    current.data.map((task) => task.name).join(","),
  );
}

async function mount() {
  await act(async () => {
    root.render(
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache,
            dedupingInterval: 0,
            revalidateOnFocus: false,
            shouldRetryOnError: false,
          },
        },
        createElement(TaskProbe),
      ),
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(getDownloadTasks).mockResolvedValue({ list: [], total: 0 });
  vi.mocked(getDockerTasks).mockResolvedValue({ list: [], total: 0 });
  useAppStore.setState({ enableDocker: true });
  useHomeStore.getState().setPageSize(20);
  useDockerDownloadStore.getState().replaceSnapshot(DownloadFilter.list, [], 0);
  cache = new Map();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

test.each([undefined, { total: 0 }, "<html>loading</html>"])(
  "mounts safely before a task list is available: %j",
  async (cachedData) => {
    cache.set(
      unstable_serialize({
        key: "api/tasks/docker",
        args: { current: 1, pageSize: 20, filter: DownloadFilter.list },
      }),
      { data: cachedData },
    );
    vi.mocked(getDockerTasks).mockImplementation(
      () => new Promise<DownloadTaskResponse>(() => {}),
    );

    await mount();

    expect(container.querySelector("div")).not.toBeNull();
    expect(current.data).toEqual([]);
  },
);

test("does not fetch Docker tasks when Docker is disabled", async () => {
  useAppStore.setState({ enableDocker: false });
  await mount();
  await act(() => vi.advanceTimersByTimeAsync(12_000));

  expect(getDockerTasks).not.toHaveBeenCalled();
  expect(current.dockerOffline).toBe(false);
});

test("keeps cached remote tasks visible when the proxy fails", async () => {
  useDockerDownloadStore
    .getState()
    .replaceSnapshot(DownloadFilter.list, [remoteTask], 1);
  vi.mocked(getDockerTasks).mockRejectedValue(new Error("Bad Gateway"));

  await mount();

  expect(current.dockerOffline).toBe(true);
  expect(current.data).toMatchObject([
    { id: 7, name: "remote video", remoteOffline: true },
  ]);
  expect(container.textContent).toContain("remote video");
});

test("polls active tasks every second and idle tasks every twelve seconds", async () => {
  vi.mocked(getDockerTasks).mockResolvedValue({ list: [remoteTask], total: 1 });
  await mount();
  expect(getDockerTasks).toHaveBeenCalledTimes(1);

  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(getDockerTasks).toHaveBeenCalledTimes(2);

  vi.mocked(getDockerTasks).mockResolvedValue({ list: [], total: 0 });
  await act(async () => {
    await current.mutate();
  });
  expect(getDockerTasks).toHaveBeenCalledTimes(3);

  await act(() => vi.advanceTimersByTimeAsync(11_999));
  expect(getDockerTasks).toHaveBeenCalledTimes(3);
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(getDockerTasks).toHaveBeenCalledTimes(4);
});
