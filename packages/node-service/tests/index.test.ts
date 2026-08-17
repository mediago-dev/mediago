import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vitest";

const spawnMock =
  vi.fn<
    (
      command: string,
      args?: readonly string[],
      options?: Record<string, unknown>,
    ) => ChildProcessWithoutNullStreams
  >();

const killMock =
  vi.fn<
    (
      pid: number,
      signal: NodeJS.Signals | string | undefined,
      callback: (error?: NodeJS.ErrnoException | null) => void,
    ) => void
  >();

vi.mock("node:child_process", () => ({
  spawn: (...args: Parameters<typeof spawnMock>) => spawnMock(...args),
}));

vi.mock("tree-kill", () => ({
  default: (...args: Parameters<typeof killMock>) => killMock(...args),
}));

async function loadServiceRunnerWithAvailablePort() {
  const { ServiceRunner } = await import("../src/index");
  const original = Reflect.get(ServiceRunner, "isPortFree");
  Reflect.set(
    ServiceRunner,
    "isPortFree",
    vi.fn(async () => true),
  );
  onTestFinished(() => {
    Reflect.set(ServiceRunner, "isPortFree", original);
  });
  return ServiceRunner;
}

const fetchMock =
  vi.fn<
    (
      input: string | URL,
      init?: unknown,
    ) => Promise<{ ok: boolean; status: number }>
  >();

let originalFetch: typeof fetch;

beforeAll(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

class MockChildProcess extends EventEmitter {
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  pid: number;
  killed = false;

  constructor(pid: number) {
    super();
    this.pid = pid;
    this.stdout = new EventEmitter() as unknown as NodeJS.ReadableStream;
    this.stderr = new EventEmitter() as unknown as NodeJS.ReadableStream;
  }
}

let lastSpawnedChild: MockChildProcess | null = null;
let nextPid = 4_000;

async function createExecutableFixture() {
  const dir = await mkdtemp(join(tmpdir(), "service-runner-"));
  const baseName = "dummy-service";
  const fileName = process.platform === "win32" ? `${baseName}.exe` : baseName;
  const filePath = join(dir, fileName);
  await writeFile(filePath, "", { mode: 0o755 });
  return { dir, name: baseName };
}

let executableFixture:
  | Awaited<ReturnType<typeof createExecutableFixture>>
  | undefined;

beforeAll(async () => {
  executableFixture = await createExecutableFixture();
});

afterAll(async () => {
  if (executableFixture) {
    await rm(executableFixture.dir, { recursive: true, force: true });
  }
});

function getExecutableFixture() {
  if (!executableFixture) {
    throw new Error("Executable fixture setup did not complete");
  }

  return executableFixture;
}

beforeEach(() => {
  vi.clearAllMocks();
  lastSpawnedChild = null;
  nextPid = 4_000;

  spawnMock.mockImplementation(() => {
    const child = new MockChildProcess(nextPid++);
    lastSpawnedChild = child;
    return child as unknown as ChildProcessWithoutNullStreams;
  });

  killMock.mockImplementation((_pid, _signal, callback) => {
    if (lastSpawnedChild) {
      lastSpawnedChild.killed = true;
      queueMicrotask(() => {
        lastSpawnedChild?.emit("exit", null, null);
      });
    }
    callback?.(null);
  });

  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
  });
});

afterEach(() => {
  lastSpawnedChild = null;
});

