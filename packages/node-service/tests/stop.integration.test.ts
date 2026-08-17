import { createServer } from "node:net";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, test } from "vitest";
import { ServiceRunner } from "../src/index";

const temporaryRoots: string[] = [];
const ownedPids = new Set<number>();

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // oxlint-disable-next-line no-await-in-loop -- Liveness polling must complete before the next probe.
    await delay(Math.min(20, remaining));
  }
  return true;
}

async function killOwnedProcess(pid: number) {
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
  if (!(await waitForProcessExit(pid, 2_000))) {
    throw new Error(`Owned process ${pid} did not exit during test cleanup`);
  }
}

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Failed to reserve a loopback port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForPidFile(filePath: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      // oxlint-disable-next-line no-await-in-loop -- The PID file is polled until the descendant is ready.
      const pid = Number.parseInt(await readFile(filePath, "utf8"), 10);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    } catch {
      // The descendant writes the file after it starts listening.
    }
    // oxlint-disable-next-line no-await-in-loop -- Retry delay intentionally follows each failed read.
    await delay(20);
  }
  throw new Error(`Descendant PID was not written to ${filePath}`);
}

afterEach(async () => {
  await Promise.all([...ownedPids].map((pid) => killOwnedProcess(pid)));
  ownedPids.clear();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform !== "linux")(
  "ServiceRunner Linux process ownership",
  () => {
    test("does not finish stopping while an owned descendant survives", async () => {
      const root = await mkdtemp(join(tmpdir(), "service-runner-tree-"));
      temporaryRoots.push(root);
      const executableName = "service-parent.mjs";
      const executablePath = join(root, executableName);
      const descendantPidFile = join(root, "descendant.pid");
      const descendantSource = [
        'import { writeFileSync } from "node:fs";',
        'import { createServer } from "node:http";',
        'process.on("SIGTERM", () => {});',
        "const server = createServer((_request, response) => {",
        '  response.writeHead(200).end("ok");',
        "});",
        "server.listen(Number(process.env.PORT), process.env.HOST, () => {",
        "  writeFileSync(process.env.DESCENDANT_PID_FILE, String(process.pid));",
        "});",
      ].join("\n");
      const parentSource = [
        "#!/usr/bin/env node",
        'import { spawn } from "node:child_process";',
        'const descendant = spawn(process.execPath, ["--input-type=module", "-e", process.env.DESCENDANT_SOURCE], {',
        "  env: { ...process.env, DESCENDANT_PID_FILE: process.argv[2] },",
        '  stdio: "ignore",',
        "});",
        'process.on("SIGTERM", () => process.exit(0));',
        'descendant.once("error", (error) => { throw error; });',
        "setInterval(() => {}, 1_000);",
      ].join("\n");
      await writeFile(executablePath, parentSource);
      await chmod(executablePath, 0o755);

      const runner = new ServiceRunner({
        executableDir: root,
        executableName,
        preferredPort: await reserveLoopbackPort(),
        shutdownTimeoutMs: 100,
        healthCheckIntervalMs: 20,
        healthCheckTimeoutMs: 2_000,
        extraArgs: [descendantPidFile],
        extraEnv: { DESCENDANT_SOURCE: descendantSource },
      });

      await runner.start();
      const parentPid = runner.getPID();
      if (!parentPid) throw new Error("Service parent did not expose its PID");
      ownedPids.add(parentPid);
      const descendantPid = await waitForPidFile(descendantPidFile);
      ownedPids.add(descendantPid);

      await runner.stop();
      ownedPids.delete(parentPid);

      expect(processIsAlive(descendantPid)).toBe(false);
      ownedPids.delete(descendantPid);
    });
  },
);
