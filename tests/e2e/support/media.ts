import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startMediaServer } from "../../media-service/server.ts";

const MANIFEST_PATH = fileURLToPath(
  new URL("../../media-service/public/v1/manifest.json", import.meta.url),
);
const SUMMARY_FILE_LIMIT = 24;
const SUMMARY_BYTE_LIMIT = 4_096;

interface FixtureManifest {
  schemaVersion: number;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

interface FileSummary {
  absolutePath: string;
  relativePath: string;
  size: number;
}

export interface MediaFixture {
  baseURL: string;
  sampleURL: string;
  sample: { size: number; sha256: string };
  close(): Promise<void>;
}

async function loadSampleMetadata(): Promise<MediaFixture["sample"]> {
  const manifest = JSON.parse(
    await readFile(MANIFEST_PATH, "utf8"),
  ) as FixtureManifest;
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("Committed v1 media manifest has an invalid schema");
  }
  const sample = manifest.files.find((file) => file.path === "sample.mp4");
  if (
    !sample ||
    !Number.isSafeInteger(sample.size) ||
    sample.size <= 0 ||
    !/^[a-f0-9]{64}$/.test(sample.sha256)
  ) {
    throw new Error(
      "Committed v1 media manifest has invalid sample.mp4 metadata",
    );
  }
  return { size: sample.size, sha256: sample.sha256 };
}

export async function loadMediaFixture(): Promise<MediaFixture> {
  const sample = await loadSampleMetadata();
  const server = await startMediaServer();
  return {
    baseURL: server.baseURL,
    sampleURL: `${server.baseURL}/sample.mp4`,
    sample,
    close: server.close,
  };
}

async function listRegularFiles(
  root: string,
  directory = root,
): Promise<FileSummary[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry): Promise<FileSummary[]> => {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) return listRegularFiles(root, absolutePath);
        if (!entry.isFile()) return [];
        const info = await stat(absolutePath);
        return [
          {
            absolutePath,
            relativePath: path.relative(root, absolutePath),
            size: info.size,
          },
        ];
      }),
  );
  return nested.flat();
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

function boundedDirectorySummary(
  directory: string,
  files: readonly FileSummary[],
  matches: readonly FileSummary[],
): string {
  const visible = files.slice(0, SUMMARY_FILE_LIMIT);
  const omitted = files.length - visible.length;
  const summary = [
    `Fixture verification in ${path.basename(path.resolve(directory))}: ${matches.length} exact matches among ${files.length} regular files.`,
    ...visible.map(
      (file) => `${file.relativePath || "."} (${file.size} bytes)`,
    ),
    ...(omitted > 0 ? [`... ${omitted} more files omitted`] : []),
  ].join("\n");
  return summary.slice(0, SUMMARY_BYTE_LIMIT);
}

export async function verifyFixtureCopy(directory: string): Promise<string> {
  const sample = await loadSampleMetadata();
  const files = await listRegularFiles(path.resolve(directory));
  const candidates = files.filter((file) => file.size === sample.size);
  const matchingFlags = await Promise.all(
    candidates.map(
      async (file) => (await sha256(file.absolutePath)) === sample.sha256,
    ),
  );
  const matches = candidates.filter((_, index) => matchingFlags[index]);

  if (matches.length !== 1) {
    const prefix =
      matches.length === 0
        ? "No exact committed media fixture copy was found."
        : "Multiple committed media fixture copies were found.";
    throw new Error(
      `${prefix}\n${boundedDirectorySummary(directory, files, matches)}`.slice(
        0,
        SUMMARY_BYTE_LIMIT,
      ),
    );
  }
  return matches[0].absolutePath;
}
