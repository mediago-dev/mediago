import {
  type FileSnapshot,
  type TransactionJournal,
  type TransactionPhase,
  type TransactionState,
  hashBytes,
  recoveryError,
  sameIdentity,
  serializeJournal,
  snapshotRegularFile,
  unlinkIfIdentity,
  validateTransactionId,
} from "./bundle-env-transaction-files.ts";

const phases = new Set<TransactionPhase>([
  "locked",
  "backed-up",
  "captured",
  "injected",
  "restored",
  "complete",
]);

export function hasHash(snapshot: FileSnapshot, expectedHash: string): boolean {
  return hashBytes(snapshot.bytes) === expectedHash;
}

function ownsOriginal(
  state: TransactionState,
  snapshot: FileSnapshot,
): boolean {
  return (
    hasHash(snapshot, state.journal.originalHash) &&
    Boolean(
      state.journal.originalIdentity &&
      sameIdentity(snapshot.identity, state.journal.originalIdentity),
    )
  );
}

export function ownsInjected(
  state: TransactionState,
  snapshot: FileSnapshot,
  injectedTemp: FileSnapshot | undefined,
): boolean {
  if (!hasHash(snapshot, state.journal.injectedHash)) return false;
  return Boolean(
    (state.journal.injectedIdentity &&
      sameIdentity(snapshot.identity, state.journal.injectedIdentity)) ||
    (injectedTemp && sameIdentity(snapshot.identity, injectedTemp.identity)),
  );
}

export async function validatedBackup(
  state: TransactionState,
): Promise<FileSnapshot | undefined> {
  const backup = await snapshotRegularFile(
    state.artifacts.backupPath,
    "Bundle verification backup",
  );
  if (backup && !hasHash(backup, state.journal.originalHash)) {
    throw recoveryError(
      state,
      "The durable backup changed; refusing automatic recovery.",
    );
  }
  if (!state.journal.originalExists) {
    if (backup) {
      throw recoveryError(
        state,
        "An unexpected backup exists for an originally absent target.",
      );
    }
    return undefined;
  }
  const backupRequired = !["locked", "complete"].includes(state.journal.phase);
  if (!backup && backupRequired) {
    throw recoveryError(
      state,
      "The durable backup is missing; refusing automatic recovery.",
    );
  }
  return backup;
}

export async function validatedOriginalCapture(
  state: TransactionState,
): Promise<FileSnapshot | undefined> {
  const capture = await snapshotRegularFile(
    state.artifacts.originalCapturePath,
    "Captured original environment",
  );
  if (capture && !ownsOriginal(state, capture)) {
    throw recoveryError(
      state,
      "The captured original changed; refusing automatic recovery.",
    );
  }
  return capture;
}

export async function validatedInjectedTemp(
  state: TransactionState,
): Promise<FileSnapshot | undefined> {
  const temporary = await snapshotRegularFile(
    state.artifacts.injectedTempPath,
    "Bundle verification temporary file",
  );
  if (temporary && !hasHash(temporary, state.journal.injectedHash)) {
    throw recoveryError(
      state,
      "The injected temporary file changed; preserving it.",
    );
  }
  return temporary;
}

export async function validatedRestoreCapture(
  state: TransactionState,
  injectedTemp: FileSnapshot | undefined,
): Promise<FileSnapshot | undefined> {
  const capture = await snapshotRegularFile(
    state.artifacts.restoreCapturePath,
    "Captured injected environment",
  );
  if (capture && !ownsInjected(state, capture, injectedTemp)) {
    throw recoveryError(
      state,
      "The interrupted cleanup capture is not owned by this transaction.",
    );
  }
  return capture;
}

export function parseJournal(
  contents: Buffer,
  lockPath: string,
): TransactionJournal {
  let journal: TransactionJournal;
  try {
    journal = JSON.parse(contents.toString("utf8")) as TransactionJournal;
  } catch {
    throw new Error(
      `Bundle verification lock is unreadable. Inspect and recover it manually: ${lockPath}`,
    );
  }
  if (
    journal.version !== 2 ||
    !Number.isInteger(journal.pid) ||
    typeof journal.originalExists !== "boolean" ||
    typeof journal.originalHash !== "string" ||
    typeof journal.injectedHash !== "string" ||
    !phases.has(journal.phase)
  ) {
    throw new Error(
      `Bundle verification lock has an unsupported journal. Inspect it manually: ${lockPath}`,
    );
  }
  validateTransactionId(journal.id);
  return journal;
}

export async function removeOwnedJournalTemp(
  state: TransactionState,
): Promise<void> {
  const temporary = await snapshotRegularFile(
    state.artifacts.journalTempPath,
    "Bundle verification journal temp",
  );
  if (!temporary) return;
  const journal = parseJournal(
    temporary.bytes,
    state.artifacts.journalTempPath,
  );
  if (journal.id !== state.journal.id) {
    throw recoveryError(
      state,
      "The journal temp belongs to another transaction; preserving it.",
    );
  }
  await unlinkIfIdentity(
    state.artifacts.journalTempPath,
    temporary.identity,
    "Bundle verification journal temp",
  );
}

export async function removeResidualArtifacts(
  state: TransactionState,
): Promise<void> {
  const injectedTemp = await validatedInjectedTemp(state);
  const restoreCapture = await validatedRestoreCapture(state, injectedTemp);
  const originalCapture = await validatedOriginalCapture(state);
  const backup = await validatedBackup(state);
  for (const [filename, snapshot, label] of [
    [
      state.artifacts.restoreCapturePath,
      restoreCapture,
      "Captured injected environment",
    ],
    [
      state.artifacts.originalCapturePath,
      originalCapture,
      "Captured original environment",
    ],
    [
      state.artifacts.injectedTempPath,
      injectedTemp,
      "Bundle verification temporary file",
    ],
    [state.artifacts.backupPath, backup, "Bundle verification backup"],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- Ordered deletion leaves a recoverable suffix after each step.
    if (snapshot) await unlinkIfIdentity(filename, snapshot.identity, label);
  }
  await removeOwnedJournalTemp(state);

  const lock = await snapshotRegularFile(
    state.artifacts.lockPath,
    "Bundle verification lock",
  );
  if (!lock) return;
  if (!lock.bytes.equals(Buffer.from(serializeJournal(state.journal)))) {
    throw recoveryError(
      state,
      "The lock journal changed concurrently; preserving it.",
    );
  }
  await unlinkIfIdentity(
    state.artifacts.lockPath,
    lock.identity,
    "Bundle verification lock",
  );
}
