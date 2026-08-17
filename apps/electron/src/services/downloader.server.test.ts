import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const doubles = vi.hoisted(() => {
  class FakeTaskEvents {
    readonly close = vi.fn();
    readonly listeners = new Map<string, Array<(payload: any) => void>>();

    on(eventName: string, listener: (payload: any) => void) {
      const listeners = this.listeners.get(eventName) ?? [];
      listeners.push(listener);
      this.listeners.set(eventName, listeners);
      return this;
    }

    emit(eventName: string, payload: any) {
      for (const listener of this.listeners.get(eventName) ?? []) {
        listener(payload);
      }
    }
  }

  return {
    clients: [] as Array<{
      streamEvents: ReturnType<typeof vi.fn>;
    }>,
    events: [] as FakeTaskEvents[],
    FakeTaskEvents,
    runners: [] as Array<{
      getURL: ReturnType<typeof vi.fn>;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }>,
    runnerStart: vi.fn<() => Promise<void>>(),
    runnerStop: vi.fn<() => Promise<void>>(),
  };
});

vi.mock("@mediago/service-runner", () => ({
  ServiceRunner: class FakeServiceRunner {
    readonly getURL = vi.fn(() => "http://127.0.0.1:39719");
    readonly start = vi.fn(() => doubles.runnerStart());
    readonly stop = vi.fn(() => doubles.runnerStop());

    constructor() {
      doubles.runners.push(this);
    }
  },
}));

vi.mock("@mediago/core-sdk", () => ({
  MediaGoClient: class FakeMediaGoClient {
    readonly streamEvents = vi.fn(() => {
      const events = new doubles.FakeTaskEvents();
      doubles.events.push(events);
      return events;
    });

    constructor() {
      doubles.clients.push(this);
    }
  },
  TaskStatus: {
    Downloading: "downloading",
  },
}));

vi.mock("../utils/binaryResolver", () => ({
  resolveCoreBinaries: () => ({
    coreBin: "/fake/core/mediago-core",
    coreConfig: "/fake/core/config.json",
  }),
  resolveDepsBinaries: () => ({
    depsDir: "/fake/deps",
  }),
}));

vi.mock("../vendor/ElectronLogger", () => ({
  default: class FakeElectronLogger {},
}));

const { DownloaderServer } = await import("./downloader.server");

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createServer() {
  return new DownloaderServer({ info: vi.fn() } as never);
}

