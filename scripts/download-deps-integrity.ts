import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { isDependencyToolName } from "./dependency-layout.ts";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export interface DependencyIntegrityOptions {
  requireExecutable?: boolean;
}

export type DependencyFileIntegrityStatus =
  | "ready"
  | "missing"
  | "corrupt"
  | "not-executable";

export function resolveDependencySha256(
  toolName: string,
  platformKey: string,
  configuredSha256: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const expectedSha256 = configuredSha256?.[platformKey];
  if (expectedSha256 === undefined && isDependencyToolName(toolName)) {
    throw new Error(
      `${toolName} on ${platformKey} requires a pinned SHA-256 checksum`,
    );
  }
  if (expectedSha256 !== undefined && !SHA256_PATTERN.test(expectedSha256)) {
    throw new Error(
      `${toolName} on ${platformKey} has an invalid SHA-256 checksum`,
    );
  }
  return expectedSha256;
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export async function dependencyFileMatchesIntegrity(
  filePath: string,
  expectedSha256?: string,
  options: DependencyIntegrityOptions = {},
): Promise<boolean> {
  return (
    (await inspectDependencyFileIntegrity(
      filePath,
      expectedSha256,
      options,
    )) === "ready"
  );
}

export async function inspectDependencyFileIntegrity(
  filePath: string,
  expectedSha256?: string,
  options: DependencyIntegrityOptions = {},
): Promise<DependencyFileIntegrityStatus> {
  if (expectedSha256 !== undefined && !SHA256_PATTERN.test(expectedSha256)) {
    throw new Error("Expected SHA-256 must be 64 lowercase hexadecimal digits");
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) return "corrupt";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }

  if (
    expectedSha256 !== undefined &&
    (await sha256File(filePath)) !== expectedSha256
  ) {
    return "corrupt";
  }

  if (options.requireExecutable && (fileStat.mode & 0o111) === 0) {
    return "not-executable";
  }
  return "ready";
}

export async function assertDependencyFileIntegrity(
  filePath: string,
  expectedSha256: string | undefined,
  description: string,
  options: DependencyIntegrityOptions = {},
): Promise<void> {
  if (await dependencyFileMatchesIntegrity(filePath, expectedSha256, options)) {
    return;
  }
  const requirements = [expectedSha256 === undefined ? "file" : "SHA-256"];
  if (options.requireExecutable) requirements.push("executable");
  throw new Error(
    `${description} failed ${requirements.join(" and ")} integrity verification`,
  );
}
