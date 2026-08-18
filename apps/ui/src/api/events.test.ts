import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const { httpGet } = vi.hoisted(() => ({
  httpGet: vi.fn(),
}));

vi.mock("@/utils", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/utils")>();
  return {
    ...original,
    http: { ...original.http, get: httpGet },
    isWeb: false,
  };
});

import {
  initGoEvents,
  registerDownloadSseListeners,
  type DownloadSseCollaborators,
} from "./events";

type EventListener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, EventListener[]>();
  readonly url: string;
  closed = false;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  addEventListener(name: string, listener: EventListener) {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  emit(name: string, data: string) {
    for (const listener of this.listeners.get(name) ?? []) {
      listener({ data });
    }
  }

  close() {
    this.closed = true;
  }
}

const lifecycleEvents = [
  ["download-start", "start"],
  ["download-success", "success"],
  ["download-failed", "failed"],
  ["download-stop", "stopped"],
] as const;

const invalidIds: unknown[] = [
  "0",
  "-1",
  " 1",
  "1 ",
  "1.5",
  "1e2",
  "123e4567-e89b-12d3-a456-426614174000",
  "source-media-id",
  "",
  "01",
  "9007199254740992",
  null,
  undefined,
  42,
];

function createCollaborators() {
  return {
    dispatchDownload: vi.fn(),
    startProgressPolling: vi.fn(),
    stopProgressPollingIfIdle: vi.fn(),
    protocolWarning: vi.fn(),
  } satisfies DownloadSseCollaborators;
}

beforeEach(() => {
  FakeEventSource.instances = [];
  httpGet.mockReset();
  httpGet.mockResolvedValue({ tasks: [], total: 0 });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("registerDownloadSseListeners", () => {
  test.each(lifecycleEvents)(
    "%s rejects malformed JSON and every invalid persisted ID without side effects",
    (eventName) => {
      const eventSource = new FakeEventSource("http://core.test/api/events");
      const collaborators = createCollaborators();
      registerDownloadSseListeners(eventSource, collaborators);

      eventSource.emit(eventName, "{not-json");
      for (const id of invalidIds) {
        eventSource.emit(eventName, JSON.stringify({ id }));
      }

      expect(collaborators.protocolWarning).toHaveBeenCalledTimes(
        invalidIds.length + 1,
      );
      for (const warningCall of collaborators.protocolWarning.mock.calls) {
        expect(warningCall).toEqual(["Ignored invalid download event"]);
      }
      expect(collaborators.dispatchDownload).not.toHaveBeenCalled();
      expect(collaborators.startProgressPolling).not.toHaveBeenCalled();
      expect(collaborators.stopProgressPollingIfIdle).not.toHaveBeenCalled();
      expect(httpGet).not.toHaveBeenCalled();
    },
  );

  test("dispatches one typed event and polling transition for each valid ID", () => {
    const eventSource = new FakeEventSource("http://core.test/api/events");
    const collaborators = createCollaborators();
    registerDownloadSseListeners(eventSource, collaborators);

    eventSource.emit("download-start", JSON.stringify({ id: "42" }));
    eventSource.emit("download-success", JSON.stringify({ id: "42" }));
    eventSource.emit(
      "download-failed",
      JSON.stringify({
        id: "42",
        error: "BBDown was not found",
        errorCode: "dependency_missing",
        dependency: "BBDown",
      }),
    );
    eventSource.emit("download-stop", JSON.stringify({ id: "42" }));

    expect(collaborators.dispatchDownload.mock.calls).toEqual([
      [{ type: "start", data: { id: 42 } }],
      [{ type: "success", data: { id: 42 } }],
      [
        {
          type: "failed",
          data: {
            id: 42,
            error: "BBDown was not found",
            errorCode: "dependency_missing",
            dependency: "BBDown",
          },
        },
      ],
      [{ type: "stopped", data: { id: 42 } }],
    ]);
    expect(collaborators.startProgressPolling).toHaveBeenCalledOnce();
    expect(collaborators.stopProgressPollingIfIdle).toHaveBeenCalledTimes(3);
    expect(collaborators.protocolWarning).not.toHaveBeenCalled();
    expect(httpGet).not.toHaveBeenCalled();
  });
});

describe("initGoEvents", () => {
  test("closes the previous stream without duplicating lifecycle listeners", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);

    initGoEvents("http://127.0.0.1:43210");
    initGoEvents("http://127.0.0.1:43210");

    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[0]?.closed).toBe(true);
    const currentSource = FakeEventSource.instances[1];
    for (const [eventName] of lifecycleEvents) {
      expect(currentSource?.listeners.get(eventName)).toHaveLength(1);
    }
    expect(httpGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(httpGet).toHaveBeenCalledOnce();
  });

  test("starts the intentional initial progress poll", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);

    initGoEvents("http://127.0.0.1:43210");

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(httpGet).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(httpGet).toHaveBeenCalledExactlyOnceWith("/api/tasks", {
      timeout: 5000,
    });

    const requestedUrls = httpGet.mock.calls.map(([url]) => String(url));
    for (const forbidden of [
      "NaN",
      "undefined",
      "123e4567-e89b-12d3-a456-426614174000",
      "source-media-id",
      "bilibili.com",
    ]) {
      expect(requestedUrls.join("\n")).not.toContain(forbidden);
    }
  });
});
