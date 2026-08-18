import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  supportsParentDirectoryFsync,
  transactionArtifacts,
} from "./bundle-env-transaction-files.ts";
import { recoverExistingTransaction } from "./bundle-env-transaction-recovery.ts";
import { injectBundleVerificationEnvironment } from "./bundle-env-transaction.ts";

const phases = [
  "locked",
  "backed-up",
  "captured",
  "injected",
  "restored",
  "complete",
] as const;

const temporaryDirectories: string[] = [];

async function transactionArtifactNames(directory: string): Promise<string[]> {
  return (await fs.readdir(directory))
    .filter((name) => name.includes("mediago-bundle-env"))
    .toSorted();
}

async function expectTarget(
  targetPath: string,
  original: Buffer | undefined,
): Promise<void> {
  if (original) {
    expect(await fs.readFile(targetPath)).toEqual(original);
  } else {
    await expect(fs.lstat(targetPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("bundle environment transaction fault recovery", () => {
  it("records the Node platform boundary for parent-directory fsync", () => {
    expect(supportsParentDirectoryFsync("linux")).toBe(true);
    expect(supportsParentDirectoryFsync("darwin")).toBe(true);
    expect(supportsParentDirectoryFsync("win32")).toBe(false);
  });

  it.each(
    phases.flatMap((phase) => [
      {
        name: "existing",
        original: Buffer.from("EXACT=original\nLAST=no-newline"),
        phase,
      },
      { name: "absent", original: undefined, phase },
    ]),
  )(
    "recovers exact $name target after a crash at $phase",
    async ({ original, phase }) => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-bundle-env-fault-"),
      );
      temporaryDirectories.push(directory);
      const targetPath = path.join(directory, ".env.production.local");
      const transactionId = `${phase}-${original ? "existing" : "absent"}`;
      const artifacts = transactionArtifacts(targetPath, transactionId);
      if (original) await fs.writeFile(targetPath, original);

      const injection = injectBundleVerificationEnvironment({
        faultAfterPhase: phase,
        isProcessAlive: () => false,
        targetPath,
        transactionId,
      });
      if (phase === "restored" || phase === "complete") {
        const transaction = await injection;
        await expect(transaction.cleanup()).rejects.toThrow(
          `simulated crash after ${phase}`,
        );
      } else {
        await expect(injection).rejects.toThrow(
          `simulated crash after ${phase}`,
        );
      }

      const journal = JSON.parse(
        await fs.readFile(artifacts.lockPath, "utf8"),
      ) as { phase: string };
      expect(journal.phase).toBe(phase);
      expect(await transactionArtifactNames(directory)).not.toEqual([]);
      if (original && (phase === "restored" || phase === "complete")) {
        expect(await fs.readFile(artifacts.backupPath)).toEqual(original);
      }

      await recoverExistingTransaction(targetPath, () => false);
      await recoverExistingTransaction(targetPath, () => false);

      await expectTarget(targetPath, original);
      expect(await transactionArtifactNames(directory)).toEqual([]);
    },
  );

  it.each(["modified", "replaced"] as const)(
    "preserves a concurrently %s injected target with an actionable backup",
    async (kind) => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-bundle-env-concurrent-"),
      );
      temporaryDirectories.push(directory);
      const targetPath = path.join(directory, ".env.production.local");
      const transactionId = `concurrent-${kind}`;
      const artifacts = transactionArtifacts(targetPath, transactionId);
      const original = Buffer.from("ORIGINAL=backup\n");
      const concurrent = Buffer.from(`CONCURRENT=${kind}\n`);
      await fs.writeFile(targetPath, original);
      await injectBundleVerificationEnvironment({
        isProcessAlive: () => false,
        targetPath,
        transactionId,
      });

      if (kind === "modified") {
        await fs.writeFile(targetPath, concurrent);
      } else {
        const replacementPath = path.join(directory, "replacement");
        await fs.writeFile(replacementPath, concurrent);
        await fs.rename(replacementPath, targetPath);
      }

      let recoveryError: unknown;
      try {
        await recoverExistingTransaction(targetPath, () => false);
      } catch (error) {
        recoveryError = error;
      }

      expect(String(recoveryError)).toContain(artifacts.backupPath);
      expect(await fs.readFile(targetPath)).toEqual(concurrent);
      expect(await fs.readFile(artifacts.backupPath)).toEqual(original);
      expect(await fs.lstat(artifacts.lockPath)).toBeDefined();
    },
  );
});
