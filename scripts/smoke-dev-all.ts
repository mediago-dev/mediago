import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  CleanupGate,
  assertOwnedTemporaryRoot,
  attachSignalCleanup,
  boundedRedactedDiagnostic,
  cleanupOwnedRuntimeRoot,
  errorMessage,
  releaseChildProcessHandles,
  type CommandResult,
} from "./migration-verification-safety.ts";
import {
  PROCESSES_MARKER,
  RUNTIME_MARKER,
  StartupObservation,
  waitForReadiness,
} from "./smoke-dev-readiness.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const SMOKE_ROOT_PREFIX = "mediago-dev-smoke-";
const UI_PORTS = [8500, 8501] as const;

async function captureError(
  operation: () => Promise<void>,
  errors: string[],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(errorMessage(error));
  }
}
const LOOPBACK_HOST = "127.0.0.1";
const LOG_TAIL_BYTES = 16 * 1024;

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

function createClosePromise(child: ChildProcess): Promise<CommandResult> {
  return new Promise((resolve) => {
    child.once("error", (spawnError) =>
      resolve({ code: null, signal: null, spawnError }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function runSelfTests(): Promise<void> {
  const root = path.join(tmpdir(), `${SMOKE_ROOT_PREFIX}contract`);
  assertSafeSmokeRoot(root);
  assert.throws(() => assertSafeSmokeRoot(path.join(tmpdir(), "not-owned")));
  assertStartupMarkers(`${RUNTIME_MARKER} /tmp/deps\n${PROCESSES_MARKER}`);
  assert.throws(() =>
    assertStartupMarkers(`${PROCESSES_MARKER}\n${RUNTIME_MARKER} /tmp/deps`),
  );
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

  const root = mkdtempSync(path.join(tmpdir(), SMOKE_ROOT_PREFIX));
  assertSafeSmokeRoot(root);
  const observation = new StartupObservation();
  let ownedProcess:
    | {
        pid?: number;
        completion: Promise<CommandResult>;
        releaseHandles: () => void;
      }
    | undefined;
  const gate = new CleanupGate(() =>
    cleanupOwnedRuntimeRoot({
      root,
      prefix: SMOKE_ROOT_PREFIX,
      ownedProcess,
      platform: process.platform,
      windows: {
        systemRoot: process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "",
      },
    }),
  );
  const signals = attachSignalCleanup(gate, {
    reportError: (error) =>
      process.stderr.write(
        `cleanup before signal failed: ${boundedRedactedLogTail(errorMessage(error))}\n`,
      ),
  });
  let primaryError: unknown;
  const cleanupErrors: string[] = [];

  try {
    if (gate.started) throw new Error("Interrupted before dev:all launch");
    const command = process.platform === "linux" ? "xvfb-run" : "task";
    const args =
      process.platform === "linux" ? ["-a", "task", "dev:all"] : ["dev:all"];
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      detached: true,
      env: { ...process.env, MEDIAGO_DEPS_ROOT: root },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const closePromise = createClosePromise(child);
    ownedProcess = {
      pid: child.pid,
      completion: closePromise,
      releaseHandles: () => releaseChildProcessHandles(child),
    };
    let exitState: CommandResult | undefined;
    void closePromise.then((exit) => {
      exitState = exit;
    });
    child.stdout?.on("data", (chunk) => observation.append(chunk));
    child.stderr?.on("data", (chunk) => observation.append(chunk));
    await once(child, "spawn");
    await waitForReadiness(observation, closePromise, () => exitState);
  } catch (error) {
    primaryError = error;
  }

  await captureError(() => gate.run(), cleanupErrors);
  signals.dispose();
  await Promise.all(
    UI_PORTS.map((port) =>
      captureError(() => assertPortFree(port), cleanupErrors),
    ),
  );

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
