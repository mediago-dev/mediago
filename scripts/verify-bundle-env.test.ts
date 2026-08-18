import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type BundleVerificationOptions,
  createTerminationCoordinator,
  handleTermination,
  injectBundleVerificationEnvironment,
  verifyBundleEnvironment,
} from "./verify-bundle-env.ts";
import { transactionArtifacts as artifactPaths } from "./bundle-env-transaction-files.ts";

type Cleanup = () => Promise<void>;

describe("bundle environment verifier transaction", () => {
  let tempDirectory: string;
  let targetPath: string;

  beforeEach(async () => {
    tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "mediago-bundle-env-test-"),
    );
    targetPath = path.join(tempDirectory, ".env.production.local");
  });

  afterEach(async () => {
    await fs.rm(tempDirectory, { force: true, recursive: true });
  });

  async function transactionArtifacts(): Promise<string[]> {
    return (await fs.readdir(tempDirectory))
      .filter((name) => name.includes("mediago-bundle-env"))
      .toSorted();
  }

  function options(
    overrides: Partial<BundleVerificationOptions> = {},
  ): BundleVerificationOptions {
    return {
      environment: {
        MEDIAGO_TEST_SENTINEL_SECRET: "caller-secret",
        NODE_OPTIONS: "--import=tsx",
      },
      isProcessAlive: () => false,
      runBuilds: async (environment) => {
        expect(environment.NODE_OPTIONS).toBeUndefined();
        expect(environment.MEDIAGO_TEST_SENTINEL_SECRET).toBeUndefined();
        expect(environment.MEDIAGO_PROFILE).toBe("production");
        expect(await fs.readFile(targetPath, "utf8")).toContain(
          "MEDIAGO_TEST_SENTINEL_SECRET=mediago_bundle_secret_sentinel_6f2e7c9a",
        );
      },
      scanBundles: async () => [],
      targetPath,
      transactionId: "test-transaction",
      ...overrides,
    };
  }

  it("keeps every secret-bearing transaction artifact Git-ignored", () => {
    const artifacts = Object.values(
      artifactPaths(
        path.join(process.cwd(), ".env.production.local"),
        "ignore-contract",
      ),
    ).map((filename) => path.relative(process.cwd(), filename));
    const check = spawnSync("git", ["check-ignore", "--no-index", "--stdin"], {
      cwd: process.cwd(),
      encoding: "utf8",
      input: `${artifacts.join("\n")}\n`,
    });

    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout.trim().split("\n").toSorted()).toEqual(
      artifacts.toSorted(),
    );
  });

  it.each([
    ["existing file", Buffer.from("FIRST=1\nLAST=no-newline")],
    ["absent file", undefined],
  ] as const)(
    "restores an %s exactly after success",
    async (_name, original) => {
      if (original) await fs.writeFile(targetPath, original);
      let cleanup: Cleanup | undefined;

      await verifyBundleEnvironment(
        options({
          onCleanupReady: (value) => {
            if (value) cleanup = value;
          },
        }),
      );

      if (original) {
        expect(await fs.readFile(targetPath)).toEqual(original);
      } else {
        await expect(fs.lstat(targetPath)).rejects.toMatchObject({
          code: "ENOENT",
        });
      }
      expect(await transactionArtifacts()).toEqual([]);
      await expect(cleanup?.()).resolves.toBeUndefined();
    },
  );

  it.each([
    [
      "runner failure",
      {
        runBuilds: async () => {
          throw new Error("injected runner failure");
        },
      },
    ],
    [
      "scan failure",
      {
        scanBundles: async () => {
          throw new Error("injected scan failure");
        },
      },
    ],
    ["sentinel match", { scanBundles: async () => ["build/leaked.js"] }],
  ] as const)("restores after %s", async (_name, overrides) => {
    const original = Buffer.from("ORIGINAL=preserve-me\n");
    await fs.writeFile(targetPath, original);

    await expect(verifyBundleEnvironment(options(overrides))).rejects.toThrow();

    expect(await fs.readFile(targetPath)).toEqual(original);
    expect(await transactionArtifacts()).toEqual([]);
  });

  it.each(["symlink", "directory"] as const)(
    "rejects a %s target before writing",
    async (kind) => {
      const externalPath = path.join(tempDirectory, "external.env");
      await fs.writeFile(externalPath, "EXTERNAL=unchanged\n");
      if (kind === "symlink") {
        await fs.symlink(externalPath, targetPath);
      } else {
        await fs.mkdir(targetPath);
      }
      let ran = false;

      await expect(
        verifyBundleEnvironment(
          options({
            runBuilds: async () => {
              ran = true;
            },
          }),
        ),
      ).rejects.toThrow(/regular file|symbolic link/i);

      expect(ran).toBe(false);
      expect(await fs.readFile(externalPath, "utf8")).toBe(
        "EXTERNAL=unchanged\n",
      );
      const targetStat = await fs.lstat(targetPath);
      expect(
        kind === "symlink"
          ? targetStat.isSymbolicLink()
          : targetStat.isDirectory(),
      ).toBe(true);
      expect(await transactionArtifacts()).toEqual([]);
    },
  );

  it.each(["modified", "replaced"] as const)(
    "preserves a concurrently %s injected file and its recovery artifacts",
    async (kind) => {
      await fs.writeFile(targetPath, "ORIGINAL=backup\n");
      let cleanup: Cleanup | undefined;
      const concurrentBytes = Buffer.from(`CONCURRENT=${kind}\n`);

      await expect(
        verifyBundleEnvironment(
          options({
            onCleanupReady: (value) => {
              if (value) cleanup = value;
            },
            runBuilds: async () => {
              if (kind === "modified") {
                await fs.writeFile(targetPath, concurrentBytes);
              } else {
                const replacementPath = path.join(
                  tempDirectory,
                  "concurrent-replacement",
                );
                await fs.writeFile(replacementPath, concurrentBytes);
                await fs.rename(replacementPath, targetPath);
              }
            },
          }),
        ),
      ).rejects.toThrow(/concurrent|backup|recover/i);

      expect(await fs.readFile(targetPath)).toEqual(concurrentBytes);
      const artifacts = await transactionArtifacts();
      expect(artifacts.some((name) => name.includes("backup"))).toBe(true);
      expect(artifacts.some((name) => name.includes("lock"))).toBe(true);
      await expect(cleanup?.()).rejects.toThrow();
      expect(await fs.readFile(targetPath)).toEqual(concurrentBytes);
      expect(await transactionArtifacts()).toEqual(artifacts);
    },
  );

  it("recovers an interrupted injected transaction before the next run", async () => {
    const original = Buffer.from("ORIGINAL=crash-safe\n");
    await fs.writeFile(targetPath, original);

    await injectBundleVerificationEnvironment({
      isProcessAlive: () => false,
      targetPath,
      transactionId: "crashed-transaction",
    });
    expect(await fs.readFile(targetPath, "utf8")).toContain(
      "MEDIAGO_TEST_SENTINEL_SECRET=",
    );

    await verifyBundleEnvironment(
      options({ transactionId: "recovered-transaction" }),
    );

    expect(await fs.readFile(targetPath)).toEqual(original);
    expect(await transactionArtifacts()).toEqual([]);
  });

  it("refuses stale recovery when the injected target was replaced", async () => {
    await fs.writeFile(targetPath, "ORIGINAL=stale-backup\n");
    await injectBundleVerificationEnvironment({
      isProcessAlive: () => false,
      targetPath,
      transactionId: "stale-transaction",
    });
    const replacement = Buffer.from("USER=replaced-after-crash\n");
    const replacementPath = path.join(tempDirectory, "user-replacement");
    await fs.writeFile(replacementPath, replacement);
    await fs.rename(replacementPath, targetPath);

    await expect(
      verifyBundleEnvironment(options({ transactionId: "must-not-start" })),
    ).rejects.toThrow(/recover|backup|lock/i);

    expect(await fs.readFile(targetPath)).toEqual(replacement);
    const artifacts = await transactionArtifacts();
    expect(artifacts.some((name) => name.includes("backup"))).toBe(true);
    expect(artifacts.some((name) => name.includes("lock"))).toBe(true);
  });
});

