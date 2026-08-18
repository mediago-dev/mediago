import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import type { DependencyManifestEntry } from "./dependency-layout.ts";
import {
  BoundedRedactedLog,
  CleanupGate,
  attachSignalCleanup,
  cleanupOwnedRuntimeRoot,
  stopOwnedPosixProcessGroup,
  stopOwnedWindowsProcessTree,
  windowsTaskkillCommand,
  type CommandResult,
  type SignalTarget,
  type WindowsTreeKill,
} from "./migration-verification-safety.ts";
import { assertBBDownExecutableNames } from "./verify-isolated-runtime-deps.ts";

const closed: CommandResult = { code: null, signal: "SIGTERM" };

function esrch(): NodeJS.ErrnoException {
  return Object.assign(new Error("process group is gone"), { code: "ESRCH" });
}

function signalTarget(emitter: EventEmitter): SignalTarget {
  return {
    on(signal, listener) {
      emitter.on(signal, listener);
    },
    off(signal, listener) {
      emitter.off(signal, listener);
    },
  };
}

function windowsKill(
  completion: Promise<CommandResult>,
  terminate = vi.fn(),
): WindowsTreeKill {
  return { completion, terminate };
}

describe("bounded streaming diagnostics", () => {
  test("drops an oversized Authorization line from one chunk", () => {
    const output = new BoundedRedactedLog({ lineBytes: 32, tailBytes: 128 });
    output.append(`Authorization: ${"x".repeat(100)}tail-secret\nordinary\n`);

    expect(output.diagnostic()).toContain("[OVERSIZED LOG LINE DROPPED]");
    expect(output.diagnostic()).toContain("ordinary");
    expect(output.diagnostic()).not.toContain("tail-secret");
  });

  test("discards an oversized secret line across chunks until newline", () => {
    const output = new BoundedRedactedLog({ lineBytes: 24, tailBytes: 128 });
    output.append("Author");
    output.append("ization: ");
    output.append("x".repeat(40));
    output.append("cross-chunk-secret");
    output.append("\nnext-line\n");

    expect(output.diagnostic()).not.toContain("cross-chunk-secret");
    expect(output.diagnostic()).toContain("next-line");
  });

  test("redacts a secret line exactly at the complete-line boundary", () => {
    const line = "Authorization: boundary-secret";
    const output = new BoundedRedactedLog({
      lineBytes: Buffer.byteLength(line),
      tailBytes: 128,
    });
    output.append(`${line}\n`);

    expect(output.diagnostic()).toContain("Authorization: [REDACTED]");
    expect(output.diagnostic()).not.toContain("boundary-secret");
  });

  test("keeps ordinary logs and bounds only the sanitized tail", () => {
    const output = new BoundedRedactedLog({ lineBytes: 64, tailBytes: 32 });
    output.append("ordinary-one\nordinary-two\nNPM_TOKEN=token-secret\n");

    const diagnostic = output.diagnostic();
    expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(32);
    expect(diagnostic).not.toContain("token-secret");
  });
});

describe("cleanup coordination", () => {
  test("runs one cleanup gate for repeated callers", async () => {
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = vi.fn(() => waiting);
    const gate = new CleanupGate(cleanup);

    const first = gate.run();
    const second = gate.run();
    expect(first).toBe(second);
    expect(cleanup).toHaveBeenCalledTimes(1);
    release();
    await first;
  });

  test("coalesces repeated signals and re-emits the first after cleanup", async () => {
    const emitter = new EventEmitter();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const cleanup = vi.fn(() => waiting);
    const reemit = vi.fn();
    const registration = attachSignalCleanup(new CleanupGate(cleanup), {
      target: signalTarget(emitter),
      reemit,
    });

    emitter.emit("SIGTERM");
    emitter.emit("SIGINT");
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(reemit).not.toHaveBeenCalled();
    release();
    await registration.signalHandled;

    expect(reemit).toHaveBeenCalledExactlyOnceWith("SIGTERM");
  });
});

