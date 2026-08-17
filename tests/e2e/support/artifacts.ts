import { constants, createWriteStream } from "node:fs";
import { lstat, open, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { BrowserContext, Page, TestInfo, Video } from "@playwright/test";
import { redactDiagnostic, type ManagedProcess } from "./process.ts";

const LOG_ATTACHMENT_LIMIT = 16 * 1024;
const LOG_FILE_LIMIT = 32;
const LOG_DIRECTORY_DEPTH_LIMIT = 4;
const DEFAULT_ARTIFACT_OPERATION_TIMEOUT_MS = 2_000;

export interface ManualArtifactPaths {
  artifactsDir: string;
  videoDir: string;
}

export interface ManualArtifactFinalizerOptions {
  testInfo: TestInfo;
  context: BrowserContext;
  page?: Page;
  close(): Promise<void>;
  failed: boolean;
  name?: string;
  processes?: Readonly<Record<string, ManagedProcess | undefined>>;
  coreLogDirectory?: string;
  artifactOperationTimeoutMs?: number;
}

interface SavedArtifact {
  name: string;
  path: string;
  contentType: string;
}

interface RetainedVideo {
  video: Video;
  localPath?: string;
  videoDirectory?: string;
}

function boundedLog(value: string): string {
  const contents = Buffer.from(redactDiagnostic(value), "utf8");
  return contents
    .subarray(Math.max(0, contents.length - LOG_ATTACHMENT_LIMIT))
    .toString("utf8");
}

function safeName(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "log";
}

async function withArtifactDeadline<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const observedOperation = Promise.resolve()
    .then(operation)
    .then(
      (value) => ({ kind: "value" as const, value }),
      (error: unknown) => ({ kind: "error" as const, error }),
    );
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<{ kind: "timeout" }>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const result = await Promise.race([observedOperation, deadline]);
  if (timer) clearTimeout(timer);
  if (result.kind === "timeout") {
    throw new Error(`${label} timed out after ${timeoutMs}ms`);
  }
  if (result.kind === "error") throw result.error;
  return result.value;
}

interface OwnedManualVideoPath {
  localPath: string;
  videoDirectory: string;
}

async function ownedManualVideoPath(
  testInfo: TestInfo,
  videoPath: string,
): Promise<OwnedManualVideoPath | undefined> {
  if (!videoPath) return undefined;
  const requestedVideoDirectory = path.resolve(
    testInfo.outputPath("manual-videos"),
  );
  const candidatePath = path.resolve(videoPath);
  if (path.dirname(candidatePath) !== requestedVideoDirectory) return undefined;
  let videoDirectory: string;
  let candidate: string;
  try {
    videoDirectory = await realpath(requestedVideoDirectory);
    const info = await lstat(candidatePath);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    candidate = await realpath(candidatePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      try {
        videoDirectory = await realpath(requestedVideoDirectory);
        return { localPath: candidatePath, videoDirectory };
      } catch (directoryError) {
        if ((directoryError as NodeJS.ErrnoException).code === "ENOENT") {
          return undefined;
        }
        throw directoryError;
      }
    }
    throw error;
  }
  const relative = path.relative(videoDirectory, candidate);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return { localPath: candidate, videoDirectory };
}