describe("bundle environment verifier termination", () => {
  it.each([
    ["SIGINT", 130],
    ["SIGTERM", 143],
  ] as const)(
    "terminates the child and awaits cleanup before exiting for %s",
    async (signal, exitCode) => {
      const events: string[] = [];

      await handleTermination({
        cleanup: async () => {
          events.push("cleanup");
        },
        exit: (code) => {
          events.push(`exit:${code}`);
        },
        reportError: () => {
          events.push("error");
        },
        signal,
        terminateActiveChild: async () => {
          events.push("terminate");
        },
      });

      expect(events).toEqual(["terminate", "cleanup", `exit:${exitCode}`]);
    },
  );

  it("ignores repeated signals while tree termination and cleanup are in progress", async () => {
    const events: string[] = [];
    let releaseTermination: (() => void) | undefined;
    const terminationBarrier = new Promise<void>((resolve) => {
      releaseTermination = resolve;
    });
    const terminate = createTerminationCoordinator({
      exit: (code) => {
        events.push(`exit:${code}`);
      },
      getCleanup: () => async () => {
        events.push("cleanup");
      },
      reportError: () => {
        events.push("error");
      },
      terminateActiveChild: async () => {
        events.push("terminate");
        await terminationBarrier;
      },
    });

    const first = terminate("SIGTERM");
    const repeated = terminate("SIGINT");
    expect(repeated).toBe(first);
    expect(events).toEqual(["terminate"]);

    releaseTermination?.();
    await first;

    expect(events).toEqual(["terminate", "cleanup", "exit:143"]);
  });
});
