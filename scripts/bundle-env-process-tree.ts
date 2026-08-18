import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";

type KillProcess = (pid: number, signal?: NodeJS.Signals | number) => boolean;

export function createWindowsTreeKillCommand(options: {
  environment: NodeJS.ProcessEnv;
  pid: number;
}): { args: string[]; command: string } {
  if (!Number.isSafeInteger(options.pid) || options.pid <= 0) {
    throw new Error(`Process tree PID must be positive: ${options.pid}`);
  }
  const systemRoot = options.environment.SystemRoot;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new Error(
      `Windows process-tree cleanup requires an absolute SystemRoot: ${String(systemRoot)}`,
    );
  }
  const command = path.win32.join(systemRoot, "System32", "taskkill.exe");
  if (!path.win32.isAbsolute(command)) {
    throw new Error(`taskkill.exe path must be absolute: ${command}`);
  }
  return {
    args: ["/PID", String(options.pid), "/T", "/F"],
    command,
  };
}

function processGroupIsAlive(pid: number, killProcess: KillProcess): boolean {
  try {
    killProcess(-pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function signalProcessGroup(
  pid: number,
  signal: NodeJS.Signals,
  killProcess: KillProcess,
): void {
  try {
    killProcess(-pid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(
  pid: number,
  timeoutMs: number,
  killProcess: KillProcess,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid, killProcess)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // oxlint-disable-next-line no-await-in-loop -- Process-group liveness must be checked after each bounded delay.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, Math.min(25, remaining));
    });
  }
  return true;
}

async function terminatePosixProcessGroup(options: {
  killProcess: KillProcess;
  pid: number;
  timeoutMs: number;
}): Promise<void> {
  signalProcessGroup(options.pid, "SIGTERM", options.killProcess);
  if (
    await waitForProcessGroupExit(
      options.pid,
      options.timeoutMs,
      options.killProcess,
    )
  ) {
    return;
  }

  signalProcessGroup(options.pid, "SIGKILL", options.killProcess);
  if (
    await waitForProcessGroupExit(
      options.pid,
      options.timeoutMs,
      options.killProcess,
    )
  ) {
    return;
  }
  throw new Error(
    `Process group ${options.pid} still exists after SIGKILL; expected ESRCH within ${options.timeoutMs * 2} ms`,
  );
}

async function runWindowsTreeKill(
  environment: NodeJS.ProcessEnv,
  pid: number,
): Promise<void> {
  const launcher = createWindowsTreeKillCommand({ environment, pid });
  await new Promise<void>((resolve, reject) => {
    const killer = spawn(launcher.command, launcher.args, {
      env: environment,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    killer.once("error", reject);
    killer.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${launcher.command} ${launcher.args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }`,
        ),
      );
    });
  });
}

export async function terminateProcessTree(
  child: ChildProcess | undefined,
  options: {
    environment?: NodeJS.ProcessEnv;
    killProcess?: KillProcess;
    platform?: NodeJS.Platform;
    timeoutMs?: number;
  } = {},
): Promise<void> {
  const pid = child?.pid;
  if (!pid) return;
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await runWindowsTreeKill(options.environment ?? process.env, pid);
    return;
  }
  await terminatePosixProcessGroup({
    killProcess:
      options.killProcess ??
      ((target, signal) => process.kill(target, signal as NodeJS.Signals)),
    pid,
    timeoutMs: options.timeoutMs ?? 5_000,
  });
}
