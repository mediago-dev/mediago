import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
} from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  DownloadType,
  MediaGoClient,
  type Task,
  TaskStatus,
} from "@mediago/core-sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startMediaServer,
  type StartedMediaServer,
} from "../media-service/server";

interface FixtureFile {
  path: string;
  size: number;
  sha256: string;
}

interface FixtureManifest {
  schemaVersion: number;
  fixtureVersion: string;
  generator: {
    name: string;
    version: string;
  };
  files: FixtureFile[];
}

interface CoreProcessState {
  child: ChildProcess;
  stdout: string;
  stderr: string;
  spawnError?: Error;
}

interface FileSnapshot {
  relativePath: string;
  absolutePath: string;
  size: number;
}

const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CORE_SOURCE_DIR = path.join(REPOSITORY_ROOT, "apps/core");
const MANIFEST_PATH = path.join(
  REPOSITORY_ROOT,
  "tests/media-service/public/v1/manifest.json",
);
const DIRECT_TASK_ID = "integration-direct-download";
const DIRECT_NAME = "integration-direct-sample";
const HLS_TASK_ID = "integration-hls-download";
const HLS_NAME = "integration-hls:sample";
const HLS_SANITIZED_NAME = "integration-hls_sample";
const CORE_STARTUP_TIMEOUT_MS = 8_000;
const DIRECT_TIMEOUT_MS = 30_000;
const HLS_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 100;
const LOG_TAIL_LIMIT = 16_000;
const MEDIA_EXTENSIONS = new Set([
  ".3g2",
  ".3gp",
  ".aac",
  ".avi",
  ".f4a",
  ".f4b",
  ".f4p",
  ".f4v",
  ".flv",
  ".m4a",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".rmvb",
  ".ts",
  ".webm",
  ".wmv",
]);

let dependencyDirectory = "";
let ffmpegPath = "";
let temporaryRoot = "";
let configDirectory = "";
let logDirectory = "";
let downloadDirectory = "";
let buildDirectory = "";
let coreBinaryPath = "";
let fixtureManifest: FixtureManifest;
let mediaBaseURL = "";
let localMediaServer: StartedMediaServer | undefined;
let coreProcess: CoreProcessState | undefined;
let coreClient: MediaGoClient | undefined;
const archivedCoreLogs: string[] = [];

function appendTail(current: string, chunk: unknown): string {
  const next = current + String(chunk);
  return next.slice(-LOG_TAIL_LIMIT);
}

function redactSecrets(value: string): string {
  return value
    .replace(
      /(authorization|proxy-authorization|cookie)(\s*[:=]\s*)[^\r\n]*/gi,
      "$1$2[REDACTED]",
    )
    .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, "$1[REDACTED]@");
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message).slice(-4_000);
}

function safeMediaLocation(): string {
  if (!mediaBaseURL) return "<media base not configured>";
  try {
    const url = new URL(mediaBaseURL);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid media base URL>";
  }
}

function currentCoreLogTail(): string {
  const sections = [...archivedCoreLogs];
  if (coreProcess) {
    sections.push(formatCoreProcessLog(coreProcess));
  }
  const combined = sections.filter(Boolean).join("\n");
  return redactSecrets(combined).slice(-LOG_TAIL_LIMIT) || "<no core output>";
}

function formatCoreProcessLog(state: CoreProcessState): string {
  const exit =
    state.child.exitCode === null
      ? `signal=${state.child.signalCode ?? "running"}`
      : `exit=${state.child.exitCode}`;
  const spawnFailure = state.spawnError
    ? `\nspawn error: ${boundedError(state.spawnError)}`
    : "";
  return [
    `core ${exit}${spawnFailure}`,
    `stdout:\n${state.stdout || "<empty>"}`,
    `stderr:\n${state.stderr || "<empty>"}`,
  ].join("\n");
}

function scenarioFailure(
  scenario: string,
  taskID: string,
  error: unknown,
): Error {
  return new Error(
    [
      `scenario: ${scenario}`,
      `task: ${taskID}`,
      `media origin/path: ${safeMediaLocation()}`,
      `final error: ${boundedError(error)}`,
      `bounded core logs:\n${currentCoreLogTail()}`,
    ].join("\n"),
  );
}