async function verifiedRetainedVideoPath(
  retained: RetainedVideo,
): Promise<string | undefined> {
  if (!retained.localPath || !retained.videoDirectory) return undefined;
  try {
    const info = await lstat(retained.localPath);
    if (!info.isFile() || info.isSymbolicLink()) return undefined;
    const candidate = await realpath(retained.localPath);
    const relative = path.relative(retained.videoDirectory, candidate);
    if (
      relative.length === 0 ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      return undefined;
    }
    return candidate;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function copyRetainedVideoNoFollow(
  retained: RetainedVideo,
  outputPath: string,
): Promise<boolean> {
  const localPath = await verifiedRetainedVideoPath(retained);
  if (!localPath) return false;
  const source = await open(
    localPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const info = await source.stat();
    if (!info.isFile()) return false;
    await pipeline(
      source.createReadStream({ autoClose: false }),
      createWriteStream(outputPath),
    );
    return true;
  } finally {
    await source.close();
  }
}

function isClosedVideoChannel(error: unknown): boolean {
  return /Target page, context or browser has been closed/i.test(
    error instanceof Error ? error.message : String(error),
  );
}

async function retainVideo(
  testInfo: TestInfo,
  video: Video,
  timeoutMs: number,
  label: string,
  errors: string[],
): Promise<RetainedVideo> {
  try {
    const videoPath = await withArtifactDeadline(
      () => video.path(),
      timeoutMs,
      label,
    );
    const ownedPath = await ownedManualVideoPath(testInfo, videoPath);
    return {
      video,
      localPath: ownedPath?.localPath,
      videoDirectory: ownedPath?.videoDirectory,
    };
  } catch (error) {
    errors.push(
      `${label}: ${boundedLog(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
    return { video };
  }
}

async function finalizeRetainedVideo(
  retained: RetainedVideo,
  failed: boolean,
  timeoutMs: number,
  label: string,
  outputPath?: string,
): Promise<void> {
  if (failed) {
    if (!outputPath) throw new Error("Missing retained video output path");
    try {
      await withArtifactDeadline(
        () => retained.video.saveAs(outputPath),
        timeoutMs,
        `save ${label}`,
      );
    } catch (error) {
      if (!isClosedVideoChannel(error)) throw error;
      const copied = await withArtifactDeadline(
        () => copyRetainedVideoNoFollow(retained, outputPath),
        timeoutMs,
        `copy retained ${label}`,
      );
      if (!copied) throw error;
    }
    return;
  }

  try {
    await withArtifactDeadline(
      () => retained.video.delete(),
      timeoutMs,
      `delete ${label}`,
    );
  } catch (error) {
    if (!isClosedVideoChannel(error)) throw error;
    await withArtifactDeadline(
      async () => {
        const localPath = await verifiedRetainedVideoPath(retained);
        if (!localPath) throw error;
        await rm(localPath, { force: true });
      },
      timeoutMs,
      `remove retained ${label}`,
    );
  }
}

export function manualArtifactPaths(testInfo: TestInfo): ManualArtifactPaths {
  return {
    artifactsDir: testInfo.outputPath("manual-artifacts"),
    videoDir: testInfo.outputPath("manual-videos"),
  };
}

export async function startManualContextArtifacts(
  context: Pick<BrowserContext, "tracing">,
): Promise<void> {
  await context.tracing.start({
    screenshots: true,
    snapshots: true,
    sources: true,
  });
}

export async function attachBoundedProcessLogs(
  testInfo: TestInfo,
  processes: Readonly<Record<string, ManagedProcess | undefined>>,
): Promise<void> {
  await Promise.all(
    Object.entries(processes).map(async ([name, managedProcess]) => {
      if (!managedProcess) return;
      await testInfo.attach(`${safeName(name)}-process.log`, {
        body: boundedLog(managedProcess.logTail()),
        contentType: "text/plain; charset=utf-8",
      });
    }),
  );
}

async function listLogFiles(
  root: string,
  directory = root,
  depth = 0,
  files: string[] = [],
): Promise<string[]> {
  if (depth > LOG_DIRECTORY_DEPTH_LIMIT || files.length >= LOG_FILE_LIMIT) {
    return files;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.toSorted((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (files.length >= LOG_FILE_LIMIT) break;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      await listLogFiles(root, absolutePath, depth + 1, files);
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function readFileTail(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const info = await handle.stat();
    const length = Math.min(info.size, maxBytes);
    if (length === 0) return "";
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, info.size - length);
    return buffer.toString("utf8");
  } finally {
    await handle.close();
  }
}

export async function attachBoundedCoreLogs(
  testInfo: TestInfo,
  logDirectory: string,
): Promise<void> {
  let files: string[] = [];
  try {
    files = await listLogFiles(path.resolve(logDirectory));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  let remaining = LOG_ATTACHMENT_LIMIT;
  const sections: string[] = [];
  for (const file of files.toReversed()) {
    if (remaining <= 0) break;
    const contents = await readFileTail(file, remaining);
    const section = `${path.relative(logDirectory, file)}:\n${contents}\n`;
    const bytes = Buffer.byteLength(section);
    sections.push(section);
    remaining -= Math.min(bytes, remaining);
  }
  const body = boundedLog(
    sections.toReversed().join("\n") || "<no Core log files found>",
  );
  await testInfo.attach("core-logs.log", {
    body,
    contentType: "text/plain; charset=utf-8",
  });
}

async function attachSavedArtifacts(
  testInfo: TestInfo,
  artifacts: readonly SavedArtifact[],
  errors: string[],
): Promise<void> {
  for (const artifact of artifacts) {
    try {
      await testInfo.attach(artifact.name, {
        path: artifact.path,
        contentType: artifact.contentType,
      });
    } catch (error) {
      errors.push(
        `attach ${artifact.name}: ${boundedLog(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }
}

export async function finalizeManualContextArtifacts(
  options: ManualArtifactFinalizerOptions,
): Promise<void> {
  const prefix = safeName(options.name ?? "manual");
  const requestedArtifactOperationTimeoutMs =
    options.artifactOperationTimeoutMs ?? DEFAULT_ARTIFACT_OPERATION_TIMEOUT_MS;
  const artifactOperationTimeoutMs =
    Number.isFinite(requestedArtifactOperationTimeoutMs) &&
    requestedArtifactOperationTimeoutMs > 0
      ? Math.min(
          requestedArtifactOperationTimeoutMs,
          DEFAULT_ARTIFACT_OPERATION_TIMEOUT_MS,
        )
      : DEFAULT_ARTIFACT_OPERATION_TIMEOUT_MS;
  const errors: string[] = [];
  const artifacts: SavedArtifact[] = [];

  if (options.failed) {
    const screenshotPath = options.testInfo.outputPath("failure.png");
    const activePage = options.page ?? options.context.pages().at(-1);
    if (activePage) {
      try {
        await withArtifactDeadline(
          () => activePage.screenshot({ path: screenshotPath }),
          artifactOperationTimeoutMs,
          "failure screenshot",
        );
        artifacts.push({
          name: "failure.png",
          path: screenshotPath,
          contentType: "image/png",
        });
      } catch (error) {
        errors.push(
          `capture failure screenshot: ${boundedLog(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    }
  }

  try {
    if (options.failed) {
      const tracePath = options.testInfo.outputPath("trace.zip");
      await withArtifactDeadline(
        () => options.context.tracing.stop({ path: tracePath }),
        artifactOperationTimeoutMs,
        "trace stop",
      );
      artifacts.push({
        name: "trace.zip",
        path: tracePath,
        contentType: "application/zip",
      });
    } else {
      await withArtifactDeadline(
        () => options.context.tracing.stop(),
        artifactOperationTimeoutMs,
        "trace stop",
      );
    }
  } catch (error) {
    errors.push(
      `stop trace: ${boundedLog(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }

  const videos = await Promise.all(
    options.context
      .pages()
      .map((page) => page.video())
      .filter((video): video is Video => video !== null)
      .map((video, index) =>
        retainVideo(
          options.testInfo,
          video,
          artifactOperationTimeoutMs,
          `read video ${index + 1} path`,
          errors,
        ),
      ),
  );

  try {
    await options.close();
  } catch (error) {
    errors.push(
      `close application/context: ${boundedLog(
        error instanceof Error ? error.message : String(error),
      )}`,
    );
  }

  for (const [index, video] of videos.entries()) {
    try {
      if (options.failed) {
        const videoPath = options.testInfo.outputPath(
          `${prefix}-video-${index + 1}.webm`,
        );
        await finalizeRetainedVideo(
          video,
          true,
          artifactOperationTimeoutMs,
          `video ${index + 1}`,
          videoPath,
        );
        artifacts.push({
          name: `${prefix}-video-${index + 1}.webm`,
          path: videoPath,
          contentType: "video/webm",
        });
      } else {
        await finalizeRetainedVideo(
          video,
          false,
          artifactOperationTimeoutMs,
          `video ${index + 1}`,
        );
      }
    } catch (error) {
      errors.push(
        `finalize video ${index + 1}: ${boundedLog(
          error instanceof Error ? error.message : String(error),
        )}`,
      );
    }
  }

  if (options.failed) {
    await attachSavedArtifacts(options.testInfo, artifacts, errors);
    if (options.processes) {
      try {
        await attachBoundedProcessLogs(options.testInfo, options.processes);
      } catch (error) {
        errors.push(
          `attach process logs: ${boundedLog(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    }
    if (options.coreLogDirectory) {
      try {
        await attachBoundedCoreLogs(options.testInfo, options.coreLogDirectory);
      } catch (error) {
        errors.push(
          `attach Core logs: ${boundedLog(
            error instanceof Error ? error.message : String(error),
          )}`,
        );
      }
    }
  }

  if (errors.length === 0) return;
  const message = boundedLog(errors.join("\n"));
  try {
    await options.testInfo.attach(`${prefix}-artifact-errors.log`, {
      body: message,
      contentType: "text/plain; charset=utf-8",
    });
  } catch {
    // The primary test failure remains authoritative if reporter attachment fails.
  }
  if (!options.failed) throw new Error(message);
}
