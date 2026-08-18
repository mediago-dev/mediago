import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  buildInjectedEnvironmentBytes,
  buildVerificationEnvironment,
  definesSentinelEnvironmentKey,
  SENTINEL_ENV_KEY,
} from "./bundle-env-values.ts";
import {
  type TransactionJournal,
  type TransactionState,
  hashBytes,
  recoveryError,
  restoreCapturedWithoutClobber,
  rewriteJournal,
  sameIdentity,
  serializeJournal,
  snapshotRegularFile,
  transactionArtifacts,
  unlinkIfIdentity,
  validateTransactionId,
  writeExclusiveFile,
} from "./bundle-env-transaction-files.ts";
import {
  cleanupTransaction,
  recoverExistingTransaction,
} from "./bundle-env-transaction-recovery.ts";

export type EnvironmentTransaction = {
  cleanup: () => Promise<void>;
};

export type BundleVerificationOptions = {
  environment?: NodeJS.ProcessEnv;
  isProcessAlive?: (pid: number) => boolean;
  onCleanupReady?: (
    cleanup: EnvironmentTransaction["cleanup"] | undefined,
  ) => void;
  runBuilds: (environment: NodeJS.ProcessEnv) => Promise<void>;
  scanBundles: () => Promise<string[]>;
  targetPath: string;
  transactionId?: string;
};

async function removePreInjectionArtifacts(
  state: TransactionState,
): Promise<void> {
  await fs.rm(state.artifacts.injectedTempPath, { force: true });
  await fs.rm(state.artifacts.backupPath, { force: true });
  await fs.rm(state.artifacts.journalTempPath, { force: true });
  await fs.rm(state.artifacts.lockPath, { force: true });
}

export async function injectBundleVerificationEnvironment(options: {
  isProcessAlive?: (pid: number) => boolean;
  targetPath: string;
  transactionId?: string;
}): Promise<EnvironmentTransaction> {
  await snapshotRegularFile(options.targetPath, "Production-local env");
  await recoverExistingTransaction(options.targetPath, options.isProcessAlive);

  const id = options.transactionId ?? randomUUID();
  validateTransactionId(id);
  const artifacts = transactionArtifacts(options.targetPath, id);
  const original = await snapshotRegularFile(
    options.targetPath,
    "Production-local env",
  );
  if (original && definesSentinelEnvironmentKey(original.bytes)) {
    throw new Error(
      `${options.targetPath} already defines ${SENTINEL_ENV_KEY}; refusing to overwrite it`,
    );
  }
  const expectedInjectedBytes = buildInjectedEnvironmentBytes(
    original?.bytes ?? Buffer.alloc(0),
  );
  const journal: TransactionJournal = {
    id,
    injectedHash: hashBytes(expectedInjectedBytes),
    originalExists: Boolean(original),
    originalHash: hashBytes(original?.bytes ?? Buffer.alloc(0)),
    originalIdentity: original?.identity,
    pid: process.pid,
    version: 1,
  };
  const state: TransactionState = {
    artifacts,
    injectedBytes: expectedInjectedBytes,
    journal,
    original,
    targetPath: options.targetPath,
  };

  await writeExclusiveFile(artifacts.lockPath, serializeJournal(journal));
  let targetCaptured = false;
  let targetInjected = false;
  try {
    if (original) {
      await writeExclusiveFile(
        artifacts.backupPath,
        original.bytes,
        original.mode,
      );
    }
    await writeExclusiveFile(
      artifacts.injectedTempPath,
      expectedInjectedBytes,
      original?.mode ?? 0o600,
    );

    if (original) {
      await fs.rename(options.targetPath, artifacts.originalCapturePath);
      targetCaptured = true;
      const captured = await snapshotRegularFile(
        artifacts.originalCapturePath,
        "Captured original environment",
      );
      if (
        !captured ||
        !captured.bytes.equals(original.bytes) ||
        !sameIdentity(captured.identity, original.identity)
      ) {
        if (captured) {
          await restoreCapturedWithoutClobber(
            artifacts.originalCapturePath,
            options.targetPath,
            captured,
          );
        }
        throw recoveryError(
          state,
          "The target changed before injection; it was not overwritten.",
        );
      }
    }

    await fs.link(artifacts.injectedTempPath, options.targetPath);
    targetInjected = true;
    const injected = await snapshotRegularFile(
      options.targetPath,
      "Injected production-local env",
    );
    if (!injected || !injected.bytes.equals(expectedInjectedBytes)) {
      throw recoveryError(state, "The injected target could not be verified.");
    }
    journal.injectedIdentity = injected.identity;
    await rewriteJournal(state);
    const injectedTemp = await snapshotRegularFile(
      artifacts.injectedTempPath,
      "Bundle verification temporary file",
    );
    if (!injectedTemp || !injectedTemp.bytes.equals(expectedInjectedBytes)) {
      throw recoveryError(
        state,
        "The temporary file changed concurrently; preserving it.",
      );
    }
    await unlinkIfIdentity(
      artifacts.injectedTempPath,
      injectedTemp.identity,
      "Bundle verification temporary file",
    );
    if (original) {
      const captured = await snapshotRegularFile(
        artifacts.originalCapturePath,
        "Captured original environment",
      );
      if (captured) {
        await unlinkIfIdentity(
          artifacts.originalCapturePath,
          captured.identity,
          "Captured original environment",
        );
      }
    }
  } catch (error) {
    if (!targetCaptured) {
      await removePreInjectionArtifacts(state);
    } else if (!targetInjected) {
      const captured = await snapshotRegularFile(
        artifacts.originalCapturePath,
        "Captured target after failed injection",
      );
      if (captured) {
        const restored = await restoreCapturedWithoutClobber(
          artifacts.originalCapturePath,
          options.targetPath,
          captured,
        );
        if (restored) await removePreInjectionArtifacts(state);
      }
    }
    throw error;
  }

  let cleanupPromise: Promise<void> | undefined;
  return {
    cleanup: () => {
      cleanupPromise ??= cleanupTransaction(state);
      return cleanupPromise;
    },
  };
}

export async function verifyBundleEnvironment(
  options: BundleVerificationOptions,
): Promise<void> {
  const transaction = await injectBundleVerificationEnvironment({
    isProcessAlive: options.isProcessAlive,
    targetPath: options.targetPath,
    transactionId: options.transactionId,
  });
  options.onCleanupReady?.(transaction.cleanup);
  let operationError: unknown;
  try {
    await options.runBuilds(
      buildVerificationEnvironment(options.environment ?? process.env),
    );
    const matches = await options.scanBundles();
    if (matches.length > 0) {
      throw new Error(
        `Secret sentinel was bundled into:\n${matches.join("\n")}`,
      );
    }
  } catch (error) {
    operationError = error;
  }

  let cleanupError: unknown;
  try {
    await transaction.cleanup();
  } catch (error) {
    cleanupError = error;
  } finally {
    options.onCleanupReady?.(undefined);
  }
  if (operationError && cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      "Bundle verification and cleanup both failed",
    );
  }
  if (cleanupError) throw cleanupError;
  if (operationError) throw operationError;
}
