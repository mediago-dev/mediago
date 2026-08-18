import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import {
  buildInjectedEnvironmentBytes,
  buildVerificationEnvironment,
  definesSentinelEnvironmentKey,
  SENTINEL_ENV_KEY,
} from "./bundle-env-values.ts";
import {
  InjectedTransactionCrash,
  type TransactionPhase,
  type TransactionJournal,
  type TransactionState,
  hashBytes,
  recoveryError,
  restoreCapturedWithoutClobber,
  sameIdentity,
  serializeJournal,
  snapshotRegularFile,
  throwAfterPhaseIfRequested,
  transactionArtifacts,
  transitionJournal,
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

export async function injectBundleVerificationEnvironment(options: {
  faultAfterPhase?: TransactionPhase;
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
    phase: "locked",
    pid: process.pid,
    version: 2,
  };
  const state: TransactionState = {
    artifacts,
    injectedBytes: expectedInjectedBytes,
    journal,
    original,
    targetPath: options.targetPath,
    faultAfterPhase: options.faultAfterPhase,
  };

  await writeExclusiveFile(artifacts.lockPath, serializeJournal(journal));
  throwAfterPhaseIfRequested(state, "locked");
  try {
    if (original) {
      await writeExclusiveFile(
        artifacts.backupPath,
        original.bytes,
        original.mode,
      );
    }
    await transitionJournal(state, "backed-up");
    await writeExclusiveFile(
      artifacts.injectedTempPath,
      expectedInjectedBytes,
      original?.mode ?? 0o600,
    );

    if (original) {
      await fs.rename(options.targetPath, artifacts.originalCapturePath);
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
    } else {
      const appeared = await snapshotRegularFile(
        options.targetPath,
        "Production-local env",
      );
      if (appeared) {
        throw recoveryError(
          state,
          "A concurrent target appeared before injection; it was not overwritten.",
        );
      }
    }
    await transitionJournal(state, "captured");

    await fs.link(artifacts.injectedTempPath, options.targetPath);
    const injected = await snapshotRegularFile(
      options.targetPath,
      "Injected production-local env",
    );
    if (!injected || !injected.bytes.equals(expectedInjectedBytes)) {
      throw recoveryError(state, "The injected target could not be verified.");
    }
    await transitionJournal(state, "injected", {
      injectedIdentity: injected.identity,
    });
  } catch (error) {
    if (error instanceof InjectedTransactionCrash) throw error;
    try {
      await cleanupTransaction(state);
    } catch (cleanupError) {
      // oxlint-disable-next-line preserve-caught-error -- AggregateError preserves both the injection and cleanup failures explicitly.
      throw new AggregateError(
        [error, cleanupError],
        "Bundle environment injection failed and recovery artifacts were preserved",
        { cause: error },
      );
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
