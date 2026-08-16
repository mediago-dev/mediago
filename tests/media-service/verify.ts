import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { FixtureManifest } from "./generate.ts";

const LOCAL_MANIFEST = fileURLToPath(
  new URL("./public/v1/manifest.json", import.meta.url),
);
const DEFAULT_TIMEOUT_MS = 5_000;
const MANIFEST_MAX_BYTES = 64 * 1024;

export interface VerifyMediaServiceOptions {
  timeoutMs?: number;
}

function assertObject(
  value: unknown,
  description: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${description} must be an object`);
  }
}

function assertKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  description: string,
): void {
  const actual = Object.keys(value).toSorted();
  const sortedExpected = expected.toSorted();
  if (!isDeepStrictEqual(actual, sortedExpected)) {
    throw new Error(
      `${description} must have keys ${sortedExpected.join(", ")}; received ${actual.join(", ")}`,
    );
  }
}

function parseManifest(value: unknown, description: string): FixtureManifest {
  assertObject(value, description);
  assertKeys(
    value,
    ["schemaVersion", "fixtureVersion", "generator", "files"],
    description,
  );
  if (value.schemaVersion !== 1) {
    throw new Error(`${description}.schemaVersion must be 1`);
  }
  if (
    typeof value.fixtureVersion !== "string" ||
    !/^v\d+$/.test(value.fixtureVersion)
  ) {
    throw new Error(`${description}.fixtureVersion must look like v1`);
  }

  assertObject(value.generator, `${description}.generator`);
  assertKeys(value.generator, ["name", "version"], `${description}.generator`);
  if (
    value.generator.name !== "ffmpeg" ||
    typeof value.generator.version !== "string" ||
    !value.generator.version.startsWith("ffmpeg version ")
  ) {
    throw new Error(`${description}.generator must identify an ffmpeg version`);
  }

  if (!Array.isArray(value.files)) {
    throw new Error(`${description}.files must be an array`);
  }
  const seenPaths = new Set<string>();
  for (const [index, entry] of value.files.entries()) {
    const entryDescription = `${description}.files[${index}]`;
    assertObject(entry, entryDescription);
    assertKeys(entry, ["path", "size", "sha256"], entryDescription);
    if (
      typeof entry.path !== "string" ||
      entry.path.length === 0 ||
      path.posix.isAbsolute(entry.path) ||
      path.posix.normalize(entry.path) !== entry.path ||
      entry.path.split("/").includes("..") ||
      entry.path === "manifest.json"
    ) {
      throw new Error(`${entryDescription}.path is not a safe fixture path`);
    }
    if (seenPaths.has(entry.path)) {
      throw new Error(`${description} contains duplicate path ${entry.path}`);
    }
    seenPaths.add(entry.path);
    if (!Number.isSafeInteger(entry.size) || (entry.size as number) <= 0) {
      throw new Error(`${entryDescription}.size must be a positive integer`);
    }
    if (
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    ) {
      throw new Error(`${entryDescription}.sha256 must be lowercase SHA256`);
    }
  }

  return value as unknown as FixtureManifest;
}

function fixtureURL(baseURL: string, relativePath: string): URL {
  const url = new URL(baseURL);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${relativePath}`;
  url.search = "";
  url.hash = "";
  return url;
}

async function consumeResponse(
  response: Response,
  description: string,
  maxBytes: number,
  exceededMessage: string,
  consumeChunk: (chunk: Uint8Array) => void,
): Promise<number> {
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`${description} returned HTTP ${response.status}`);
  }

  const declaredLength = response.headers.get("content-length");
  if (
    declaredLength !== null &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > maxBytes
  ) {
    await response.body?.cancel();
    throw new Error(exceededMessage);
  }

  if (!response.body) return 0;
  const reader = response.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      // Stream chunks must be consumed sequentially to enforce the byte limit.
      // oxlint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop
        await reader.cancel();
        throw new Error(exceededMessage);
      }
      consumeChunk(value);
    }
  } finally {
    reader.releaseLock();
  }
  return receivedBytes;
}

async function fetchWithTimeout<T>(
  url: URL,
  description: string,
  timeoutMs: number,
  consume: (response: Response) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timeout.unref();

  try {
    const response = await fetch(url, { signal: controller.signal });
    return await consume(response);
  } catch (error) {
    if (timedOut) {
      throw new Error(`${description} timed out after ${timeoutMs} ms`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchManifest(
  baseURL: string,
  timeoutMs: number,
): Promise<Buffer> {
  return fetchWithTimeout(
    fixtureURL(baseURL, "manifest.json"),
    "Remote manifest",
    timeoutMs,
    async (response) => {
      const chunks: Buffer[] = [];
      const size = await consumeResponse(
        response,
        "Remote manifest",
        MANIFEST_MAX_BYTES,
        `Remote manifest exceeds ${MANIFEST_MAX_BYTES}-byte limit`,
        (chunk) => chunks.push(Buffer.from(chunk)),
      );
      return Buffer.concat(chunks, size);
    },
  );
}

async function verifyRemoteFile(
  baseURL: string,
  file: FixtureManifest["files"][number],
  timeoutMs: number,
): Promise<void> {
  const description = `Remote file ${file.path}`;
  await fetchWithTimeout(
    fixtureURL(baseURL, file.path),
    description,
    timeoutMs,
    async (response) => {
      const hash = createHash("sha256");
      const size = await consumeResponse(
        response,
        description,
        file.size,
        `${description} exceeds expected size of ${file.size} bytes`,
        (chunk) => hash.update(chunk),
      );
      if (size !== file.size) {
        throw new Error(
          `${description} has size ${size}; expected ${file.size}`,
        );
      }
      const sha256 = hash.digest("hex");
      if (sha256 !== file.sha256) {
        throw new Error(
          `${description} has SHA256 ${sha256}; expected ${file.sha256}`,
        );
      }
    },
  );
}

export async function verifyMediaService(
  baseURL: string,
  options: VerifyMediaServiceOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("timeoutMs must be a positive integer");
  }
  const localManifest = parseManifest(
    JSON.parse(await readFile(LOCAL_MANIFEST, "utf8")) as unknown,
    "Committed manifest",
  );

  const manifestBody = await fetchManifest(baseURL, timeoutMs);
  let remoteValue: unknown;
  try {
    remoteValue = JSON.parse(manifestBody.toString("utf8")) as unknown;
  } catch (error) {
    throw new Error("Remote manifest is not valid JSON", { cause: error });
  }
  const remoteManifest = parseManifest(remoteValue, "Remote manifest");
  if (!isDeepStrictEqual(remoteManifest, localManifest)) {
    throw new Error("Remote manifest does not match the committed manifest");
  }

  await Promise.all(
    localManifest.files.map((file) =>
      verifyRemoteFile(baseURL, file, timeoutMs),
    ),
  );
}

async function main(): Promise<void> {
  const [baseURL, ...extra] = process.argv.slice(2);
  if (!baseURL || extra.length > 0) {
    throw new Error(
      "Usage: pnpm exec tsx tests/media-service/verify.ts https://example.test/v1",
    );
  }
  await verifyMediaService(baseURL);
  process.stdout.write(
    `Verified media fixture at ${baseURL.replace(/\/+$/, "")}\n`,
  );
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entryPoint === import.meta.url) {
  await main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
