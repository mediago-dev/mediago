import type { ElectronApplication } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  closeElectron,
  collectOwnedProcessTree,
  readProcessIdentity,
} from "./electron-process.ts";

const processes = vi.hoisted(
  () =>
    new Map<number, { startTime: string; children: number[]; state: string }>(),
);

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async (file: string) => {
    const pid = Number(file.split("/")[2]);
    const entry = processes.get(pid);
    if (!entry)
      throw Object.assign(new Error("Process exited"), { code: "ENOENT" });
    if (file.endsWith("/children")) return entry.children.join(" ");
    const fields = Array<string>(20).fill("0");
    fields[0] = entry.state;
    fields[19] = entry.startTime;
    return `${pid} (Electron (test)) ${fields.join(" ")}`;
  }),
}));

const root = { pid: 101, startTime: "1000" };

function application(close: () => Promise<void>): ElectronApplication {
  return { close } as ElectronApplication;
}

beforeEach(() => {
  processes.set(root.pid, {
    startTime: root.startTime,
    children: [102],
    state: "S",
  });
  processes.set(102, { startTime: "1001", children: [], state: "S" });
  vi.spyOn(process, "kill").mockImplementation((pid) => {
    processes.delete(pid);
    return true;
  });
});

afterEach(() => {
  processes.clear();
  vi.restoreAllMocks();
});

describe("owned Electron process cleanup", () => {
  it("collects children before their parent", async () => {
    expect(await collectOwnedProcessTree(root)).toEqual([
      { pid: 102, startTime: "1001" },
      root,
    ]);
  });

  it("does not signal processes after graceful shutdown", async () => {
    await closeElectron(
      application(async () => {
        processes.clear();
      }),
      root,
    );
    expect(process.kill).not.toHaveBeenCalled();
  });

  it("cleans up orphaned Core children even when Electron close succeeds", async () => {
    await closeElectron(
      application(async () => {
        processes.delete(root.pid);
      }),
      root,
    );
    expect(process.kill).toHaveBeenCalledExactlyOnceWith(102, "SIGTERM");
    expect(processes.size).toBe(0);
  });

  it("cleans up after a close timeout and preserves the failure", async () => {
    const closing = closeElectron(
      application(() => new Promise(() => {})),
      root,
      10,
    );
    await expect(closing).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: "Electron graceful close timed out after 10ms",
      }),
    });
    expect(processes.size).toBe(0);
    expect(process.kill).toHaveBeenCalledWith(102, "SIGTERM");
    expect(process.kill).toHaveBeenCalledWith(root.pid, "SIGTERM");
  });

  it("finds children created during graceful close and preserves its error", async () => {
    const error = new Error("close failed");
    const close = async () => {
      processes.get(102)?.children.push(103);
      processes.set(103, { startTime: "1002", children: [], state: "S" });
      throw error;
    };
    await expect(closeElectron(application(close), root)).rejects.toMatchObject(
      { cause: error },
    );
    expect(process.kill).toHaveBeenCalledWith(103, "SIGTERM");
    expect(processes.size).toBe(0);
  });

  it("does not signal unrelated processes that reuse a captured PID", async () => {
    await closeElectron(
      application(async () => {
        processes.delete(root.pid);
        processes.set(102, { startTime: "2000", children: [], state: "S" });
      }),
      root,
    );
    expect(process.kill).not.toHaveBeenCalled();
    expect(processes.get(102)?.startTime).toBe("2000");
  });

  it("escalates only surviving owned children to SIGKILL", async () => {
    vi.mocked(process.kill).mockImplementation((pid, signal) => {
      if (pid === 102 && signal === "SIGTERM") return true;
      processes.delete(pid);
      return true;
    });
    await closeElectron(
      application(async () => {
        processes.delete(root.pid);
      }),
      root,
    );
    expect(vi.mocked(process.kill).mock.calls).toEqual([
      [102, "SIGTERM"],
      [102, "SIGKILL"],
    ]);
    expect(processes.size).toBe(0);
  });

  it("treats zombies as exited so they do not exhaust the cleanup deadline", async () => {
    processes.set(102, { startTime: "1001", children: [], state: "Z" });
    expect(await readProcessIdentity(102)).toBeUndefined();
    await closeElectron(
      application(async () => {
        processes.delete(root.pid);
      }),
      root,
    );
    expect(process.kill).not.toHaveBeenCalled();
  });
});
