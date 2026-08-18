import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import {
  BoundedTail,
  assertOwnedTemporaryRoot,
  boundedRedactedDiagnostic,
  captureError,
  errorMessage,
  settleWithin,
} from "./verify-isolated-runtime-deps.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const SMOKE_ROOT_PREFIX = "mediago-dev-smoke-";
const UI_PORTS = [8500, 8501] as const;
const LOOPBACK_HOST = "127.0.0.1";
const RUNTIME_MARKER = "MEDIAGO_RUNTIME_READY";
const PROCESSES_MARKER = "MEDIAGO_DEV_PROCESSES_STARTING";
const CORE_MARKER = "Go Core started at";
const LOG_TAIL_BYTES = 16 * 1024;
const MARKER_CARRY_LENGTH = PROCESSES_MARKER.length;
const STARTUP_TIMEOUT_MS = 120_000;
const GROUP_EXIT_TIMEOUT_MS = 5_000;

interface ExitState {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

class StartupObservation {
  runtimeReady = false;
  processesStarting = false;
  coreStarted = false;
  invalidMarkerOrder = false;
  private markerCarry = "";
  private readonly logs = new BoundedTail();

  append(chunk: unknown): void {
    const value = String(chunk);
    this.logs.append(value);
    const combined = this.markerCarry + value;
    this.observeMarkers(combined);
    this.markerCarry = combined.slice(-MARKER_CARRY_LENGTH);
  }

  diagnostic(limit = LOG_TAIL_BYTES): string {
    return this.logs.diagnostic(limit);
  }

  private observeMarkers(value: string): void {
    if (!this.runtimeReady) {
      const runtimeIndex = value.indexOf(RUNTIME_MARKER);
      const processesIndex = value.indexOf(PROCESSES_MARKER);
      if (
        processesIndex !== -1 &&
        (runtimeIndex === -1 || processesIndex < runtimeIndex)
      ) {
        this.invalidMarkerOrder = true;
      }
      if (runtimeIndex !== -1) {
        this.runtimeReady = true;
        if (processesIndex > runtimeIndex) this.processesStarting = true;
      }
    } else if (!this.processesStarting && value.includes(PROCESSES_MARKER)) {
      this.processesStarting = true;
    }
    if (!this.coreStarted && value.includes(CORE_MARKER)) {
      this.coreStarted = true;
    }
  }
}

export function assertSafeSmokeRoot(root: string): void {
  assertOwnedTemporaryRoot(root, SMOKE_ROOT_PREFIX);
}

export function assertStartupMarkers(output: string): void {
  const runtimeIndex = output.indexOf(RUNTIME_MARKER);
  const processesIndex = output.indexOf(PROCESSES_MARKER);
  if (runtimeIndex === -1 || processesIndex === -1) {
    throw new Error("dev:all startup output is missing a readiness marker");
  }
  if (runtimeIndex >= processesIndex) {
    throw new Error("dev:all startup markers are out of order");
  }
}

export function boundedRedactedLogTail(value: string): string {
  return boundedRedactedDiagnostic(value, LOG_TAIL_BYTES);
}

export async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", (error: NodeJS.ErrnoException) => {
      reject(
        new Error(
          `dev:all smoke requires free port ${port} on ${LOOPBACK_HOST}, but it is unavailable (${error.code ?? "UNKNOWN"})`,
          { cause: error },
        ),
      );
    });
    server.once("listening", () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    server.listen(port, LOOPBACK_HOST);
  });
}

function processGroupIsAlive(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // oxlint-disable-next-line no-await-in-loop -- Liveness polling is bounded by one cleanup deadline.
    await delay(Math.min(50, remaining));
  }
  return true;
}

async function awaitBoundedChildClose(
  closePromise: Promise<ExitState>,
): Promise<void> {
  if (!(await settleWithin(closePromise, GROUP_EXIT_TIMEOUT_MS))) {
    throw new Error("dev:all process-group leader did not close after cleanup");
  }
}