describe("ServiceRunner", () => {
  test("starts service, waits for healthy state, and stops gracefully", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();

    const runner = new ServiceRunner({
      executableDir: fixture.dir,
      executableName: fixture.name,
      preferredPort: 4_321,
    });
    onTestFinished(() => runner.stop().catch(() => undefined));

    const initialState = await runner.start();

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [, , spawnOptions] = spawnMock.mock.calls[0];
    expect(spawnOptions?.env).toMatchObject({
      PORT: "4321",
      HOST: "127.0.0.1",
    });

    expect(fetchMock).toHaveBeenCalled();
    const requestURL = fetchMock.mock.calls[0][0];
    expect(String(requestURL)).toBe("http://127.0.0.1:4321/healthy");

    expect(initialState.port).toBe(4_321);
    expect(initialState.host).toBe("127.0.0.1");
    expect(initialState.started).toBe(true);
    expect(runner.isRunning()).toBe(true);
    expect(await runner.checkHealth()).toBe(true);

    const secondStartState = await runner.start();
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(secondStartState.port).toBe(initialState.port);

    const restartedState = await runner.restart({
      preferredPort: 9_000,
      extraEnv: { CUSTOM_FLAG: "1" },
    });

    expect(spawnMock).toHaveBeenCalledTimes(2);
    const [, , secondSpawnOptions] = spawnMock.mock.calls[1];
    expect(secondSpawnOptions?.env).toMatchObject({
      PORT: "9000",
      HOST: "127.0.0.1",
      CUSTOM_FLAG: "1",
    });
    expect(restartedState.port).toBe(9_000);
    expect(restartedState.started).toBe(true);
    expect(killMock).toHaveBeenCalledTimes(1);
    expect(runner.isRunning()).toBe(true);

    await runner.stop();
    expect(killMock).toHaveBeenCalledTimes(2);
    expect(runner.isRunning()).toBe(false);
  });

  test("resolves host from LAN when internal flag is false", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();

    const originalFinder = Reflect.get(
      ServiceRunner as object,
      "findLanIPv4Address",
    ) as (() => string | undefined) | undefined;

    Reflect.set(
      ServiceRunner as object,
      "findLanIPv4Address",
      vi.fn(() => "10.0.0.42"),
    );

    const runner = new ServiceRunner({
      executableDir: fixture.dir,
      executableName: fixture.name,
      internal: false,
      preferredPort: 5_555,
    });

    try {
      const state = await runner.start();
      expect(state.host).toBe("10.0.0.42");
      expect(state.url).toBe("http://10.0.0.42:5555");
      expect(fetchMock).toHaveBeenCalled();
      const requestURL = fetchMock.mock.calls[0][0];
      expect(String(requestURL)).toBe("http://10.0.0.42:5555/healthy");
    } finally {
      await runner.stop();
      Reflect.set(ServiceRunner, "findLanIPv4Address", originalFinder);
    }
  });

  test("rejects when health checks do not pass within timeout", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    });

    vi.useFakeTimers();
    onTestFinished(() => vi.useRealTimers());
    const originalDelay = Reflect.get(ServiceRunner, "delay");
    Reflect.set(
      ServiceRunner,
      "delay",
      vi.fn(async (milliseconds: number) => {
        await vi.advanceTimersByTimeAsync(milliseconds);
      }),
    );
    onTestFinished(() => {
      Reflect.set(ServiceRunner, "delay", originalDelay);
    });

    const runner = new ServiceRunner({
      executableDir: fixture.dir,
      executableName: fixture.name,
      healthCheckTimeoutMs: 30,
      healthCheckIntervalMs: 5,
      healthRequestTimeoutMs: 5,
    });
    onTestFinished(() => runner.stop().catch(() => undefined));

    await expect(runner.start()).rejects.toThrow(/failed health check/i);
    expect(runner.isRunning()).toBe(false);
  });

  test("force kills a service that does not exit after SIGTERM", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();
    vi.useFakeTimers();

    try {
      killMock.mockImplementation((_pid, _signal, callback) =>
        callback?.(null),
      );
      const runner = new ServiceRunner({
        executableDir: fixture.dir,
        executableName: fixture.name,
        shutdownTimeoutMs: 20,
      });
      await runner.start();

      const stop = runner.stop();
      expect(killMock).toHaveBeenNthCalledWith(
        1,
        lastSpawnedChild?.pid,
        "SIGTERM",
        expect.any(Function),
      );

      await vi.advanceTimersByTimeAsync(19);
      expect(killMock).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(killMock).toHaveBeenNthCalledWith(
        2,
        lastSpawnedChild?.pid,
        "SIGKILL",
        expect.any(Function),
      );

      lastSpawnedChild?.emit("exit", null, "SIGKILL");
      await stop;
      expect(runner.isRunning()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not force kill a service that exits after SIGTERM", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();
    vi.useFakeTimers();

    try {
      killMock.mockImplementation((_pid, _signal, callback) =>
        callback?.(null),
      );
      const runner = new ServiceRunner({
        executableDir: fixture.dir,
        executableName: fixture.name,
        shutdownTimeoutMs: 20,
      });
      await runner.start();

      const stop = runner.stop();
      lastSpawnedChild?.emit("exit", null, "SIGTERM");
      await stop;
      await vi.advanceTimersByTimeAsync(20);

      expect(killMock).toHaveBeenCalledTimes(1);
      expect(killMock).toHaveBeenNthCalledWith(
        1,
        lastSpawnedChild?.pid,
        "SIGTERM",
        expect.any(Function),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("rejects if a force kill fails for a running service", async () => {
    const ServiceRunner = await loadServiceRunnerWithAvailablePort();
    const fixture = getExecutableFixture();
    vi.useFakeTimers();

    try {
      killMock.mockImplementation((_pid, signal, callback) => {
        if (signal === "SIGKILL") {
          callback?.(
            Object.assign(new Error("force kill failed"), { code: "EPERM" }),
          );
          return;
        }
        callback?.(null);
      });
      const runner = new ServiceRunner({
        executableDir: fixture.dir,
        executableName: fixture.name,
        shutdownTimeoutMs: 20,
      });
      await runner.start();

      const stop = runner.stop();
      const expectStop = expect(stop).rejects.toThrow("force kill failed");
      await vi.advanceTimersByTimeAsync(20);

      await expectStop;
      expect(lastSpawnedChild?.listenerCount("exit")).toBe(1);
      await vi.advanceTimersByTimeAsync(20);
      expect(killMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
