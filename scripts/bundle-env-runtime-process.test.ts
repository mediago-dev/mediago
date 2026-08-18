import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import { terminateProcessTree } from "./bundle-env-runtime.ts";
import {
  createTerminationCoordinator,
  type EnvironmentTransaction,
  verifyBundleEnvironment,
} from "./verify-bundle-env.ts";

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

function waitForExit(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => resolve());
  });
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

    it("keeps the sentinel installed until a signal-resistant descendant reaches ESRCH", async () => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-verifier-cleanup-gate-"),
      );
      temporaryDirectories.push(directory);
      const targetPath = path.join(directory, ".env.production.local");
      const original = Buffer.from("ORIGINAL=exact\nLAST=no-newline");
      const grandchildPidPath = path.join(directory, "grandchild.pid");
      await fs.writeFile(targetPath, original);

      let activeChild: ReturnType<typeof spawn> | undefined;
      let activeCleanup: EnvironmentTransaction["cleanup"] | undefined;
      let grandchildPid = 0;
      let parentPid = 0;
      let terminationPromise: Promise<void> | undefined;
      let treeStopPromise: Promise<void> | undefined;
      let cleanupEntered: (() => void) | undefined;
      let cleanupEntryCount = 0;
      const cleanupEntry = new Promise<void>((resolve) => {
        cleanupEntered = resolve;
      });
      let directChildExited: (() => void) | undefined;
      const directChildExit = new Promise<void>((resolve) => {
        directChildExited = resolve;
      });
      const exitCodes: number[] = [];
      const stopTree = (): Promise<void> => {
        treeStopPromise ??= terminateProcessTree(activeChild, {
          environment: process.env,
          platform: process.platform,
          timeoutMs: 150,
        });
        return treeStopPromise;
      };
      const terminate = createTerminationCoordinator({
        exit: (code) => exitCodes.push(code),
        getCleanup: () => activeCleanup,
        reportError: (error) => {
          throw error;
        },
        terminateActiveChild: stopTree,
      });

      const verification = verifyBundleEnvironment({
        beforeCleanup: async () => {
          cleanupEntryCount += 1;
          cleanupEntered?.();
          await treeStopPromise;
        },
        isProcessAlive: () => false,
        onCleanupReady: (cleanup) => {
          activeCleanup = cleanup;
        },
        runBuilds: async () => {
          const grandchildSource = [
            'import { writeFileSync } from "node:fs";',
            'process.on("SIGTERM", () => {});',
            "writeFileSync(process.argv[1], String(process.pid));",
            "setInterval(() => {}, 1_000);",
          ].join("\n");
          const parentSource = [
            'import { spawn } from "node:child_process";',
            'spawn(process.execPath, ["--input-type=module", "-e", process.argv[1], process.argv[2]], { stdio: "ignore" });',
            "setInterval(() => {}, 1_000);",
          ].join("\n");
          activeChild = spawn(
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
          if (!activeChild.pid) {
            throw new Error("Verifier parent process did not expose a PID");
          }
          parentPid = activeChild.pid;
          ownedGroups.add(parentPid);
          grandchildPid = await waitForPid(grandchildPidPath);
          const directExit = waitForExit(activeChild);
          terminationPromise = terminate("SIGTERM");
          await directExit;
          directChildExited?.();
          throw new Error("direct verifier child exited");
        },
        scanBundles: async () => [],
        targetPath,
        transactionId: "cleanup-gate-race",
      });
      const verificationResult = expect(verification).rejects.toThrow(
        "direct verifier child exited",
      );

      await directChildExit;
      await Promise.race([cleanupEntry, delay(75)]);
      expect(await fs.readFile(targetPath, "utf8")).toContain(
        "MEDIAGO_TEST_SENTINEL_SECRET=",
      );
      expect(processIsAlive(parentPid)).toBe(false);
      expect(processIsAlive(grandchildPid)).toBe(true);

      await terminationPromise;
      await verificationResult;

      expect(await fs.readFile(targetPath)).toEqual(original);
      expect(processIsAlive(parentPid)).toBe(false);
      expect(processIsAlive(grandchildPid)).toBe(false);
      expect(exitCodes).toEqual([143]);
      expect(cleanupEntryCount).toBe(1);
      expect(
        (await fs.readdir(directory)).filter((name) =>
          name.includes("mediago-bundle-env"),
        ),
      ).toEqual([]);
      ownedGroups.delete(parentPid);
    });
  },
);
