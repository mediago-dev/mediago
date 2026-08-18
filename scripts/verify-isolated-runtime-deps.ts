import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { constants } from "node:fs";
import { access, lstat, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import manifestJson from "./deps-versions.json" with { type: "json" };
import {
  dependencyExecutablePath,
  isWindowsPlatformKey,
  platformKeyFor,
  type PinnedDependencyManifest,
  type RuntimePlatform,
} from "./dependency-layout.ts";
import { inspectDependencyReadiness } from "./download-deps-provisioner.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifest: PinnedDependencyManifest = manifestJson;
const RUNTIME_ROOT_PREFIX = "mediago-runtime-";
const RAW_OUTPUT_BYTES = 64 * 1024;
const DIAGNOSTIC_BYTES = 16 * 1024;
const PROVISION_TIMEOUT_MS = 10 * 60 * 1000;

interface CommandResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  spawnError?: Error;
}

interface ExpectedBBDownState {
  repo: string;
  version: string;
  asset: string;
  binaryName: string;
}

export class BoundedTail {
  private value = "";

  append(chunk: unknown): void {
    const bytes = Buffer.from(this.value + String(chunk), "utf8");
    this.value = bytes
      .subarray(Math.max(0, bytes.length - RAW_OUTPUT_BYTES))
      .toString("utf8");
  }

