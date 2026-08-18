import { type ChildProcess, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { SENTINEL_VALUE } from "./bundle-env-values.ts";
import { isErrno } from "./bundle-env-transaction-files.ts";

export {
  createWindowsTreeKillCommand,
  terminateProcessTree,
} from "./bundle-env-process-tree.ts";

export type PnpmProbeResult = { isFile: boolean; realPath: string } | undefined;

type PlatformPath = typeof path.posix;

function platformPath(platform: NodeJS.Platform): PlatformPath {
  return platform === "win32" ? path.win32 : path.posix;
}

function isJavaScriptEntrypoint(
  filename: string,
  pathApi: PlatformPath,
): boolean {
  return pathApi.isAbsolute(filename) && /\.(?:c)?js$/i.test(filename);
}

async function resolveJavaScriptEntrypoint(
  candidate: string,
  pathApi: PlatformPath,
  probe: (candidate: string) => Promise<PnpmProbeResult>,
): Promise<string | undefined> {
  const shim = await probe(candidate);
  if (!shim?.isFile || !pathApi.isAbsolute(shim.realPath)) return undefined;
  if (isJavaScriptEntrypoint(shim.realPath, pathApi)) return shim.realPath;

  const directories = [
    pathApi.dirname(shim.realPath),
    pathApi.dirname(candidate),
  ];
  const adjacentCandidates = directories.flatMap((directory) => [
    pathApi.join(directory, "node_modules", "pnpm", "bin", "pnpm.cjs"),
    pathApi.join(
      directory,
      "..",
      "lib",
      "node_modules",
      "pnpm",
      "bin",
      "pnpm.cjs",
    ),
  ]);
  for (const adjacentCandidate of new Set(adjacentCandidates)) {
    // oxlint-disable-next-line no-await-in-loop -- Resolution stops at the first trusted regular entrypoint.
    const adjacent = await probe(adjacentCandidate);
    if (
      adjacent?.isFile &&
      isJavaScriptEntrypoint(adjacent.realPath, pathApi)
    ) {
      return adjacent.realPath;
    }
  }
  return undefined;
}

export async function resolvePnpmEntrypoint(options: {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  probe: (candidate: string) => Promise<PnpmProbeResult>;
}): Promise<string> {
  const pathApi = platformPath(options.platform);
  const npmExecPath = options.environment.npm_execpath;
  if (npmExecPath) {
    if (!pathApi.isAbsolute(npmExecPath)) {
      throw new Error(`npm_execpath must be absolute: ${npmExecPath}`);
    }
    const entrypoint = await resolveJavaScriptEntrypoint(
      npmExecPath,
      pathApi,
      options.probe,
    );
    if (!entrypoint) {
      throw new Error(
        `npm_execpath must resolve to a regular .js or .cjs pnpm entrypoint: ${npmExecPath}`,
      );
    }
    return entrypoint;
  }

  const directories = [
    options.environment.PNPM_HOME,
    ...(options.environment.PATH ?? "").split(pathApi.delimiter),
  ].filter(
    (directory): directory is string =>
      Boolean(directory) && pathApi.isAbsolute(directory as string),
  );
  const shimNames =
    options.platform === "win32" ? ["pnpm.cmd", "pnpm"] : ["pnpm"];
  for (const directory of new Set(directories)) {
    for (const shimName of shimNames) {
      // oxlint-disable-next-line no-await-in-loop -- Resolution order preserves PATH precedence.
      const entrypoint = await resolveJavaScriptEntrypoint(
        pathApi.join(directory, shimName),
        pathApi,
        options.probe,
      );
      if (entrypoint) return entrypoint;
    }
  }

  throw new Error(
    "Unable to resolve a regular pnpm .js/.cjs entrypoint from npm_execpath, PNPM_HOME, or PATH",
  );
}

export function createPnpmLauncher(options: {
  args: string[];
  entrypoint: string;
  nodeExecutable: string;
  platform: NodeJS.Platform;
}): { args: string[]; command: string } {
  const pathApi = platformPath(options.platform);
  if (!pathApi.isAbsolute(options.nodeExecutable)) {
    throw new Error(
      `Node executable must be absolute: ${options.nodeExecutable}`,
    );
  }
  if (!isJavaScriptEntrypoint(options.entrypoint, pathApi)) {
    throw new Error(
      `pnpm entrypoint must be an absolute .js or .cjs file: ${options.entrypoint}`,
    );
  }
  return {
    args: [options.entrypoint, ...options.args],
    command: options.nodeExecutable,
  };
}

export async function probePnpmPath(
  candidate: string,
): Promise<PnpmProbeResult> {
  try {
    const realPath = await fs.realpath(candidate);
    const stat = await fs.lstat(realPath);
    return { isFile: stat.isFile(), realPath };
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

export function runPnpm(options: {
  args: string[];
  cwd: string;
  entrypoint: string;
  environment: NodeJS.ProcessEnv;
  setActiveChild: (child: ChildProcess | undefined) => void;
}): Promise<void> {
  const launcher = createPnpmLauncher({
    args: options.args,
    entrypoint: options.entrypoint,
    nodeExecutable: process.execPath,
    platform: process.platform,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(launcher.command, launcher.args, {
      cwd: options.cwd,
      detached: process.platform !== "win32",
      env: options.environment,
      shell: false,
      stdio: "inherit",
    });
    options.setActiveChild(child);
    child.once("error", (error) => {
      options.setActiveChild(undefined);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      options.setActiveChild(undefined);
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${launcher.command} ${launcher.args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }`,
        ),
      );
    });
  });
}

async function fileContainsSentinel(filename: string): Promise<boolean> {
  const needle = Buffer.from(SENTINEL_VALUE);
  let tail = Buffer.alloc(0);
  for await (const value of createReadStream(filename, {
    highWaterMark: 64 * 1024,
  })) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    const searchable = tail.length === 0 ? chunk : Buffer.concat([tail, chunk]);
    if (searchable.includes(needle)) return true;
    tail = searchable.subarray(
      Math.max(0, searchable.length - needle.length + 1),
    );
  }
  return false;
}

export async function filesContainingSentinel(
  directory: string,
): Promise<string[]> {
  const directoryStat = await fs.lstat(directory);
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`Bundle directory is a symbolic link: ${directory}`);
  }
  if (!directoryStat.isDirectory()) {
    throw new Error(`Bundle scan root must be a directory: ${directory}`);
  }

  const matches: string[] = [];
  const entries = (await fs.readdir(directory)).toSorted();
  for (const entry of entries) {
    const filename = path.join(directory, entry);
    // oxlint-disable-next-line no-await-in-loop -- Sequential traversal bounds open files and validates each entry before use.
    const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) {
      throw new Error(`Bundle entry is a symbolic link: ${filename}`);
    }
    if (stat.isDirectory()) {
      // oxlint-disable-next-line no-await-in-loop -- Recursive scans remain sequential to bound file descriptors.
      matches.push(...(await filesContainingSentinel(filename)));
    } else if (stat.isFile()) {
      // oxlint-disable-next-line no-await-in-loop -- Only one bundle stream is open at a time.
      if (await fileContainsSentinel(filename)) matches.push(filename);
    }
  }
  return matches;
}