async function assertDependencyPreconditions(): Promise<void> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      `Media integration precondition failed: this first version supports only linux-x64; received ${process.platform}-${process.arch}`,
    );
  }

  dependencyDirectory = path.join(REPOSITORY_ROOT, ".deps/linux-x64");
  const dependencyPaths = [
    path.join(dependencyDirectory, "aria2c"),
    path.join(dependencyDirectory, "N_m3u8DL-RE"),
    path.join(dependencyDirectory, "ffmpeg"),
  ];
  const unavailable: string[] = [];

  await Promise.all(
    dependencyPaths.map(async (dependencyPath) => {
      try {
        const info = await stat(dependencyPath);
        if (!info.isFile() || info.size === 0) {
          unavailable.push(path.basename(dependencyPath));
          return;
        }
        await access(dependencyPath, constants.X_OK);
      } catch {
        unavailable.push(path.basename(dependencyPath));
      }
    }),
  );

  if (unavailable.length > 0) {
    throw new Error(
      `Media integration precondition failed for linux-x64: missing or non-executable dependencies: ${unavailable.toSorted().join(", ")}. Run "pnpm test:integration:media:setup" first.`,
    );
  }

  ffmpegPath = path.join(dependencyDirectory, "ffmpeg");
}

function getManifestFile(
  manifest: FixtureManifest,
  filePath: string,
): FixtureFile {
  const file = manifest.files.find((candidate) => candidate.path === filePath);
  if (!file) {
    throw new Error(`Committed media manifest is missing ${filePath}`);
  }
  return file;
}

async function loadCommittedManifest(): Promise<FixtureManifest> {
  return JSON.parse(await readFile(MANIFEST_PATH, "utf8")) as FixtureManifest;
}

async function runExecutable(
  command: string,
  args: string[],
  options: { cwd?: string; timeout: number; label: string },
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        encoding: "utf8",
        maxBuffer: 128 * 1024,
        timeout: options.timeout,
      },
      (error, stdout, stderr) => {
        if (!error) {
          resolve();
          return;
        }
        reject(
          new Error(
            [
              `${options.label} failed: ${error.message}`,
              `stdout: ${String(stdout).slice(-4_000) || "<empty>"}`,
              `stderr: ${String(stderr).slice(-4_000) || "<empty>"}`,
            ].join("\n"),
          ),
        );
      },
    );
  });
}

async function createTemporaryLayoutAndBuildCore(): Promise<void> {
  temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "mediago-media-integration-"),
  );
  configDirectory = path.join(temporaryRoot, "config");
  logDirectory = path.join(temporaryRoot, "log");
  downloadDirectory = path.join(temporaryRoot, "download");
  buildDirectory = path.join(temporaryRoot, "build");
  await Promise.all(
    [configDirectory, logDirectory, downloadDirectory, buildDirectory].map(
      (directory) => mkdir(directory),
    ),
  );

  coreBinaryPath = path.join(buildDirectory, "mediago-core");
  await runExecutable("go", ["build", "-o", coreBinaryPath, "./cmd/server"], {
    cwd: CORE_SOURCE_DIR,
    timeout: 60_000,
    label: "go build of current apps/core source",
  });
}

async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    server.close();
    throw new Error("Temporary loopback listener did not provide a port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function spawnCore(port: number): CoreProcessState {
  const child = spawn(
    coreBinaryPath,
    [
      "--port",
      String(port),
      "--deps-dir",
      dependencyDirectory,
      "--local-dir",
      downloadDirectory,
      "--config-dir",
      configDirectory,
      "--log-dir",
      logDirectory,
      "--max-runner",
      "1",
      "--log-level",
      "error",
    ],
    {
      cwd: CORE_SOURCE_DIR,
      detached: true,
      env: { ...process.env, HOST: "127.0.0.1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const state: CoreProcessState = { child, stdout: "", stderr: "" };
  child.stdout?.on("data", (chunk) => {
    state.stdout = appendTail(state.stdout, chunk);
  });
  child.stderr?.on("data", (chunk) => {
    state.stderr = appendTail(state.stderr, chunk);
  });
  child.once("error", (error) => {
    state.spawnError = error;
  });
  return state;
}

async function waitForHealthy(
  client: MediaGoClient,
  state: CoreProcessState,
): Promise<void> {
  const deadline = Date.now() + CORE_STARTUP_TIMEOUT_MS;
  let lastError = "health endpoint was not ready";

  while (Date.now() < deadline) {
    if (state.spawnError) throw state.spawnError;
    if (state.child.exitCode !== null || state.child.signalCode !== null) {
      throw new Error(
        `Core exited before becoming healthy (${state.child.exitCode ?? state.child.signalCode})`,
      );
    }
    try {
      const health = await client.health();
      if (health.success && health.data.status === "ok") return;
      lastError = `health returned success=${health.success} status=${health.data.status}`;
    } catch (error) {
      lastError = boundedError(error);
    }

    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await delay(Math.min(POLL_INTERVAL_MS, remaining));
    }
  }
  throw new Error(
    `Core health deadline exceeded after ${CORE_STARTUP_TIMEOUT_MS}ms: ${lastError}`,
  );
}

function isProcessGroupAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalProcessGroup(
  state: CoreProcessState,
  signal: NodeJS.Signals,
): void {
  const pid = state.child.pid;
  if (pid === undefined) return;
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      state.child.kill(signal);
    }
  }
}

