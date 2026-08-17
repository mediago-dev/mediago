import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { assertPortFree } from "./ports.ts";
import { startManagedProcess, type ManagedProcess } from "./process.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER_ENTRY = path.join(REPOSITORY_ROOT, "apps/server/build/index.js");

export interface ServerShutdownProbe {
  corePidRecorded: boolean;
  elapsedMs: number;
  executed: boolean;
  shutdownLogCount: number;
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

async function waitForProcessGroupExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // oxlint-disable-next-line no-await-in-loop -- Exact group liveness is polled until the cleanup deadline.
    await delay(Math.min(20, remaining));
  }
  return true;
}

async function waitForPidFile(filePath: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- The fake Core records its PID after ServiceRunner spawns it.
      const pid = Number.parseInt(await readFile(filePath, "utf8"), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // Retry until the fake Core has started.
    }
    // oxlint-disable-next-line no-await-in-loop -- Retry backoff intentionally follows each failed read.
    await delay(20);
  }
  throw new Error(`Core PID was not written to ${filePath}`);
}

function isolatedEnvironment(
  runtimeRoot: string,
  coreBin: string,
  corePidFile: string,
): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:http|https|all|ftp)_proxy$/i.test(key) ||
      /^no_proxy$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    APP_NAME: "MediaGo E2E",
    CORE_PID_FILE: corePidFile,
    MEDIAGO_CORE_BIN: coreBin,
    MEDIAGO_DEPS_DIR: path.join(runtimeRoot, "deps"),
    MEDIAGO_SERVER_ROOT: path.join(runtimeRoot, "server"),
    NO_PROXY: "localhost,127.0.0.1,::1",
    no_proxy: "localhost,127.0.0.1,::1",
  };
}

export async function probeServerStartupShutdown(): Promise<ServerShutdownProbe> {
  if (process.platform !== "linux") {
    return {
      corePidRecorded: false,
      elapsedMs: 0,
      executed: false,
      shutdownLogCount: 0,
    };
  }

  await assertPortFree("127.0.0.1", 9_900, "MediaGo Web Core");
  const runtimeRoot = await mkdtemp(
    path.join(tmpdir(), "mediago-server-shutdown-"),
  );
  const coreDirectory = path.join(runtimeRoot, "core");
  const coreBin = path.join(coreDirectory, "mediago-core");
  const corePidFile = path.join(runtimeRoot, "core.pid");
  let server: ManagedProcess | undefined;
  let corePid: number | undefined;
  let result: ServerShutdownProbe | undefined;
  let primaryError: unknown;

  try {
    await mkdir(path.join(runtimeRoot, "deps"), { recursive: true });
    await mkdir(coreDirectory, { recursive: true });
    await writeFile(path.join(coreDirectory, "config.json"), "{}\n");
    await writeFile(
      coreBin,
      [
        "#!/usr/bin/env node",
        'import { writeFileSync } from "node:fs";',
        "writeFileSync(process.env.CORE_PID_FILE, String(process.pid));",
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1_000);",
      ].join("\n"),
    );
    await chmod(coreBin, 0o755);

    server = await startManagedProcess({
      label: "MediaGo Server startup shutdown",
      command: process.execPath,
      args: [SERVER_ENTRY],
      cwd: REPOSITORY_ROOT,
      env: isolatedEnvironment(runtimeRoot, coreBin, corePidFile),
    });
    corePid = await waitForPidFile(corePidFile);
    if (!processGroupIsAlive(corePid)) {
      throw new Error("Fake Core exited before the shutdown probe");
    }

    const startedAt = Date.now();
    signalProcessGroup(server.pid, "SIGTERM");
    await delay(20);
    signalProcessGroup(server.pid, "SIGTERM");
    await server.stop();
    const elapsedMs = Date.now() - startedAt;
    const shutdownLogCount =
      server.logTail().match(/Shutting down/g)?.length ?? 0;

    if (elapsedMs >= 3_000) {
      throw new Error(`Server shutdown exceeded outer grace: ${elapsedMs} ms`);
    }
    if (processGroupIsAlive(corePid)) {
      throw new Error(`Core process group ${corePid} survived Server shutdown`);
    }
    if (shutdownLogCount !== 1) {
      throw new Error(
        `Expected one Server shutdown sequence, observed ${shutdownLogCount}`,
      );
    }
    result = {
      corePidRecorded: true,
      elapsedMs,
      executed: true,
      shutdownLogCount,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await server?.stop();
    } catch (error) {
      primaryError ??= error;
    }
    if (corePid !== undefined && processGroupIsAlive(corePid)) {
      try {
        signalProcessGroup(corePid, "SIGKILL");
      } catch (error) {
        primaryError ??= error;
      }
      if (!(await waitForProcessGroupExit(corePid, 2_000))) {
        primaryError ??= new Error(
          `Core process group ${corePid} survived probe cleanup`,
        );
      }
    }
    try {
      await rm(runtimeRoot, { recursive: true, force: true });
    } catch (error) {
      primaryError ??= error;
    }
  }

  if (primaryError) throw primaryError;
  if (!result) throw new Error("Server shutdown probe produced no result");
  return result;
}
