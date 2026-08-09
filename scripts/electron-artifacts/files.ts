import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

export async function fileDigest(
  file: string,
  algorithm: "sha256" | "sha512",
  encoding: "base64" | "hex",
): Promise<string> {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(encoding);
}

export async function listFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listFiles(entryPath);
      return entry.isFile() ? [entryPath] : [];
    }),
  );
  return files.flat();
}

export async function filesHaveSameContents(
  left: string,
  right: string,
): Promise<boolean> {
  const [leftInfo, rightInfo] = await Promise.all([stat(left), stat(right)]);
  if (leftInfo.size !== rightInfo.size) return false;

  const [leftDigest, rightDigest] = await Promise.all([
    fileDigest(left, "sha256", "hex"),
    fileDigest(right, "sha256", "hex"),
  ]);
  return leftDigest === rightDigest;
}
