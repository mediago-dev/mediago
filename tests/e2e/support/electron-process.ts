import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import type { ElectronApplication } from "@playwright/test";

const TERMINATION_GRACE_MS = 3_000;

export interface ProcessIdentity {
  pid: number;
  startTime: string;
}

export async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function readProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0 || Number(stat.slice(0, stat.indexOf(" "))) !== pid) {
      throw new Error(`Malformed /proc stat for PID ${pid}`);
    }
    const fields = stat
      .slice(commandEnd + 2)
      .trim()
      .split(/\s+/);
    // Zombies have exited and cannot hold ports or receive signals.
    if (fields[0] === "Z" || fields[0] === "X") return undefined;
    const startTime = fields[19];
    if (!startTime)
      throw new Error(`Missing process start time for PID ${pid}`);
    return { pid, startTime };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return undefined;
    throw error;
  }
}

export async function identityIsAlive(
  identity: ProcessIdentity,
): Promise<boolean> {
  const current = await readProcessIdentity(identity.pid);
  return current?.startTime === identity.startTime;
}

export async function collectOwnedProcessTree(
  root: ProcessIdentity,
): Promise<ProcessIdentity[]> {
  const collected: ProcessIdentity[] = [];
  const visited = new Set<number>();

  const visit = async (identity: ProcessIdentity): Promise<void> => {
    if (visited.has(identity.pid) || !(await identityIsAlive(identity))) return;
    visited.add(identity.pid);
    let children = "";
    try {
      children = await readFile(
        `/proc/${identity.pid}/task/${identity.pid}/children`,
        "utf8",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ESRCH") throw error;
    }
    await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(async (value) => {
          const child = await readProcessIdentity(Number(value));
          if (child) await visit(child);
        }),
    );
    if (await identityIsAlive(identity)) collected.push(identity);
  };

  await visit(root);
  return collected;
}

async function waitForIdentitiesExit(
  identities: readonly ProcessIdentity[],
  timeoutMs: number,
): Promise<ProcessIdentity[]> {
  const deadline = Date.now() + timeoutMs;
  const poll = async (
    candidates: readonly ProcessIdentity[],
  ): Promise<ProcessIdentity[]> => {
    const alive = (
      await Promise.all(
        candidates.map(async (identity) => ({
          identity,
          alive: await identityIsAlive(identity),
        })),
      )
    ).flatMap((result) => (result.alive ? [result.identity] : []));
    if (alive.length === 0) return [];
    if (Date.now() >= deadline) return alive;
    await delay(50);
    return poll(alive);
  };
  return poll(identities);
}

async function signalIdentities(
  identities: readonly ProcessIdentity[],
  signal: NodeJS.Signals,
): Promise<void> {
  await Promise.all(
    identities.map(async (identity) => {
      if (!(await identityIsAlive(identity))) return;
      if (identity.pid <= 1 || identity.pid === process.pid) {
        throw new Error(`Refusing to signal unsafe PID ${identity.pid}`);
      }
      try {
        process.kill(identity.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }),
  );
}

export async function terminateOwnedProcessTree(
  root: ProcessIdentity,
  knownProcesses: readonly ProcessIdentity[] = [],
): Promise<void> {
  const currentTree = await collectOwnedProcessTree(root);
  const identitiesByPid = new Map(
    [...knownProcesses, ...currentTree].map((identity) => [
      identity.pid,
      identity,
    ]),
  );
  const tree = [...identitiesByPid.values()];
  if (tree.length === 0) return;
  await signalIdentities(tree, "SIGTERM");
  const survivors = await waitForIdentitiesExit(tree, TERMINATION_GRACE_MS);
  if (survivors.length === 0) return;
  await signalIdentities(survivors, "SIGKILL");
  const stubborn = await waitForIdentitiesExit(survivors, TERMINATION_GRACE_MS);
  if (stubborn.length > 0) {
    throw new Error(
      `Owned Electron process(es) did not exit: ${stubborn
        .map((identity) => identity.pid)
        .join(", ")}`,
    );
  }
}

export async function closeElectron(
  application: ElectronApplication | undefined,
  identity: ProcessIdentity | undefined,
  timeoutMs = 5_000,
): Promise<void> {
  if (!application) return;
  const errors: unknown[] = [];
  let ownedProcesses: ProcessIdentity[] = [];
  if (identity) {
    try {
      // Snapshot before closing: descendants can outlive a parent that exits.
      ownedProcesses = await collectOwnedProcessTree(identity);
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    await withDeadline(
      application.close(),
      timeoutMs,
      "Electron graceful close",
    );
  } catch (error) {
    errors.push(error);
  }
  if (identity) {
    try {
      await terminateOwnedProcessTree(identity, ownedProcesses);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(errors, "Electron cleanup failed", {
      cause: errors[0],
    });
  }
}
