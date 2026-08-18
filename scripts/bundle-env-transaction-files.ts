import { createHash } from "node:crypto";
import fs from "node:fs/promises";

export type FileIdentity = {
  dev: string;
  ino: string;
};

export type FileSnapshot = {
  bytes: Buffer;
  identity: FileIdentity;
  mode: number;
};

export type TransactionArtifacts = {
  backupPath: string;
  injectedTempPath: string;
  journalTempPath: string;
  lockPath: string;
  originalCapturePath: string;
  restoreCapturePath: string;
};

export type TransactionJournal = {
  id: string;
  injectedHash: string;
  injectedIdentity?: FileIdentity;
  originalExists: boolean;
  originalHash: string;
  originalIdentity?: FileIdentity;
  pid: number;
  version: 1;
};

export type TransactionState = {
  artifacts: TransactionArtifacts;
  injectedBytes: Buffer;
  journal: TransactionJournal;
  original: FileSnapshot | undefined;
  targetPath: string;
};

export function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function identityOf(stat: {
  dev: number | bigint;
  ino: number | bigint;
}): FileIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino) };
}

export function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

export function hashBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function snapshotRegularFile(
  filename: string,
  label: string,
): Promise<FileSnapshot | undefined> {
  let stat;
  try {
    stat = await fs.lstat(filename);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(
      `${label} is a symbolic link; refusing to modify it: ${filename}`,
    );
  }
  if (!stat.isFile()) {
    throw new Error(`${label} must be a regular file: ${filename}`);
  }
  return {
    bytes: await fs.readFile(filename),
    identity: identityOf(stat),
    mode: stat.mode & 0o777,
  };
}

export function transactionArtifacts(
  targetPath: string,
  id: string,
): TransactionArtifacts {
  const prefix = `${targetPath}.mediago-bundle-env.${id}`;
  return {
    backupPath: `${prefix}.backup`,
    injectedTempPath: `${prefix}.temp`,
    journalTempPath: `${prefix}.journal-temp`,
    lockPath: `${targetPath}.mediago-bundle-env.lock`,
    originalCapturePath: `${prefix}.original-captured`,
    restoreCapturePath: `${prefix}.restore-captured`,
  };
}

export function validateTransactionId(id: string): void {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
    throw new Error(`Invalid bundle verification transaction id: ${id}`);
  }
}

export async function writeExclusiveFile(
  filename: string,
  contents: Buffer | string,
  mode = 0o600,
): Promise<void> {
  const handle = await fs.open(filename, "wx", mode);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export function serializeJournal(journal: TransactionJournal): string {
  return `${JSON.stringify(journal)}\n`;
}

export async function rewriteJournal(state: TransactionState): Promise<void> {
  await writeExclusiveFile(
    state.artifacts.journalTempPath,
    serializeJournal(state.journal),
  );
  await fs.rename(state.artifacts.journalTempPath, state.artifacts.lockPath);
}

export function recoveryError(state: TransactionState, detail: string): Error {
  return new Error(
    `${detail}\nTarget: ${state.targetPath}\nBackup: ${state.artifacts.backupPath}\nLock/journal: ${state.artifacts.lockPath}\nCaptured file: ${state.artifacts.restoreCapturePath}`,
  );
}

export async function unlinkIfIdentity(
  filename: string,
  expectedIdentity: FileIdentity,
  label: string,
): Promise<void> {
  const current = await snapshotRegularFile(filename, label);
  if (!current) return;
  if (!sameIdentity(current.identity, expectedIdentity)) {
    throw new Error(
      `${label} was replaced concurrently; preserving it: ${filename}`,
    );
  }
  await fs.unlink(filename);
}

export async function restoreCapturedWithoutClobber(
  capturedPath: string,
  targetPath: string,
  captured: FileSnapshot,
): Promise<boolean> {
  try {
    await fs.link(capturedPath, targetPath);
  } catch (error) {
    if (isErrno(error, "EEXIST") || isErrno(error, "EPERM")) return false;
    throw error;
  }
  const restored = await snapshotRegularFile(
    targetPath,
    "Restored concurrent target",
  );
  if (!restored || !sameIdentity(restored.identity, captured.identity)) {
    return false;
  }
  await unlinkIfIdentity(
    capturedPath,
    captured.identity,
    "Captured concurrent target",
  );
  return true;
}