describe("DownloaderServer.stop", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    doubles.clients.length = 0;
    doubles.events.length = 0;
    doubles.runners.length = 0;
    doubles.runnerStart.mockReset().mockResolvedValue(undefined);
    doubles.runnerStop.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("stops polling, events, and the runner exactly once across repeated calls", async () => {
    const runnerStop = deferred();
    doubles.runnerStop.mockReturnValue(runnerStop.promise);
    const clearIntervalSpy = vi.spyOn(globalThis, "clearInterval");
    const server = createServer();

    await server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" });
    doubles.events[0].emit("download-start", { id: "42" });

    const firstStop = server.stop();
    const concurrentStop = server.stop();

    expect(concurrentStop).toBe(firstStop);
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(doubles.events[0].close).toHaveBeenCalledTimes(1);
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
    expect(() => server.getClient()).toThrowError(
      "DownloaderServer not started",
    );
    await expect(server.getURL()).resolves.toBe("");

    runnerStop.resolve();
    await Promise.all([firstStop, concurrentStop]);
    await server.stop();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(doubles.events[0].close).toHaveBeenCalledTimes(1);
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending start before stopping without publishing stale state", async () => {
    const runnerStart = deferred();
    doubles.runnerStart.mockReturnValue(runnerStart.promise);
    const server = createServer();

    const start = server.start({
      dbPath: "/fake/data/media.db",
      logDir: "/fake/logs",
    });
    const stop = server.stop();

    expect(doubles.runners[0].stop).not.toHaveBeenCalled();
    expect(doubles.clients).toHaveLength(0);
    expect(doubles.events).toHaveLength(0);
    expect(() => server.getClient()).toThrowError(
      "DownloaderServer not started",
    );
    await expect(server.getURL()).resolves.toBe("");

    runnerStart.resolve();
    await Promise.all([start, stop]);

    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
    expect(doubles.clients).toHaveLength(0);
    expect(doubles.events).toHaveLength(0);
    await expect(server.getURL()).resolves.toBe("");
  });

  it("coalesces concurrent starts around one runner", async () => {
    const runnerStart = deferred();
    doubles.runnerStart.mockReturnValue(runnerStart.promise);
    const server = createServer();

    const firstStart = server.start({
      dbPath: "/fake/data/media.db",
      logDir: "/fake/logs",
    });
    const concurrentStart = server.start({
      dbPath: "/fake/other.db",
      logDir: "/fake/other-logs",
    });

    expect(concurrentStart).toBe(firstStart);
    expect(doubles.runners).toHaveLength(1);

    runnerStart.resolve();
    await Promise.all([firstStart, concurrentStart]);

    expect(doubles.clients).toHaveLength(1);
    expect(doubles.events).toHaveLength(1);
    await server.stop();
  });

  it("rejects a start while runner shutdown is pending", async () => {
    const runnerStop = deferred();
    doubles.runnerStop.mockReturnValue(runnerStop.promise);
    const server = createServer();

    await server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" });
    const stop = server.stop();

    await expect(
      server.start({ dbPath: "/fake/new.db", logDir: "/fake/new-logs" }),
    ).rejects.toThrowError("DownloaderServer is stopping");
    expect(doubles.runners).toHaveLength(1);

    runnerStop.resolve();
    await stop;
  });

  it("can start again after a successful stop", async () => {
    const server = createServer();

    await server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" });
    await server.stop();
    await server.start({ dbPath: "/fake/new.db", logDir: "/fake/new-logs" });

    expect(doubles.runners).toHaveLength(2);
    expect(doubles.clients).toHaveLength(2);
    expect(doubles.events).toHaveLength(2);
    expect(server.getClient()).toBeDefined();
    await expect(server.getURL()).resolves.toBe("http://127.0.0.1:39719");

    await server.stop();
    expect(doubles.runnerStop).toHaveBeenCalledTimes(2);
  });

  it("shares a runner stop rejection and remains stopped afterward", async () => {
    const runnerStop = deferred();
    const stopError = new Error("runner shutdown failed");
    doubles.runnerStop.mockReturnValue(runnerStop.promise);
    const server = createServer();

    await server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" });

    const firstStop = server.stop();
    const concurrentStop = server.stop();
    runnerStop.reject(stopError);
    const results = await Promise.allSettled([firstStop, concurrentStop]);

    expect(results).toEqual([
      { reason: stopError, status: "rejected" },
      { reason: stopError, status: "rejected" },
    ]);
    expect(doubles.events[0].close).toHaveBeenCalledTimes(1);
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
    expect(() => server.getClient()).toThrowError(
      "DownloaderServer not started",
    );
    await expect(server.getURL()).resolves.toBe("");

    await expect(
      server.start({ dbPath: "/fake/new.db", logDir: "/fake/new-logs" }),
    ).rejects.toThrowError(
      "DownloaderServer cannot restart after shutdown failure",
    );
    expect(doubles.runners).toHaveLength(1);

    await server.stop();

    expect(doubles.events[0].close).toHaveBeenCalledTimes(1);
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
  });

  it("clears state and stops the runner when closing events throws", async () => {
    const closeError = new Error("event close failed");
    const server = createServer();

    await server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" });
    doubles.events[0].close.mockImplementation(() => {
      throw closeError;
    });

    const stop = server.stop();

    expect(() => server.getClient()).toThrowError(
      "DownloaderServer not started",
    );
    await expect(server.getURL()).resolves.toBe("");
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
    await expect(stop).rejects.toBe(closeError);
    expect(doubles.events[0].close).toHaveBeenCalledTimes(1);
    expect(doubles.runners[0].stop).toHaveBeenCalledTimes(1);
  });

  it("does not stop a runner again after start rejects", async () => {
    const startError = new Error("runner start failed");
    doubles.runnerStart.mockRejectedValue(startError);
    const server = createServer();

    await expect(
      server.start({ dbPath: "/fake/data/media.db", logDir: "/fake/logs" }),
    ).rejects.toBe(startError);
    await server.stop();

    expect(doubles.runners[0].stop).not.toHaveBeenCalled();
    expect(() => server.getClient()).toThrowError(
      "DownloaderServer not started",
    );
    await expect(server.getURL()).resolves.toBe("");
  });
});