  diagnostic(limit = DIAGNOSTIC_BYTES): string {
    return boundedRedactedDiagnostic(this.value, limit);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function boundedRedactedDiagnostic(
  value: string,
  limit = DIAGNOSTIC_BYTES,
): string {
  const redacted = value
    .replace(
      /(\b(?:authorization|proxy-authorization|cookie|x-api-key|[a-z0-9_]*(?:token|secret|password|api_key)[a-z0-9_]*)\s*[:=]\s*)[^\r\n]*/gi,
      "$1[REDACTED]",
    )
    .replace(
      /(["']?apiKey["']?\s*[:=]\s*)(["'])((?:\\[^\r\n]|(?!\2)[^\\\r\n])*)(\2)/gi,
      "$1$2[REDACTED]$4",
    )
    .replace(/(["']?apiKey["']?\s*[:=]\s*)[^\s&,}"'\r\n]+/gi, "$1[REDACTED]")
    .replace(/(https?:\/\/)[^/@\s]+@/gi, "$1[REDACTED]@")
    .replace(
      /\b(?:github_pat_|gh[opsu]_|sk-)[A-Za-z0-9_-]{8,}\b/g,
      "[REDACTED]",
    );
  const bytes = Buffer.from(redacted, "utf8");
  let result = bytes
    .subarray(Math.max(0, bytes.length - limit))
    .toString("utf8");
  while (Buffer.byteLength(result, "utf8") > limit) result = result.slice(1);
  return result;
}

export function assertOwnedTemporaryRoot(root: string, prefix: string): void {
  if (
    path.dirname(root) !== tmpdir() ||
    !path.basename(root).startsWith(prefix)
  ) {
    throw new Error(
      `Refusing to remove an unowned temporary path; expected ${path.join(tmpdir(), `${prefix}*`)}`,
    );
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function captureError(
  operation: () => Promise<void>,
  errors: string[],
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    errors.push(errorMessage(error));
  }
}

export async function settleWithin<T>(
  operation: Promise<T>,
  timeoutMs: number,
): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function assertSafeRuntimeRoot(root: string): void {
  assertOwnedTemporaryRoot(root, RUNTIME_ROOT_PREFIX);
}

export function assertReadyBBDownState(
  state: unknown,
  expected: ExpectedBBDownState,
): void {
  if (!isRecord(state) || state.schemaVersion !== 1 || !isRecord(state.tools)) {
    throw new Error(
      "Dependency state must use schemaVersion 1 with a tools map",
    );
  }
  const bbdown = state.tools.BBDown;
  if (!isRecord(bbdown)) {
    throw new Error("Dependency state is missing its BBDown readiness record");
  }
  try {
    assert.deepEqual(
      {
        repo: bbdown.repo,
        version: bbdown.version,
        asset: bbdown.asset,
        binaryName: bbdown.binaryName,
      },
      expected,
    );
  } catch (error) {
    throw new Error("BBDown state does not exactly match the pinned manifest", {
      cause: error,
    });
  }
}

export function assertUnsupportedWinArm64Diagnostic(
  output: string,
  expectation: { ffmpegVersion: string; expectedExecutablePath: string },
): void {
  const requirements = [
    ["FFmpeg", "ffmpeg"],
    ["pinned FFmpeg version", expectation.ffmpegVersion],
    ["platform", "win32-arm64"],
    ["expected executable", expectation.expectedExecutablePath],
    [
      "selective retry command",
      "pnpm deps:download:raw --tools ffmpeg --platform win32-arm64",
    ],
  ] as const;
  for (const [label, value] of requirements) {
    if (!output.toLowerCase().includes(value.toLowerCase())) {
      throw new Error(`Unsupported win32-arm64 diagnostic is missing ${label}`);
    }
  }
}

function commandResult(child: ChildProcess): Promise<CommandResult> {
  return new Promise((resolve) => {
    child.once("error", (spawnError) =>
      resolve({ code: null, signal: null, spawnError }),
    );
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
}

async function terminateCommand(
  child: ChildProcess,
  completion: Promise<CommandResult>,
): Promise<void> {
  const pid = child.pid;
  if (pid === undefined) return;
  if (process.platform !== "win32") {
    const { stopOwnedProcessGroup } = await import("./smoke-dev-all.ts");
    await stopOwnedProcessGroup(pid, completion);
    return;
  }
  const killer = spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
    shell: false,
    stdio: "ignore",
  });
  await once(killer, "close");
}

async function runTaskRuntime(root: string) {
  const output = new BoundedTail();
  const child = spawn("task", ["deps:runtime"], {
    cwd: repositoryRoot,
    detached: process.platform !== "win32",
    env: { ...process.env, MEDIAGO_DEPS_ROOT: root },
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.on("data", (chunk) => output.append(chunk));
  child.stderr?.on("data", (chunk) => output.append(chunk));
  const completion = commandResult(child);
  const result = await settleWithin(completion, PROVISION_TIMEOUT_MS);
  if (!result) {
    await terminateCommand(child, completion);
    throw new Error(
      `task deps:runtime exceeded ${PROVISION_TIMEOUT_MS} ms\n${output.diagnostic()}`,
    );
  }
  return { result, output: output.diagnostic() };
}

function commandFailure(result: CommandResult, output: string): Error {
  const status = result.spawnError
    ? `spawn failed: ${result.spawnError.message}`
    : result.code === null
      ? `terminated by ${result.signal ?? "an unknown signal"}`
      : `exited with code ${result.code}`;
  return new Error(`task deps:runtime ${status}\n${output || "<no output>"}`);
}

async function verifyCompletePlatform(
  root: string,
  platformKey: RuntimePlatform,
  result: CommandResult,
  output: string,
): Promise<string> {
  if (result.code !== 0) throw commandFailure(result, output);
  const tool = manifest.BBDown;
  const asset = tool.assets[platformKey];
  if (!asset)
    throw new Error(`Pinned BBDown asset is missing for ${platformKey}`);
  const executablePath = dependencyExecutablePath(root, platformKey, "BBDown");
  const info = await lstat(executablePath);
  if (!info.isFile() || info.size <= 0) {
    throw new Error(`Expected a nonempty regular BBDown at ${executablePath}`);
  }
  if (!isWindowsPlatformKey(platformKey)) {
    await access(executablePath, constants.X_OK);
  }
  const statePath = path.join(root, ".state", `${platformKey}.json`);
  let state: unknown;
  try {
    state = JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    throw new Error(`Cannot decode dependency state at ${statePath}`, {
      cause: error,
    });
  }
  assertReadyBBDownState(state, {
    repo: tool.repo,
    version: tool.version,
    asset,
    binaryName: path.basename(executablePath),
  });
  const [readiness] = await inspectDependencyReadiness({
    depsRoot: root,
    manifest,
    selectedToolNames: ["BBDown"],
    platformKey,
  });
  if (
    readiness?.status !== "ready" ||
    readiness.executablePath !== executablePath
  ) {
    throw new Error(
      `Canonical BBDown readiness is ${readiness?.status ?? "missing"}`,
    );
  }
  return tool.version;
}

async function verifyUnsupportedWinArm64(
  root: string,
  result: CommandResult,
  output: string,
): Promise<string> {
  if (result.code === 0 || result.spawnError) {
    throw new Error("win32-arm64 runtime must fail at pinned FFmpeg preflight");
  }
  assertUnsupportedWinArm64Diagnostic(output, {
    ffmpegVersion: manifest.ffmpeg.version,
    expectedExecutablePath: dependencyExecutablePath(
      root,
      "win32-arm64",
      "ffmpeg",
    ),
  });
  const statePath = path.join(root, ".state", "win32-arm64.json");
  try {
    await lstat(statePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return manifest.ffmpeg.version;
    }
    throw error;
  }
  throw new Error(`Unsupported win32-arm64 created ready state ${statePath}`);
}

async function runSelfTests(): Promise<void> {
  assertSafeRuntimeRoot(path.join(tmpdir(), `${RUNTIME_ROOT_PREFIX}contract`));
  assert.throws(() => assertSafeRuntimeRoot(path.join(tmpdir(), "not-owned")));
  const redacted = boundedRedactedDiagnostic(
    `${"x".repeat(20_000)}\nAuthorization: secret\napiKey=top-secret\nNPM_TOKEN=registry-secret\nPASSWORD=pass-secret`,
  );
  assert.ok(Buffer.byteLength(redacted) <= DIAGNOSTIC_BYTES);
  assert.doesNotMatch(redacted, /secret/);
  const expected = {
    repo: "owner/repo",
    version: "pinned",
    asset: "BBDown.zip",
    binaryName: "BBDown",
  };
  assertReadyBBDownState(
    { schemaVersion: 1, tools: { BBDown: expected } },
    expected,
  );
  assert.throws(() =>
    assertReadyBBDownState(
      {
        schemaVersion: 1,
        tools: { BBDown: { ...expected, version: "latest" } },
      },
      expected,
    ),
  );
  const expectation = {
    ffmpegVersion: "b6.0",
    expectedExecutablePath: "C:\\deps\\win32-arm64\\ffmpeg.exe",
  };
  assertUnsupportedWinArm64Diagnostic(
    `FFmpeg b6.0 win32-arm64 ${expectation.expectedExecutablePath} pnpm deps:download:raw --tools ffmpeg --platform win32-arm64`,
    expectation,
  );
  assert.throws(() =>
    assertUnsupportedWinArm64Diagnostic("generic failure", expectation),
  );
  process.stdout.write("PASS verify-isolated-runtime-deps self-test\n");
}

async function main(): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), RUNTIME_ROOT_PREFIX));
  assertSafeRuntimeRoot(root);
  let summary: string;
  try {
    const platformKey = platformKeyFor(process.platform, process.arch);
    const { result, output } = await runTaskRuntime(root);
    const version =
      platformKey === "win32-arm64"
        ? await verifyUnsupportedWinArm64(root, result, output)
        : await verifyCompletePlatform(root, platformKey, result, output);
    summary =
      platformKey === "win32-arm64"
        ? `platform=${platformKey} limitation=FFmpeg@${version}`
        : `platform=${platformKey} BBDown=${version}`;
    process.stdout.write(
      `VERIFIED isolated-runtime-deps ${summary} cleanup=pending\n`,
    );
  } finally {
    assertSafeRuntimeRoot(root);
    await rm(root, { recursive: true, force: true });
  }
  process.stdout.write(
    `PASS isolated-runtime-deps ${summary} cleanup=complete\n`,
  );
}

const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
if (isMain) {
  (process.argv.includes("--self-test") ? runSelfTests() : main()).catch(
    (error: unknown) => {
      process.stderr.write(
        `${boundedRedactedDiagnostic(errorMessage(error))}\n`,
      );
      process.exitCode = 1;
    },
  );
}
