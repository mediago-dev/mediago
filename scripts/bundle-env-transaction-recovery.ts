import fs from "node:fs/promises";
import { buildInjectedEnvironmentBytes } from "./bundle-env-values.ts";
import {
  type FileSnapshot,
  type TransactionJournal,
  type TransactionState,
  hashBytes,
  isErrno,
  recoveryError,
  restoreCapturedWithoutClobber,
  sameIdentity,
  snapshotRegularFile,
  transactionArtifacts,
  unlinkIfIdentity,
  validateTransactionId,
} from "./bundle-env-transaction-files.ts";

async function validatedBackup(
  state: TransactionState,
): Promise<FileSnapshot | undefined> {
  if (!state.original) return undefined;
  const backup = await snapshotRegularFile(
    state.artifacts.backupPath,
    "Bundle verification backup",
  );
  if (!backup || !backup.bytes.equals(state.original.bytes)) {
    throw recoveryError(
      state,
      "The durable backup is missing or changed; refusing automatic recovery.",
    );
  }
  return backup;
}

async function restoreOriginal(
  state: TransactionState,
  backup: FileSnapshot | undefined,
): Promise<void> {
  if (!state.original || !backup) return;
  try {
    await fs.link(state.artifacts.backupPath, state.targetPath);
  } catch (error) {
    throw recoveryError(
      state,
      isErrno(error, "EEXIST")
        ? "A concurrent file appeared while restoring the original; no file was overwritten."
        : `Unable to restore the original file without clobbering: ${String(error)}`,
    );
  }
  const restored = await snapshotRegularFile(
    state.targetPath,
    "Restored production-local env",
  );
  const currentBackup = await snapshotRegularFile(
    state.artifacts.backupPath,
    "Bundle verification backup",
  );
  if (
    !restored ||
    !currentBackup ||
    !sameIdentity(restored.identity, currentBackup.identity)
  ) {
    throw recoveryError(
      state,
      "The backup changed during restore; preserving all recovery artifacts.",
    );
  }
  await unlinkIfIdentity(
    state.artifacts.backupPath,
    currentBackup.identity,
    "Bundle verification backup",
  );
}

async function removeOwnedTemp(state: TransactionState): Promise<void> {
  const temp = await snapshotRegularFile(
    state.artifacts.injectedTempPath,
    "Bundle verification temporary file",
  );
  if (!temp) return;
  if (!temp.bytes.equals(state.injectedBytes)) {
    throw recoveryError(
      state,
      "The temporary file changed concurrently; preserving it.",
    );
  }
  await unlinkIfIdentity(
    state.artifacts.injectedTempPath,
    temp.identity,
    "Bundle verification temporary file",
  );
}

async function removeOwnedLock(state: TransactionState): Promise<void> {
  const lock = await snapshotRegularFile(
    state.artifacts.lockPath,
    "Bundle verification lock",
  );
  if (!lock) return;
  let journal: TransactionJournal;
  try {
    journal = JSON.parse(lock.bytes.toString("utf8")) as TransactionJournal;
  } catch {
    throw recoveryError(
      state,
      "The lock journal is unreadable; preserving it.",
    );
  }
  if (journal.id !== state.journal.id) {
    throw recoveryError(
      state,
      "The lock journal belongs to another transaction; preserving it.",
    );
  }
  await unlinkIfIdentity(
    state.artifacts.lockPath,
    lock.identity,
    "Bundle verification lock",
  );
}

async function finishCleanup(
  state: TransactionState,
  capture?: FileSnapshot,
): Promise<void> {
  if (capture) {
    await unlinkIfIdentity(
      state.artifacts.restoreCapturePath,
      capture.identity,
      "Captured injected environment",
    );
  }
  await removeOwnedTemp(state);
  const journalTemp = await snapshotRegularFile(
    state.artifacts.journalTempPath,
    "Bundle verification journal temp",
  );
  if (journalTemp) {
    await unlinkIfIdentity(
      state.artifacts.journalTempPath,
      journalTemp.identity,
      "Bundle verification journal temp",
    );
  }
  await removeOwnedLock(state);
}

