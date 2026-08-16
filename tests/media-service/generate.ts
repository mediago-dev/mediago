import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PUBLIC_DIRECTORY = fileURLToPath(new URL("./public/", import.meta.url));
const GENERATED_FILES = [
  "hls/index.m3u8",
  "hls/init.mp4",
  "hls/segment-0.m4s",
  "sample.mp4",
] as const;

export interface FixtureManifest {
  schemaVersion: 1;
  fixtureVersion: string;
  generator: {
    name: "ffmpeg";
    version: string;
  };
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

export type FixtureInstallResult = "created" | "unchanged";

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd?: string,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) {
        resolve(result);
        return;
      }

      reject(
        new Error(
          `${command} exited with ${code ?? `signal ${signal}`}: ${result.stderr.trim()}`,
        ),
      );
    });
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function listFiles(directory: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .toSorted((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => {
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return listFiles(absolutePath, relativePath);
        }
        if (entry.isFile()) return [relativePath];
        throw new Error(`Fixture contains unsupported entry: ${relativePath}`);
      }),
  );
  return files.flat();
}

async function directoriesMatch(
  generatedDirectory: string,
  targetDirectory: string,
): Promise<boolean> {
  const [generatedFiles, targetFiles] = await Promise.all([
    listFiles(generatedDirectory),
    listFiles(targetDirectory),
  ]);
  if (
    generatedFiles.length !== targetFiles.length ||
    generatedFiles.some((file, index) => file !== targetFiles[index])
  ) {
    return false;
  }

  const matches = await Promise.all(
    generatedFiles.map(async (file) => {
      const [generated, target] = await Promise.all([
        readFile(path.join(generatedDirectory, file)),
        readFile(path.join(targetDirectory, file)),
      ]);
      return generated.equals(target);
    }),
  );
  return matches.every(Boolean);
}

async function compareExistingVersion(
  generatedDirectory: string,
  targetDirectory: string,
): Promise<FixtureInstallResult> {
  const targetInfo = await lstat(targetDirectory);
  if (
    targetInfo.isDirectory() &&
    (await directoriesMatch(generatedDirectory, targetDirectory))
  ) {
    return "unchanged";
  }

  throw new Error(
    `Fixture ${path.basename(targetDirectory)} already exists with different contents; generate a new fixture version instead`,
  );
}

export async function installFixtureVersion(
  generatedDirectory: string,
  targetDirectory: string,
): Promise<FixtureInstallResult> {
  await mkdir(path.dirname(targetDirectory), { recursive: true });
  if (await pathExists(targetDirectory)) {
    return compareExistingVersion(generatedDirectory, targetDirectory);
  }

  try {
    await rename(generatedDirectory, targetDirectory);
    return "created";
  } catch (error) {
    if (!(await pathExists(targetDirectory))) throw error;
    return compareExistingVersion(generatedDirectory, targetDirectory);
  }
}

async function createManifest(
  fixtureVersion: string,
  generatorVersion: string,
  versionDirectory: string,
): Promise<FixtureManifest> {
  const files = await Promise.all(
    GENERATED_FILES.map(async (relativePath) => {
      const contents = await readFile(
        path.join(versionDirectory, relativePath),
      );
      return {
        path: relativePath,
        size: contents.length,
        sha256: createHash("sha256").update(contents).digest("hex"),
      };
    }),
  );

  return {
    schemaVersion: 1,
    fixtureVersion,
    generator: { name: "ffmpeg", version: generatorVersion },
    files,
  };
}

async function renderFixture(versionDirectory: string): Promise<string> {
  const hlsDirectory = path.join(versionDirectory, "hls");
  await mkdir(hlsDirectory, { recursive: true });

  const versionResult = await runCommand("ffmpeg", ["-version"]);
  const generatorVersion = versionResult.stdout.split(/\r?\n/, 1)[0]?.trim();
  if (!generatorVersion) throw new Error("ffmpeg did not report its version");

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=24:duration=1",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:sample_rate=48000:duration=1",
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-t",
      "1",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "28",
      "-pix_fmt",
      "yuv420p",
      "-g",
      "24",
      "-keyint_min",
      "24",
      "-sc_threshold",
      "0",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ar",
      "48000",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      "-map_metadata",
      "-1",
      "sample.mp4",
    ],
    versionDirectory,
  );

  await runCommand(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      path.join(versionDirectory, "sample.mp4"),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0",
      "-c",
      "copy",
      "-f",
      "hls",
      "-hls_time",
      "1",
      "-hls_list_size",
      "0",
      "-hls_playlist_type",
      "vod",
      "-hls_segment_type",
      "fmp4",
      "-hls_fmp4_init_filename",
      "init.mp4",
      "-hls_segment_filename",
      "segment-%d.m4s",
      "index.m3u8",
    ],
    hlsDirectory,
  );

  return generatorVersion;
}

export async function generateFixture(
  fixtureVersion: string,
): Promise<FixtureInstallResult> {
  if (!/^v\d+$/.test(fixtureVersion)) {
    throw new Error(`Invalid fixture version: ${fixtureVersion}`);
  }

  await mkdir(PUBLIC_DIRECTORY, { recursive: true });
  const temporaryRoot = await mkdtemp(
    path.join(PUBLIC_DIRECTORY, ".generate-"),
  );
  const versionDirectory = path.join(temporaryRoot, fixtureVersion);

  try {
    await mkdir(versionDirectory);
    const generatorVersion = await renderFixture(versionDirectory);
    const manifest = await createManifest(
      fixtureVersion,
      generatorVersion,
      versionDirectory,
    );
    await writeFile(
      path.join(versionDirectory, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    return await installFixtureVersion(
      versionDirectory,
      path.join(PUBLIC_DIRECTORY, fixtureVersion),
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function readVersionArgument(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--version" || !args[1]) {
    throw new Error(
      "Usage: pnpm exec tsx tests/media-service/generate.ts --version v1",
    );
  }
  return args[1];
}

async function main(): Promise<void> {
  const fixtureVersion = readVersionArgument(process.argv.slice(2));
  const result = await generateFixture(fixtureVersion);
  process.stdout.write(
    `${
      result === "created"
        ? `Created media fixture ${fixtureVersion}`
        : `Media fixture ${fixtureVersion} is unchanged`
    }\n`,
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
