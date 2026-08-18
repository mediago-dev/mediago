import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPnpmLauncher,
  filesContainingSentinel,
  resolvePnpmEntrypoint,
} from "./bundle-env-runtime.ts";

describe("bundle environment pnpm runtime", () => {
  it("uses an absolute regular JavaScript npm_execpath", async () => {
    const candidates: string[] = [];
    const entrypoint = await resolvePnpmEntrypoint({
      environment: { npm_execpath: "/opt/pnpm/bin/pnpm.cjs" },
      platform: "linux",
      probe: async (candidate) => {
        candidates.push(candidate);
        return candidate === "/opt/pnpm/bin/pnpm.cjs"
          ? { isFile: true, realPath: candidate }
          : undefined;
      },
    });

    expect(entrypoint).toBe("/opt/pnpm/bin/pnpm.cjs");
    expect(candidates).toEqual(["/opt/pnpm/bin/pnpm.cjs"]);
  });

  it("resolves a simulated Windows pnpm shim to an adjacent JavaScript entrypoint", async () => {
    const jsEntrypoint = "C:\\tools\\pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs";
    const entrypoint = await resolvePnpmEntrypoint({
      environment: {
        PATH: "C:\\Windows\\System32",
        PNPM_HOME: "C:\\tools\\pnpm",
      },
      platform: "win32",
      probe: async (candidate) => {
        if (candidate === "C:\\tools\\pnpm\\pnpm.cmd") {
          return { isFile: true, realPath: candidate };
        }
        if (candidate === jsEntrypoint) {
          return { isFile: true, realPath: candidate };
        }
        return undefined;
      },
    });

    expect(entrypoint).toBe(jsEntrypoint);
  });

  it("constructs a Node-only launcher on simulated Windows", () => {
    expect(
      createPnpmLauncher({
        args: ["run", "build:electron", "--force"],
        entrypoint: "C:\\tools\\pnpm\\pnpm.cjs",
        nodeExecutable: "C:\\node\\node.exe",
        platform: "win32",
      }),
    ).toEqual({
      args: ["C:\\tools\\pnpm\\pnpm.cjs", "run", "build:electron", "--force"],
      command: "C:\\node\\node.exe",
    });
  });

  it.each([
    [
      "relative npm_execpath",
      { npm_execpath: "node_modules/pnpm/bin/pnpm.cjs" },
      "absolute",
    ],
    ["missing pnpm", { PATH: "/empty", PNPM_HOME: "/also-empty" }, "pnpm"],
  ] as const)("rejects %s actionably", async (_name, environment, message) => {
    await expect(
      resolvePnpmEntrypoint({
        environment,
        platform: "linux",
        probe: async () => undefined,
      }),
    ).rejects.toThrow(message);
  });

  it("finds a sentinel split across bounded stream chunks", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "mediago-bundle-scan-test-"),
    );
    const filename = path.join(directory, "chunked.js");
    try {
      await fs.writeFile(
        filename,
        `${"x".repeat(64 * 1024 - 12)}mediago_bundle_secret_sentinel_6f2e7c9a`,
      );
      expect(await filesContainingSentinel(directory)).toEqual([filename]);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });
});