export async function cleanupTransaction(
  state: TransactionState,
): Promise<void> {
  const backup = await validatedBackup(state);
  const originalCapture = await snapshotRegularFile(
    state.artifacts.originalCapturePath,
    "Captured original environment",
  );
  if (originalCapture) {
    if (
      !state.original ||
      !originalCapture.bytes.equals(state.original.bytes) ||
      (state.journal.originalIdentity &&
        !sameIdentity(originalCapture.identity, state.journal.originalIdentity))
    ) {
      throw recoveryError(
        state,
        "The captured original changed; refusing automatic recovery.",
      );
    }
    const currentTarget = await snapshotRegularFile(
      state.targetPath,
      "Production-local env",
    );
    if (!currentTarget) {
      await restoreOriginal(state, backup);
      await unlinkIfIdentity(
        state.artifacts.originalCapturePath,
        originalCapture.identity,
        "Captured original environment",
      );
      await finishCleanup(state);
      return;
    }
    if (!currentTarget.bytes.equals(state.injectedBytes)) {
      throw recoveryError(
        state,
        "The target changed while the original was captured; preserving both.",
      );
    }
    await unlinkIfIdentity(
      state.artifacts.originalCapturePath,
      originalCapture.identity,
      "Captured original environment",
    );
  }

  const interruptedCapture = await snapshotRegularFile(
    state.artifacts.restoreCapturePath,
    "Captured injected environment",
  );
  if (interruptedCapture) {
    if (
      !interruptedCapture.bytes.equals(state.injectedBytes) ||
      (state.journal.injectedIdentity &&
        !sameIdentity(
          interruptedCapture.identity,
          state.journal.injectedIdentity,
        ))
    ) {
      throw recoveryError(
        state,
        "The interrupted cleanup capture is not owned by this transaction.",
      );
    }
    const currentTarget = await snapshotRegularFile(
      state.targetPath,
      "Production-local env",
    );
    if (currentTarget) {
      throw recoveryError(
        state,
        "A concurrent file appeared during interrupted cleanup; preserving both.",
      );
    }
    await restoreOriginal(state, backup);
    await finishCleanup(state, interruptedCapture);
    return;
  }

  const target = await snapshotRegularFile(
    state.targetPath,
    "Production-local env",
  );
  if (!target) {
    await restoreOriginal(state, backup);
    await finishCleanup(state);
    return;
  }

  await fs.rename(state.targetPath, state.artifacts.restoreCapturePath);
  const captured = await snapshotRegularFile(
    state.artifacts.restoreCapturePath,
    "Captured production-local env",
  );
  if (!captured) {
    throw recoveryError(state, "The target disappeared during cleanup.");
  }
  const ownsCapture =
    captured.bytes.equals(state.injectedBytes) &&
    (!state.journal.injectedIdentity ||
      sameIdentity(captured.identity, state.journal.injectedIdentity));
  if (!ownsCapture) {
    const restored = await restoreCapturedWithoutClobber(
      state.artifacts.restoreCapturePath,
      state.targetPath,
      captured,
    );
    throw recoveryError(
      state,
      restored
        ? "The injected target was modified or replaced concurrently; the concurrent file was put back unchanged."
        : "The injected target was modified or replaced concurrently; it remains at the captured-file path.",
    );
  }

  await restoreOriginal(state, backup);
  await finishCleanup(state, captured);
}

function parseJournal(contents: Buffer, lockPath: string): TransactionJournal {
  let journal: TransactionJournal;
  try {
    journal = JSON.parse(contents.toString("utf8")) as TransactionJournal;
  } catch {
    throw new Error(
      `Bundle verification lock is unreadable. Inspect and recover it manually: ${lockPath}`,
    );
  }
  if (
    journal.version !== 1 ||
    !Number.isInteger(journal.pid) ||
    typeof journal.originalExists !== "boolean"
  ) {
    throw new Error(
      `Bundle verification lock has an unsupported journal. Inspect it manually: ${lockPath}`,
    );
  }
  validateTransactionId(journal.id);
  return journal;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !isErrno(error, "ESRCH");
  }
}

export async function recoverExistingTransaction(
  targetPath: string,
  isProcessAlive: (pid: number) => boolean = processIsAlive,
): Promise<void> {
  const lockPath = `${targetPath}.mediago-bundle-env.lock`;
  const lock = await snapshotRegularFile(lockPath, "Bundle verification lock");
  if (!lock) return;
  const journal = parseJournal(lock.bytes, lockPath);
  if (isProcessAlive(journal.pid)) {
    throw new Error(
      `Bundle verification is already active (pid ${journal.pid}). Lock: ${lockPath}`,
    );
  }
  const artifacts = transactionArtifacts(targetPath, journal.id);
  let original: FileSnapshot | undefined;
  if (journal.originalExists) {
    original = await snapshotRegularFile(
      artifacts.backupPath,
      "Bundle verification backup",
    );
    if (!original || hashBytes(original.bytes) !== journal.originalHash) {
      throw new Error(
        `Cannot recover bundle verification: backup is missing or changed. Backup: ${artifacts.backupPath}; lock: ${lockPath}`,
      );
    }
  }
  const expectedInjectedBytes = buildInjectedEnvironmentBytes(
    original?.bytes ?? Buffer.alloc(0),
  );
  if (hashBytes(expectedInjectedBytes) !== journal.injectedHash) {
    throw new Error(
      `Cannot recover bundle verification: journal hash mismatch. Lock: ${lockPath}`,
    );
  }
  await cleanupTransaction({
    artifacts,
    injectedBytes: expectedInjectedBytes,
    journal,
    original,
    targetPath,
  });
}
