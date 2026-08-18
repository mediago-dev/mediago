/**
 * Provisions pinned third-party tool binaries for one or more platforms.
 *
 * Usage:
 *   tsx scripts/download-deps.ts
 *   tsx scripts/download-deps.ts --all
 *   tsx scripts/download-deps.ts --platform linux-x64
 *   tsx scripts/download-deps.ts --tools aria2,N_m3u8DL-RE,ffmpeg
 */

import { execFileSync } from "node:child_process";
import { createReadStream, createWriteStream, mkdirSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import manifestJson from "./deps-versions.json" with { type: "json" };
import {
  SUPPORTED_RUNTIME_PLATFORMS,
  isWindowsPlatformKey,
  platformKeyFor,
  preflightToolAssets,
  resolveDepsRoot,
  type PinnedDependencyManifest,
  type RuntimePlatform,
} from "./dependency-layout.ts";
import { selectToolsFromArgs } from "./download-deps-args.ts";
import {
  provisionDependencies,
  type DependencyProvisionTarget,
} from "./download-deps-provisioner.ts";

const manifest: PinnedDependencyManifest = manifestJson;
const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function downloadFile(url: string, destination: string): Promise<void> {
  const response = await fetch(url, {
    redirect: "follow",
    headers: process.env.GITHUB_TOKEN
      ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
      : {},
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download ${url}: ${response.status} ${response.statusText}`,
    );
  }

  const fileStream = createWriteStream(destination);
  // @ts-expect-error Node.js ReadableStream compatibility
  await pipeline(response.body, fileStream);
}

async function extractGz(filePath: string, outputPath: string): Promise<void> {
  await pipeline(
    createReadStream(filePath),
    createGunzip(),
    createWriteStream(outputPath),
  );
}

function extractZip(zipPath: string, outputDirectory: string): void {
  if (process.platform === "win32") {
    const psCommand =
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
      "if (Test-Path -LiteralPath $env:MEDIAGO_DEPS_OUTPUT_DIR) { " +
      "Remove-Item -LiteralPath $env:MEDIAGO_DEPS_OUTPUT_DIR -Recurse -Force }; " +
      "[System.IO.Compression.ZipFile]::ExtractToDirectory(" +
      "$env:MEDIAGO_DEPS_ZIP_PATH, $env:MEDIAGO_DEPS_OUTPUT_DIR)";
    execFileSync(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", psCommand],
      {
        stdio: "pipe",
        env: {
          ...process.env,
          MEDIAGO_DEPS_OUTPUT_DIR: outputDirectory,
          MEDIAGO_DEPS_ZIP_PATH: zipPath,
        },
      },
    );
    return;
  }

  execFileSync("unzip", ["-o", zipPath, "-d", outputDirectory], {
    stdio: "pipe",
  });
}

function extractTarGz(tarGzPath: string, outputDirectory: string): void {
  execFileSync("tar", ["-xzf", tarGzPath, "-C", outputDirectory], {
    stdio: "pipe",
  });
}

async function findBinaryInDirectory(
  directory: string,
  name: string,
): Promise<string | null> {
  const entries = await readdir(directory, {
    withFileTypes: true,
    recursive: true,
  });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) {
      return path.join(entry.parentPath || directory, entry.name);
    }
  }
  return null;
}

function extractBinaryName(target: DependencyProvisionTarget): string {
  const configuredName = target.tool.extractBinary;
  if (configuredName === undefined) return target.executableName;
  return isWindowsPlatformKey(target.platformKey)
    ? (configuredName.win32 ?? configuredName.default)
    : configuredName.default;
}

async function prepareCandidate(
  target: DependencyProvisionTarget,
  workDir: string,
): Promise<string> {
  const assetFile = path.join(workDir, target.assetName);
  const extractedFile = path.join(workDir, target.executableName);
  const extractDirectory = path.join(workDir, "extract");
  const url = `https://github.com/${target.tool.repo}/releases/download/${target.tool.version}/${target.assetName}`;

  console.log(
    `  ↓ Downloading ${target.toolName} for ${target.platformKey}...`,
  );

  try {
    await downloadFile(url, assetFile);

    if (
      target.assetName.endsWith(".gz") &&
      !target.assetName.endsWith(".tar.gz")
    ) {
      await extractGz(assetFile, extractedFile);
      return extractedFile;
    }
    if (target.assetName.endsWith(".tar.gz")) {
      mkdirSync(extractDirectory, { recursive: true });
      extractTarGz(assetFile, extractDirectory);
      return await requireExtractedBinary(target, extractDirectory);
    }
    if (target.assetName.endsWith(".zip")) {
      mkdirSync(extractDirectory, { recursive: true });
      extractZip(assetFile, extractDirectory);
      return await requireExtractedBinary(target, extractDirectory);
    }
    return assetFile;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Failed to prepare ${target.toolName} ${target.tool.version} for ${target.platformKey}`,
        `expected executable: ${target.executablePath}`,
        `retry: pnpm deps:download:raw --tools ${target.toolName} --platform ${target.platformKey}`,
        `cause: ${reason}`,
      ].join("; "),
      { cause: error },
    );
  }
}

async function requireExtractedBinary(
  target: DependencyProvisionTarget,
  extractDirectory: string,
): Promise<string> {
  const expectedName = extractBinaryName(target);
  const candidate = await findBinaryInDirectory(extractDirectory, expectedName);
  if (candidate === null) {
    throw new Error(`Could not find ${expectedName} in extracted archive`);
  }
  return candidate;
}

function explicitPlatformFromArgs(
  argv: readonly string[],
): RuntimePlatform | undefined {
  const platformIndex = argv.indexOf("--platform");
  if (platformIndex === -1) return undefined;

  const requestedPlatform = argv[platformIndex + 1];
  if (requestedPlatform === undefined || requestedPlatform.startsWith("--")) {
    throw new Error("--platform requires a runtime platform key");
  }
  const separatorIndex = requestedPlatform.lastIndexOf("-");
  const platform = requestedPlatform.slice(0, separatorIndex);
  const architecture = requestedPlatform.slice(separatorIndex + 1);
  return platformKeyFor(platform, architecture);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const requestedToolNames = selectToolsFromArgs(argv, Object.keys(manifest));
  const explicitPlatform = explicitPlatformFromArgs(argv);
  const isAll = argv.includes("--all");
  const platformKeys: readonly RuntimePlatform[] = isAll
    ? SUPPORTED_RUNTIME_PLATFORMS
    : [explicitPlatform ?? platformKeyFor(process.platform, process.arch)];
  const depsRoot = resolveDepsRoot(repositoryRoot);

  preflightToolAssets(requestedToolNames, manifest, platformKeys, depsRoot);

  console.log(
    `Downloading third-party tools for ${isAll ? "all platforms" : platformKeys[0]}...`,
  );
  await provisionDependencies({
    depsRoot,
    manifest,
    selectedToolNames: requestedToolNames,
    platformKeys,
    prepareCandidate,
  });
  console.log("\n✅ Done!");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});