async function waitForCoreShutdown(
  state: CoreProcessState,
  timeout: number,
): Promise<boolean> {
  const pid = state.child.pid;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const childExited =
      state.spawnError !== undefined ||
      state.child.exitCode !== null ||
      state.child.signalCode !== null;
    const groupExited = pid === undefined || !isProcessGroupAlive(pid);
    if (childExited && groupExited) return true;
    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await delay(Math.min(50, remaining));
    }
  }
  return false;
}

async function stopCore(): Promise<void> {
  const state = coreProcess;
  coreClient = undefined;
  if (!state) return;

  try {
    signalProcessGroup(state, "SIGTERM");
    const stopped = await waitForCoreShutdown(state, 3_000);
    if (!stopped) {
      signalProcessGroup(state, "SIGKILL");
      if (!(await waitForCoreShutdown(state, 2_000))) {
        throw new Error("Core process group did not exit after SIGKILL");
      }
    }
  } finally {
    coreProcess = undefined;
    const combinedLogs = [...archivedCoreLogs, formatCoreProcessLog(state)]
      .join("\n")
      .slice(-LOG_TAIL_LIMIT);
    archivedCoreLogs.splice(0, archivedCoreLogs.length, combinedLogs);
  }
}

async function startCoreWithOneRetry(): Promise<void> {
  const failures: string[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const port = await reserveLoopbackPort();
    const state = spawnCore(port);
    coreProcess = state;
    const client = new MediaGoClient({
      baseURL: `http://127.0.0.1:${port}`,
    });
    client.api.defaults.timeout = 1_000;
    try {
      await waitForHealthy(client, state);
      coreClient = client;
      return;
    } catch (error) {
      failures.push(`attempt ${attempt}: ${boundedError(error)}`);
      await stopCore();
    }
  }
  throw new Error(
    `Core did not become healthy after one retry: ${failures.join(" | ")}`,
  );
}

function requireCoreClient(): MediaGoClient {
  if (!coreClient) throw new Error("Core client is not initialized");
  return coreClient;
}

async function waitForTerminalTask(
  taskID: string,
  timeout: number,
): Promise<Task> {
  const deadline = Date.now() + timeout;
  let lastState = "task was not observed";

  while (Date.now() < deadline) {
    try {
      const response = await requireCoreClient().getTask(taskID);
      if (!response.success) {
        lastState = `API success=false message=${response.message}`;
      } else {
        const task = response.data;
        lastState = `status=${task.status} error=${task.error ?? "<none>"}`;
        if (
          task.status === TaskStatus.Success ||
          task.status === TaskStatus.Failed ||
          task.status === TaskStatus.Stopped
        ) {
          return task;
        }
      }
    } catch (error) {
      lastState = boundedError(error);
    }

    const remaining = deadline - Date.now();
    if (remaining > 0) {
      await delay(Math.min(POLL_INTERVAL_MS, remaining));
    }
  }
  throw new Error(`Task deadline exceeded after ${timeout}ms; ${lastState}`);
}

function requireSuccessfulTask(task: Task): void {
  if (task.status !== TaskStatus.Success) {
    throw new Error(
      `Task ended with status=${task.status}; task error=${task.error ?? "<none>"}`,
    );
  }
  expect(task.status).toBe(TaskStatus.Success);
}

async function snapshotFiles(
  directory: string,
  root = directory,
): Promise<Map<string, FileSnapshot>> {
  const result = new Map<string, FileSnapshot>();
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await snapshotFiles(absolutePath, root);
      for (const [relativePath, file] of nested) {
        result.set(relativePath, file);
      }
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(absolutePath);
    const relativePath = path.relative(root, absolutePath);
    result.set(relativePath, { relativePath, absolutePath, size: info.size });
  }
  return result;
}

