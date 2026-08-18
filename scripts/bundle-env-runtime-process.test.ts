import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { terminateProcessTree } from "./bundle-env-runtime.ts";

const ownedGroups = new Set<number>();
const temporaryDirectories: string[] = [];

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForPid(filename: string): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- Readiness requires polling the child-owned PID file.
      const pid = Number.parseInt(await fs.readFile(filename, "utf8"), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // The parent has not spawned its descendant yet.
    }
    // oxlint-disable-next-line no-await-in-loop -- The next readiness probe must be delayed.
    await delay(20);
  }
  throw new Error(`Grandchild PID was not written to ${filename}`);
}

afterEach(async () => {
  for (const pid of ownedGroups) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  ownedGroups.clear();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe.skipIf(process.platform === "win32")(
  "bundle environment POSIX process ownership",
  () => {
    it("terminates a bounded detached process group including its grandchild", async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-verifier-tree-"),
      );
      temporaryDirectories.push(directory);
      const grandchildPidPath = path.join(directory, "grandchild.pid");
      const grandchildSource = [
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      const parentSource = [
        'import { spawn } from "node:child_process";',
        'import { writeFileSync } from "node:fs";',
        'const child = spawn(process.execPath, ["--input-type=module", "-e", process.argv[1]], { stdio: "ignore" });',
        "writeFileSync(process.argv[2], String(child.pid));",
        'process.on("SIGTERM", () => {});',
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      const parent = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          parentSource,
          grandchildSource,
          grandchildPidPath,
        ],
        { detached: true, stdio: "ignore" },
      );
      if (!parent.pid) throw new Error("Parent process did not expose a PID");
      ownedGroups.add(parent.pid);
      const grandchildPid = await waitForPid(grandchildPidPath);

      await terminateProcessTree(parent, {
        environment: process.env,
        platform: process.platform,
        timeoutMs: 100,
      });

      expect(processIsAlive(parent.pid)).toBe(false);
      expect(processIsAlive(grandchildPid)).toBe(false);
      ownedGroups.delete(parent.pid);
    });
  },
);
