import { spawn, type ChildProcess } from "node:child_process";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const DEFAULT_TAIL_BYTES = 16 * 1024;
const DEFAULT_LINE_BYTES = 8 * 1024;
const CLEANUP_TIMEOUT_MS = 5_000;
const OVERSIZED_LINE = "[OVERSIZED LOG LINE DROPPED]\n";

export interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

export interface OwnedProcess {
  pid?: number;
  completion: Promise<CommandResult>;
  releaseHandles?: () => void;
}

export interface SignalTarget {
  on(signal: NodeJS.Signals, listener: () => void): void;
  off(signal: NodeJS.Signals, listener: () => void): void;
}

export interface WindowsTreeKill {
  completion: Promise<CommandResult>;
  terminate: () => void;
}

interface PosixCleanupOptions {
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface WindowsCleanupOptions {
  systemRoot: string;
  launch?: (command: string, args: string[]) => WindowsTreeKill;
  timeoutMs?: number;
}

function redactLine(value: string): string {
  return value
    .replace(
      /(\b(?:authorization|proxy-authorization|cookie|x-api-key|[a-z0-9_]*(?:token|secret|password|api_key)[a-z0-9_]*)\s*[:=]\s*)[^\r\n]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?apiKey["']?\s*[:=]\s*)(["'])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)(\2)/gi,
      "$1$2[REDACTED]$4",
    )
    .replace(/(["']?apiKey["']?\s*[:=]\s*)[^\s&,}"'\r\n]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(
      /\b(?:github_pat_|gh[opsu]_|sk-)[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    );
}

function byteTail(value: string, limit: number): string {
  const bytes = Buffer.from(value, "utf8");
  let result = bytes.subarray(Math.max(0, bytes.length - limit)).toString();
  while (Buffer.byteLength(result) > limit) result = result.slice(1);
  return result;
}

export class BoundedRedactedLog {
  private currentLine = "";
  private currentLineBytes = 0;
  private discardingLine = false;
  private sanitizedTail = "";
  private readonly lineBytes: number;
  private readonly tailBytes: number;

  constructor(options: { lineBytes?: number; tailBytes?: number } = {}) {
    this.lineBytes = options.lineBytes ?? DEFAULT_LINE_BYTES;
    this.tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES;
    if (this.lineBytes <= 0 || this.tailBytes <= 0) {
      throw new Error("Log bounds must be positive");
    }
  }

  append(chunk: unknown): void {
    const value = Buffer.isBuffer(chunk)
      ? chunk.toString("utf8")
      : String(chunk);
    let offset = 0;
    while (offset < value.length) {
      const newline = value.indexOf("\n", offset);
      const end = newline === -1 ? value.length : newline;
      this.appendLinePart(value.slice(offset, end));
      if (newline === -1) return;
      if (this.discardingLine) this.discardingLine = false;
      else this.finishLine();
      offset = newline + 1;
    }
  }

  diagnostic(limit = this.tailBytes): string {
    const incomplete = this.discardingLine ? "" : redactLine(this.currentLine);
    return byteTail(
      this.sanitizedTail + incomplete,
      Math.min(limit, this.tailBytes),
    );
  }

  private appendLinePart(value: string): void {
    if (this.discardingLine || value.length === 0) return;
    const bytes = Buffer.byteLength(value);
    if (this.currentLineBytes + bytes > this.lineBytes) {
      this.currentLine = "";
      this.currentLineBytes = 0;
      this.discardingLine = true;
      this.pushSanitized(OVERSIZED_LINE);
      return;
    }
    this.currentLine += value;
    this.currentLineBytes += bytes;
  }

  private finishLine(): void {
    this.pushSanitized(`${redactLine(this.currentLine)}\n`);
    this.currentLine = "";
    this.currentLineBytes = 0;
  }

  private pushSanitized(value: string): void {
    this.sanitizedTail = byteTail(this.sanitizedTail + value, this.tailBytes);
  }
}

export function boundedRedactedDiagnostic(
  value: string,
  limit = DEFAULT_TAIL_BYTES,
): string {
  const output = new BoundedRedactedLog({ tailBytes: limit });
  output.append(value);
  return output.diagnostic();
}

export function assertOwnedTemporaryRoot(root: string, prefix: string): void {
  if (
    path.dirname(root) !== tmpdir() ||
    !path.basename(root).startsWith(prefix)
  ) {
    throw new Error(
      `Refusing to remove an unowned temporary path; expected ${path.join(tmpdir(), `${prefix}*`)}`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function releaseChildProcessHandles(child: ChildProcess): void {
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}

export async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export class CleanupGate {
  private promise: Promise<void> | undefined;
  constructor(private readonly cleanup: () => Promise<void>) {}
  get started(): boolean {
    return this.promise !== undefined;
  }
  run(): Promise<void> {
    if (!this.promise) {
      try {
        this.promise = this.cleanup();
      } catch (error) {
        this.promise = Promise.reject(error);
      }
    }
    return this.promise;
  }
}

export function attachSignalCleanup(
  gate: CleanupGate,
  options: {
    target?: SignalTarget;
    reemit?: (signal: NodeJS.Signals) => void;
    reportError?: (error: unknown) => void;
  } = {},
): { dispose: () => void; signalHandled: Promise<NodeJS.Signals> } {
  const target = options.target ?? process;
  const reemit =
    options.reemit ?? ((signal) => process.kill(process.pid, signal));
  const reportError = options.reportError ?? (() => undefined);
  let handled = false;
  let resolveHandled!: (signal: NodeJS.Signals) => void;
  const signalHandled = new Promise<NodeJS.Signals>((resolve) => {
    resolveHandled = resolve;
  });
  const dispose = () => {
    target.off("SIGINT", onInterrupt);
    target.off("SIGTERM", onTerminate);
  };
  const handle = (signal: NodeJS.Signals) => {
    if (handled) return;
    handled = true;
    void gate
      .run()
      .catch(reportError)
      .finally(() => {
        dispose();
        try {
          reemit(signal);
        } finally {
          resolveHandled(signal);
        }
      });
  };
  const onInterrupt = () => handle("SIGINT");
  const onTerminate = () => handle("SIGTERM");
  target.on("SIGINT", onInterrupt);
  target.on("SIGTERM", onTerminate);
  return { dispose, signalHandled };
}

function isEsrch(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ESRCH";
}

export async function stopOwnedPosixProcessGroup(
  pid: number,
  completion: Promise<CommandResult>,
  options: PosixCleanupOptions = {},
): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0)
    throw new Error("Invalid process-group ID");
  const kill =
    options.kill ?? ((target, signal) => process.kill(target, signal));
  const now = options.now ?? Date.now;
  const pause = options.wait ?? ((milliseconds) => wait(milliseconds));
  const timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? 50;
  let gone = false;
  const invoke = (signal: NodeJS.Signals | 0) => {
    if (gone) return;
    try {
      kill(-pid, signal);
    } catch (error) {
      if (!isEsrch(error)) throw error;
      gone = true;
    }
  };
  const waitUntilGone = async (): Promise<boolean> => {
    const deadline = now() + timeoutMs;
    // oxlint-disable-next-line no-unmodified-loop-condition -- invoke() irreversibly flips gone on ESRCH.
    while (!gone && now() < deadline) {
      invoke(0);
      if (gone) break;
      // oxlint-disable-next-line no-await-in-loop -- Liveness polling is sequential and deadline-bounded.
      await pause(Math.min(pollMs, deadline - now()));
    }
    return gone;
  };

  invoke(0);
  if (!gone) invoke("SIGTERM");
  if (!gone && !(await waitUntilGone())) {
    invoke("SIGKILL");
    if (!gone && !(await waitUntilGone())) {
      throw new Error(`Owned process group ${pid} survived SIGKILL`);
    }
  }
  if (!(await settleWithin(completion, timeoutMs))) {
    throw new Error(`Process-group leader ${pid} did not close after cleanup`);
  }
}

export function windowsTaskkillCommand(
  pid: number,
  systemRoot: string,
): { command: string; args: string[] } {
  if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid process ID");
  if (!path.win32.isAbsolute(systemRoot)) {
    throw new Error("SystemRoot must be an absolute Windows path");
  }
  return {
    command: path.win32.join(systemRoot, "System32", "taskkill.exe"),
    args: ["/pid", String(pid), "/T", "/F"],
  };
}

function launchWindowsTreeKill(
  command: string,
  args: string[],
): WindowsTreeKill {
  const child = spawn(command, args, { shell: false, stdio: "ignore" });
  const completion = new Promise<CommandResult>((resolve) => {
    child.once("error", (spawnError) =>
      resolve({ code: null, signal: null, spawnError }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  return {
    completion,
    terminate: () => {
      child.kill();
      child.unref();
    },
  };
}

export async function stopOwnedWindowsProcessTree(
  pid: number,
  completion: Promise<CommandResult>,
  options: WindowsCleanupOptions,
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? CLEANUP_TIMEOUT_MS;
  const { command, args } = windowsTaskkillCommand(pid, options.systemRoot);
  const killer = (options.launch ?? launchWindowsTreeKill)(command, args);
  const result = await settleWithin(killer.completion, timeoutMs);
  if (!result) {
    killer.terminate();
    await settleWithin(killer.completion, timeoutMs);
    throw new Error(`taskkill timed out after ${timeoutMs} ms`);
  }
  if (result.spawnError)
    throw new Error(`taskkill spawn failed: ${result.spawnError.message}`);
  if (result.code !== 0)
    throw new Error(`taskkill exited with code ${result.code}`);
  if (!(await settleWithin(completion, timeoutMs))) {
    throw new Error("Original command did not close after taskkill");
  }
}

export async function cleanupOwnedRuntimeRoot(options: {
  root: string;
  prefix: string;
  ownedProcess?: OwnedProcess;
  platform: NodeJS.Platform;
  removeRoot?: (root: string) => Promise<void>;
  posix?: PosixCleanupOptions;
  windows?: WindowsCleanupOptions;
}): Promise<void> {
  assertOwnedTemporaryRoot(options.root, options.prefix);
  const ownedProcess = options.ownedProcess;
  const pid = ownedProcess?.pid;
  if (pid !== undefined && ownedProcess) {
    try {
      if (options.platform === "win32") {
        if (!options.windows)
          throw new Error("Windows cleanup options are missing");
        await stopOwnedWindowsProcessTree(
          pid,
          ownedProcess.completion,
          options.windows,
        );
      } else {
        await stopOwnedPosixProcessGroup(
          pid,
          ownedProcess.completion,
          options.posix,
        );
      }
    } catch (error) {
      let releaseFailure = "";
      try {
        ownedProcess.releaseHandles?.();
      } catch (releaseError) {
        releaseFailure = `; releasing child handles also failed: ${errorMessage(releaseError)}`;
      }
      throw new Error(
        `Owned process-tree exit could not be proven; runtime root retained at ${options.root}: ${errorMessage(error)}${releaseFailure}`,
        { cause: error },
      );
    }
  }
  assertOwnedTemporaryRoot(options.root, options.prefix);
  const removeRoot =
    options.removeRoot ??
    ((root) => rm(root, { recursive: true, force: true }));
  await removeRoot(options.root);
}