async function cleanupResources(): Promise<string[]> {
  const errors: string[] = [];
  try {
    await stopCore();
  } catch (error) {
    errors.push(`stop Core: ${boundedError(error)}`);
  }

  const mediaServer = localMediaServer;
  localMediaServer = undefined;
  if (mediaServer) {
    try {
      await mediaServer.close();
    } catch (error) {
      errors.push(`close local media server: ${boundedError(error)}`);
    }
  }

  if (temporaryRoot) {
    const rootToRemove = temporaryRoot;
    temporaryRoot = "";
    const expectedParent = path.resolve(tmpdir());
    if (
      path.dirname(path.resolve(rootToRemove)) !== expectedParent ||
      !path.basename(rootToRemove).startsWith("mediago-media-integration-")
    ) {
      errors.push("refused to remove an unexpected temporary root");
    } else {
      try {
        await rm(rootToRemove, { recursive: true, force: true });
      } catch (error) {
        errors.push(`remove temporary root: ${boundedError(error)}`);
      }
    }
  }
  return errors;
}

describe.sequential("real SDK to Core media downloads", () => {
  beforeAll(async () => {
    try {
      await assertDependencyPreconditions();
      fixtureManifest = await loadCommittedManifest();
      localMediaServer = await startMediaServer();
      mediaBaseURL = localMediaServer.baseURL;
      await createTemporaryLayoutAndBuildCore();
      await startCoreWithOneRetry();
    } catch (error) {
      const cleanupErrors = await cleanupResources();
      const combinedError =
        cleanupErrors.length === 0
          ? error
          : new Error(
              `${boundedError(error)}; cleanup errors: ${cleanupErrors.join("; ")}`,
            );
      throw scenarioFailure("setup", "n/a", combinedError);
    }
  });

  afterAll(async () => {
    const cleanupErrors = await cleanupResources();
    if (cleanupErrors.length > 0) {
      throw scenarioFailure("cleanup", "n/a", cleanupErrors.join("; "));
    }
  });

  it("downloads the committed MP4 through the SDK and Direct runner", async () => {
    try {
      const createResponse = await requireCoreClient().createTask({
        id: DIRECT_TASK_ID,
        type: DownloadType.Direct,
        url: `${mediaBaseURL}/sample.mp4`,
        name: DIRECT_NAME,
      });
      expect(createResponse.success).toBe(true);
      expect(createResponse.data.id).toBe(DIRECT_TASK_ID);

      const task = await waitForTerminalTask(DIRECT_TASK_ID, DIRECT_TIMEOUT_MS);
      requireSuccessfulTask(task);

      const expected = getManifestFile(fixtureManifest, "sample.mp4");
      const outputPath = path.join(downloadDirectory, `${DIRECT_NAME}.mp4`);
      const output = await readFile(outputPath);
      const outputStat = await stat(outputPath);
      expect(outputStat.size).toBe(expected.size);
      expect(createHash("sha256").update(output).digest("hex")).toBe(
        expected.sha256,
      );
    } catch (error) {
      throw scenarioFailure("Direct", DIRECT_TASK_ID, error);
    }
  });

  it("downloads and fully decodes the committed HLS fixture", async () => {
    try {
      const before = await snapshotFiles(downloadDirectory);
      const createResponse = await requireCoreClient().createTask({
        id: HLS_TASK_ID,
        type: DownloadType.M3U8,
        url: `${mediaBaseURL}/hls/index.m3u8`,
        name: HLS_NAME,
      });
      expect(createResponse.success).toBe(true);
      expect(createResponse.data.id).toBe(HLS_TASK_ID);

      const task = await waitForTerminalTask(HLS_TASK_ID, HLS_TIMEOUT_MS);
      requireSuccessfulTask(task);

      const after = await snapshotFiles(downloadDirectory);
      const candidates = [...after.values()]
        .filter(
          (file) =>
            !before.has(file.relativePath) &&
            path.basename(file.relativePath).startsWith(HLS_SANITIZED_NAME) &&
            file.size > 0 &&
            MEDIA_EXTENSIONS.has(
              path.extname(file.relativePath).toLocaleLowerCase(),
            ),
        )
        .toSorted((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        );
      if (candidates.length === 0) {
        throw new Error(
          `No new non-empty media output started with ${HLS_SANITIZED_NAME}`,
        );
      }

      await runExecutable(
        ffmpegPath,
        ["-v", "error", "-i", candidates[0].absolutePath, "-f", "null", "-"],
        { timeout: 15_000, label: "ffmpeg full decode of HLS output" },
      );
    } catch (error) {
      throw scenarioFailure("HLS", HLS_TASK_ID, error);
    }
  });
});