export async function stopOwnedProcessGroup(
  pid: number,
  closePromise: Promise<ExitState>,
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Refusing to signal an invalid process-group ID");
  }
  signalProcessGroup(pid, "SIGTERM");
  if (!(await waitForProcessGroupExit(pid, GROUP_EXIT_TIMEOUT_MS))) {
    signalProcessGroup(pid, "SIGKILL");
    if (!(await waitForProcessGroupExit(pid, GROUP_EXIT_TIMEOUT_MS))) {
      throw new Error(`Owned process group ${pid} survived SIGKILL`);
    }
  }
  await awaitBoundedChildClose(closePromise);
  if (processGroupIsAlive(pid)) {
    throw new Error(`Owned process group ${pid} still exists after cleanup`);
  }
}

function createClosePromise(child: ChildProcess): Promise<ExitState> {
  return new Promise<ExitState>((resolve) => {
    child.once("error", (spawnError) =>
      resolve({ code: null, signal: null, spawnError }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function probeHTTP(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 500);
  timer.unref();
  try {
    const response = await fetch(`http://${LOOPBACK_HOST}:${port}/`, {
      signal: controller.signal,
    });
    await response.body?.cancel();
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function formatExit(exit: ExitState): string {
  if (exit.spawnError) return `spawn failed: ${exit.spawnError.message}`;
  return exit.code === null
    ? `terminated by ${exit.signal ?? "an unknown signal"}`
    : `exited with code ${exit.code}`;
}

async function waitForReadiness(
  observation: StartupObservation,
  closePromise: Promise<ExitState>,
  readExitState: () => ExitState | undefined,
): Promise<void> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;
  let httpReady = new Map<number, boolean>(
    UI_PORTS.map((port) => [port, false]),
  );
  while (Date.now() < deadline) {
    if (observation.invalidMarkerOrder) {
      throw new Error(
        "dev:all printed its process marker before runtime readiness",
      );
    }
    const exit = readExitState();
    if (exit) throw new Error(`dev:all ${formatExit(exit)} before readiness`);

    const pendingPorts = UI_PORTS.filter((port) => !httpReady.get(port));
    if (pendingPorts.length > 0) {
      // oxlint-disable-next-line no-await-in-loop -- Each bounded round probes only ports still pending.
      const results = await Promise.all(
        pendingPorts.map(
          async (port) => [port, await probeHTTP(port)] as const,
        ),
      );
      httpReady = new Map([...httpReady, ...results]);
    }
    if (
      observation.runtimeReady &&
      observation.processesStarting &&
      observation.coreStarted &&
      UI_PORTS.every((port) => httpReady.get(port))
    ) {
      return;
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    // This bounded timer races process exit so failures do not wait for the deadline.
    // oxlint-disable-next-line no-await-in-loop -- Sequential readiness rounds enforce one deadline.
    await Promise.race([delay(Math.min(100, remaining)), closePromise]);
  }

  const missing = [
    !observation.runtimeReady && RUNTIME_MARKER,
    !observation.processesStarting && PROCESSES_MARKER,
    !observation.coreStarted && CORE_MARKER,
    ...UI_PORTS.filter((port) => !httpReady.get(port)).map(
      (port) => `HTTP ${port}`,
    ),
  ].filter(Boolean);
  throw new Error(
    `dev:all readiness timed out after ${STARTUP_TIMEOUT_MS} ms; missing: ${missing.join(", ")}`,
  );
}

async function runSelfTests(): Promise<void> {
  const root = path.join(tmpdir(), `${SMOKE_ROOT_PREFIX}contract`);
  assertSafeSmokeRoot(root);
  assert.throws(() => assertSafeSmokeRoot(path.join(tmpdir(), "not-owned")));
  assertStartupMarkers(`${RUNTIME_MARKER} /tmp/deps\n${PROCESSES_MARKER}`);
  assert.throws(() =>
    assertStartupMarkers(`${PROCESSES_MARKER}\n${RUNTIME_MARKER} /tmp/deps`),
  );

  const tail = boundedRedactedLogTail(
    `${"x".repeat(20_000)}\nCookie: session-secret\napiKey=top-secret`,
  );
  assert.ok(Buffer.byteLength(tail) <= LOG_TAIL_BYTES);
  assert.doesNotMatch(tail, /session-secret|top-secret/);

  if (process.platform !== "win32") {
    const child = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: true, shell: false, stdio: "ignore" },
    );
    const closePromise = createClosePromise(child);
    await once(child, "spawn");
    const pid = child.pid;
    assert.ok(pid !== undefined && processGroupIsAlive(pid));
    try {
      await stopOwnedProcessGroup(pid, closePromise);
    } finally {
      if (processGroupIsAlive(pid)) signalProcessGroup(pid, "SIGKILL");
    }
    assert.equal(processGroupIsAlive(pid), false);
  }
  process.stdout.write("PASS smoke-dev-all self-test\n");
}

async function main(): Promise<void> {
  if (process.platform === "win32") {
    process.stdout.write(
      `${JSON.stringify({ status: "SKIP", check: "smoke-dev-all", platform: "win32", reason: "POSIX detached process-group ownership cannot be verified" })}\n`,
    );
    return;
  }
  if (process.platform !== "linux" && process.platform !== "darwin") {
    throw new Error(`Unsupported smoke-test platform: ${process.platform}`);
  }
  await Promise.all(UI_PORTS.map((port) => assertPortFree(port)));

  const root = await mkdtemp(path.join(tmpdir(), SMOKE_ROOT_PREFIX));
  assertSafeSmokeRoot(root);
  const observation = new StartupObservation();
  let child: ChildProcess | undefined;
  let closePromise: Promise<ExitState> | undefined;
  let exitState: ExitState | undefined;
  let primaryError: unknown;
  const cleanupErrors: string[] = [];

  try {
    const command = process.platform === "linux" ? "xvfb-run" : "task";
    const args =
      process.platform === "linux" ? ["-a", "task", "dev:all"] : ["dev:all"];
    child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: true,
      env: { ...process.env, MEDIAGO_DEPS_ROOT: root },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    closePromise = createClosePromise(child);
    void closePromise.then((exit) => {
      exitState = exit;
    });
    child.stdout?.on("data", (chunk) => observation.append(chunk));
    child.stderr?.on("data", (chunk) => observation.append(chunk));
    await once(child, "spawn");
    await waitForReadiness(observation, closePromise, () => exitState);
  } catch (error) {
    primaryError = error;
  } finally {
    const pid = child?.pid;
    if (pid !== undefined && closePromise !== undefined) {
      const ownedClose = closePromise;
      await captureError(
        () => stopOwnedProcessGroup(pid, ownedClose),
        cleanupErrors,
      );
    }
    await captureError(async () => {
      assertSafeSmokeRoot(root);
      await rm(root, { recursive: true, force: true });
    }, cleanupErrors);
    await Promise.all(
      UI_PORTS.map((port) =>
        captureError(() => assertPortFree(port), cleanupErrors),
      ),
    );
  }
  if (primaryError || cleanupErrors.length > 0) {
    const failure = boundedRedactedDiagnostic(
      errorMessage(
        primaryError ?? "dev:all readiness succeeded but cleanup failed",
      ),
      2 * 1024,
    );
    const cleanup =
      cleanupErrors.length === 0
        ? ""
        : `\ncleanup: ${boundedRedactedDiagnostic(cleanupErrors.join("; "), 2 * 1024)}`;
    const logs = observation.diagnostic(10 * 1024);
    throw new Error(
      boundedRedactedLogTail(
        `reason: ${failure}${cleanup}\nlog-tail:\n${logs || "<no captured output>"}`,
      ),
    );
  }
  process.stdout.write(
    "PASS smoke-dev-all markers=ordered http=8500,8501 core=ready cleanup=complete\n",
  );
}
const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) {
  (process.argv.includes("--self-test") ? runSelfTests() : main()).catch(
    (error: unknown) => {
      const diagnostic = boundedRedactedLogTail(errorMessage(error));
      process.stderr.write(`FAIL smoke-dev-all\n${diagnostic}\n`);
      process.exitCode = 1;
    },
  );
}