describe("POSIX process-group cleanup", () => {
  test("never probes or signals after TERM reports ESRCH", async () => {
    const calls: Array<NodeJS.Signals | 0> = [];
    await stopOwnedPosixProcessGroup(421337, Promise.resolve(closed), {
      kill(_pid, signal) {
        calls.push(signal);
        if (signal === "SIGTERM") throw esrch();
      },
    });

    expect(calls).toEqual([0, "SIGTERM"]);
  });

  test("does not send KILL after a poll establishes the ESRCH barrier", async () => {
    const calls: Array<NodeJS.Signals | 0> = [];
    let probes = 0;
    await stopOwnedPosixProcessGroup(421337, Promise.resolve(closed), {
      kill(_pid, signal) {
        calls.push(signal);
        if (signal === 0 && ++probes === 2) throw esrch();
      },
    });

    expect(calls).toEqual([0, "SIGTERM", 0]);
  });

  test("uses KILL only after a bounded TERM wait", async () => {
    const calls: Array<NodeJS.Signals | 0> = [];
    let now = 0;
    let killed = false;
    await stopOwnedPosixProcessGroup(421337, Promise.resolve(closed), {
      kill(_pid, signal) {
        calls.push(signal);
        if (signal === "SIGKILL") killed = true;
        if (signal === 0 && killed) throw esrch();
      },
      now: () => now,
      wait: async (milliseconds) => {
        now += milliseconds;
      },
      timeoutMs: 2,
      pollIntervalMs: 1,
    });

    expect(calls).toContain("SIGTERM");
    expect(calls).toContain("SIGKILL");
  });
});

