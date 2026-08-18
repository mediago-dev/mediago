import fs from "node:fs/promises";
import { buildInjectedEnvironmentBytes } from "./bundle-env-values.ts";
import {
  hasHash,
  ownsInjected,
  parseJournal,
  removeOwnedJournalTemp,
  removeResidualArtifacts,
  validatedBackup,
  validatedInjectedTemp,
  validatedOriginalCapture,
  validatedRestoreCapture,
} from "./bundle-env-transaction-artifacts.ts";
import {
  type FileSnapshot,
  type TransactionJournal,
  type TransactionState,
  hashBytes,
  isErrno,
  recoveryError,
  sameIdentity,
  snapshotRegularFile,
  transactionArtifacts,
  transactionLockPath,
  transitionJournal,
} from "./bundle-env-transaction-files.ts";

function targetIsRestored(
  state: TransactionState,
  target: FileSnapshot | undefined,
  backup: FileSnapshot | undefined,
): boolean {
  if (!state.journal.originalExists) return !target;
  if (!target || !hasHash(target, state.journal.originalHash)) return false;
  return Boolean(
    (state.journal.restoredIdentity &&
      sameIdentity(target.identity, state.journal.restoredIdentity)) ||
    (state.journal.originalIdentity &&
      sameIdentity(target.identity, state.journal.originalIdentity)) ||
    (backup && sameIdentity(target.identity, backup.identity)),
  );
}

async function markRestored(
  state: TransactionState,
  target: FileSnapshot | undefined,
): Promise<void> {
  await transitionJournal(
    state,
    "restored",
    target ? { restoredIdentity: target.identity } : {},
  );
}

async function restoreOriginal(
  state: TransactionState,
  backup: FileSnapshot | undefined,
  originalCapture: FileSnapshot | undefined,
): Promise<void> {
  if (!state.journal.originalExists) {
    await markRestored(state, undefined);
    return;
  }
  if (!backup) {
    throw recoveryError(
      state,
      "The durable backup is unavailable while restoring the original.",
    );
  }

  if (originalCapture) {
    await fs.rename(state.artifacts.originalCapturePath, state.targetPath);
  } else {
    try {
      await fs.link(state.artifacts.backupPath, state.targetPath);
    } catch (error) {
      throw recoveryError(
        state,
        isErrno(error, "EEXIST")
          ? "A concurrent file appeared while restoring; no file was overwritten."
          : `Unable to restore the original without clobbering: ${String(error)}`,
      );
    }
  }

  const restored = await snapshotRegularFile(
    state.targetPath,
    "Restored production-local env",
  );
  const expectedIdentity = originalCapture?.identity ?? backup.identity;
  if (
    !restored ||
    !hasHash(restored, state.journal.originalHash) ||
    !sameIdentity(restored.identity, expectedIdentity)
  ) {
    throw recoveryError(
      state,
      "The original changed during restore; preserving all recovery artifacts.",
    );
  }
  await markRestored(state, restored);
}

async function reconcileRestoredState(state: TransactionState): Promise<void> {
  const backup = await validatedBackup(state);
  const originalCapture = await validatedOriginalCapture(state);
  const injectedTemp = await validatedInjectedTemp(state);
  let restoreCapture = await validatedRestoreCapture(state, injectedTemp);
  let target = await snapshotRegularFile(
    state.targetPath,
    "Production-local env",
  );

  if (state.journal.phase === "restored") {
    if (!targetIsRestored(state, target, backup)) {
      throw recoveryError(
        state,
        "The restored target changed concurrently; preserving its backup.",
      );
    }
    return;
  }

  if (targetIsRestored(state, target, backup) && !originalCapture) {
    await markRestored(state, target);
    return;
  }

  if (target) {
    if (!ownsInjected(state, target, injectedTemp)) {
      throw recoveryError(
        state,
        "The target was modified or replaced concurrently; it remains untouched.",
      );
    }
    if (restoreCapture) {
      throw recoveryError(
        state,
        "Both the target and cleanup capture contain the injected file; preserving both.",
      );
    }
    await fs.rename(state.targetPath, state.artifacts.restoreCapturePath);
    restoreCapture = await validatedRestoreCapture(state, injectedTemp);
    if (
      !restoreCapture ||
      !sameIdentity(restoreCapture.identity, target.identity)
    ) {
      throw recoveryError(
        state,
        "The injected target changed while it was captured for cleanup.",
      );
    }
    target = undefined;
  }

  if (state.journal.originalExists && !backup) {
    throw recoveryError(
      state,
      "The target is missing and its durable backup is unavailable.",
    );
  }
  await restoreOriginal(state, backup, originalCapture);
}

export async function cleanupTransaction(
  state: TransactionState,
): Promise<void> {
  await removeOwnedJournalTemp(state);
  if (state.journal.phase !== "complete") {
    await reconcileRestoredState(state);
    await transitionJournal(state, "complete");
  }
  await removeResidualArtifacts(state);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, "ESRCH");
  }
}

async function recoveryOriginal(
  targetPath: string,
  artifacts: ReturnType<typeof transactionArtifacts>,
  journal: TransactionJournal,
): Promise<FileSnapshot | undefined> {
  if (!journal.originalExists) return undefined;
  const candidates = [
    await snapshotRegularFile(
      artifacts.backupPath,
      "Bundle verification backup",
    ),
    await snapshotRegularFile(
      artifacts.originalCapturePath,
      "Captured original environment",
    ),
    await snapshotRegularFile(targetPath, "Production-local env"),
  ];
  return candidates.find(
    (candidate) => candidate && hasHash(candidate, journal.originalHash),
  );
}

export async function recoverExistingTransaction(
  targetPath: string,
  isProcessAlive: (pid: number) => boolean = processIsAlive,
): Promise<void> {
  const lockPath = transactionLockPath(targetPath);
  const lock = await snapshotRegularFile(lockPath, "Bundle verification lock");
  if (!lock) return;
  const journal = parseJournal(lock.bytes, lockPath);
  if (isProcessAlive(journal.pid)) {
    throw new Error(
      `Bundle verification is already active (pid ${journal.pid}). Lock: ${lockPath}`,
    );
  }
  const artifacts = transactionArtifacts(targetPath, journal.id);
  const original = await recoveryOriginal(targetPath, artifacts, journal);
  const injectedBytes = buildInjectedEnvironmentBytes(
    original?.bytes ?? Buffer.alloc(0),
  );
  if (
    (!journal.originalExists || original) &&
    hashBytes(injectedBytes) !== journal.injectedHash
  ) {
    throw new Error(
      `Cannot recover bundle verification: journal hash mismatch. Lock: ${lockPath}; backup: ${artifacts.backupPath}`,
    );
  }
  await cleanupTransaction({
    artifacts,
    injectedBytes,
    journal,
    original,
    targetPath,
  });
}
