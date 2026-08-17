import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REQUIRED_SHA256_DEPENDENCIES = new Set(["aria2:linux-x64"]);

export function resolveDependencySha256(
  toolName: string,
  platformKey: string,
  configuredSha256: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const expectedSha256 = configuredSha256?.[platformKey];
  if (
    expectedSha256 === undefined &&
    REQUIRED_SHA256_DEPENDENCIES.has(`${toolName}:${platformKey}`)
  ) {
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
): Promise<boolean> {
  if (expectedSha256 !== undefined && !SHA256_PATTERN.test(expectedSha256)) {
    throw new Error("Expected SHA-256 must be 64 lowercase hexadecimal digits");
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  return (
    expectedSha256 === undefined ||
    (await sha256File(filePath)) === expectedSha256
  );
}

export async function assertDependencyFileIntegrity(
  filePath: string,
  expectedSha256: string | undefined,
  description: string,
): Promise<void> {
  if (await dependencyFileMatchesIntegrity(filePath, expectedSha256)) return;
  const requirement = expectedSha256 === undefined ? "file" : "SHA-256";
  throw new Error(
    `${description} failed ${requirement} integrity verification`,
  );
}