describe("Windows process-tree cleanup", () => {
  test("builds an absolute System32 taskkill command", () => {
    expect(windowsTaskkillCommand(42, "C:\\Windows")).toEqual({
      command: "C:\\Windows\\System32\\taskkill.exe",
      args: ["/pid", "42", "/T", "/F"],
    });
    expect(() => windowsTaskkillCommand(42, "Windows")).toThrow(/absolute/i);
  });

  test("rejects taskkill failure", async () => {
    await expect(
      stopOwnedWindowsProcessTree(42, Promise.resolve(closed), {
        systemRoot: "C:\\Windows",
        launch: () => windowsKill(Promise.resolve({ code: 1, signal: null })),
        timeoutMs: 20,
      }),
    ).rejects.toThrow(/code 1/i);
  });

  test("terminates a hung taskkill within the deadline", async () => {
    const terminate = vi.fn();
    await expect(
      stopOwnedWindowsProcessTree(42, Promise.resolve(closed), {
        systemRoot: "C:\\Windows",
        launch: () => windowsKill(new Promise(() => {}), terminate),
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/timed out/i);
    expect(terminate).toHaveBeenCalledOnce();
  });

  test("requires the original command to close after taskkill", async () => {
    await expect(
      stopOwnedWindowsProcessTree(42, new Promise(() => {}), {
        systemRoot: "C:\\Windows",
        launch: () => windowsKill(Promise.resolve({ code: 0, signal: null })),
        timeoutMs: 5,
      }),
    ).rejects.toThrow(/original command.*close/i);
  });

  test("retains the validated root when tree exit cannot be proven", async () => {
    const root = path.join(tmpdir(), "mediago-runtime-retained");
    const removeRoot = vi.fn();
    const releaseHandles = vi.fn();
    const ownedProcess = {
      pid: 42,
      completion: Promise.resolve(closed),
      releaseHandles,
    };
    await expect(
      cleanupOwnedRuntimeRoot({
        root,
        prefix: "mediago-runtime-",
        ownedProcess,
        platform: "win32",
        removeRoot,
        windows: {
          systemRoot: "C:\\Windows",
          launch: () => windowsKill(Promise.resolve({ code: 1, signal: null })),
          timeoutMs: 20,
        },
      }),
    ).rejects.toThrow(root);
    expect(removeRoot).not.toHaveBeenCalled();
    expect(releaseHandles).toHaveBeenCalledOnce();
  });

  test("removes a validated root after a spawn error with no owned pid", async () => {
    const root = path.join(tmpdir(), "mediago-runtime-spawn-error");
    const removeRoot = vi.fn();
    await cleanupOwnedRuntimeRoot({
      root,
      prefix: "mediago-runtime-",
      ownedProcess: {
        completion: Promise.resolve({
          code: null,
          signal: null,
          spawnError: new Error("spawn failed"),
        }),
      },
      platform: "linux",
      removeRoot,
    });

    expect(removeRoot).toHaveBeenCalledExactlyOnceWith(root);
  });
});

test.runIf(process.platform !== "win32")(
  "real SIGTERM cleanup removes the owned root and process group before preserving signal exit",
  async () => {
    const helperUrl = new URL(
      "./migration-verification-safety.ts",
      import.meta.url,
    ).href;
    const fixture = `
      import { spawn } from "node:child_process";
      import { mkdtempSync } from "node:fs";
      import { tmpdir } from "node:os";
      import path from "node:path";
      import { CleanupGate, attachSignalCleanup, cleanupOwnedRuntimeRoot } from ${JSON.stringify(helperUrl)};
      const prefix = "mediago-signal-fixture-";
      const root = mkdtempSync(path.join(tmpdir(), prefix));
      const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        detached: true,
        stdio: "ignore",
      });
      const completion = new Promise((resolve) => {
        owned.once("error", (spawnError) => resolve({ code: null, signal: null, spawnError }));
        owned.once("close", (code, signal) => resolve({ code, signal }));
      });
      const gate = new CleanupGate(async () => {
        process.stdout.write("CLEANUP\\n");
        await new Promise((resolve) => setTimeout(resolve, 50));
        await cleanupOwnedRuntimeRoot({
          root,
          prefix,
          ownedProcess: { pid: owned.pid, completion },
          platform: process.platform,
        });
      });
      attachSignalCleanup(gate);
      process.stdout.write(JSON.stringify({ root, childPid: owned.pid }) + "\\n");
      setInterval(() => {}, 1000);
    `;
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", fixture],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    let errorOutput = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errorOutput += chunk;
    });
    const close = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    let root: string | undefined;
    let childPid: number | undefined;
    try {
      await vi.waitFor(() => {
        const line = output.split("\n").find((value) => value.startsWith("{"));
        if (!line) throw new Error("fixture readiness line is pending");
        ({ root, childPid } = JSON.parse(line));
      });
      if (!root) {
        throw new Error(
          `signal fixture did not become ready (pid=${child.pid}, exit=${child.exitCode}, signal=${child.signalCode}): ${errorOutput || output || "no output"}`,
        );
      }
      const ownedChildPid = childPid;
      if (!ownedChildPid)
        throw new Error("signal fixture omitted its child PID");
      child.kill("SIGTERM");
      await vi.waitFor(() => expect(output).toContain("CLEANUP\n"));
      child.kill("SIGINT");
      const result = await Promise.race([
        close,
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error("signal fixture timed out")),
            5_000,
          ),
        ),
      ]);

      expect(result).toEqual({ code: null, signal: "SIGTERM" });
      expect(output.match(/^CLEANUP$/gm)).toHaveLength(1);
      expect(existsSync(root)).toBe(false);
      expect(() => process.kill(-ownedChildPid, 0)).toThrow(
        expect.objectContaining({ code: "ESRCH" }),
      );
    } finally {
      if (child.exitCode === null && child.signalCode === null)
        child.kill("SIGKILL");
      if (childPid) {
        try {
          process.kill(-childPid, "SIGKILL");
        } catch {
          // Recovery only: the passing-path assertion above already proves ESRCH.
        }
      }
      if (root && existsSync(root)) {
        expect(path.dirname(root)).toBe(tmpdir());
        expect(path.basename(root)).toMatch(/^mediago-signal-fixture-/);
        rmSync(root, { recursive: true, force: true });
      }
    }
  },
  15_000,
);

describe("BBDown executable-name contracts", () => {
  const tool: DependencyManifestEntry = {
    repo: "nilaoda/BBDown",
    version: "pinned",
    assets: { "linux-x64": "BBDown.zip" },
    binaryName: { default: "BBDown", win32: "BBDown.exe" },
    extractBinary: { default: "BBDown", win32: "BBDown.exe" },
  };

  test("cross-checks manifest, canonical layout, and executable basename", () => {
    expect(assertBBDownExecutableNames(tool, "linux-x64", "/deps/BBDown")).toBe(
      "BBDown",
    );
    expect(() =>
      assertBBDownExecutableNames(
        { ...tool, binaryName: { default: "renamed" } },
        "linux-x64",
        "/deps/BBDown",
      ),
    ).toThrow(/manifest.*layout/i);
    expect(() =>
      assertBBDownExecutableNames(tool, "linux-x64", "/deps/wrong"),
    ).toThrow(/basename/i);
  });
});
