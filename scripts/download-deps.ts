/**
 * download-deps.ts
 *
 * Provisions third-party tool binaries for the current (or all) platform(s).
 *
 * Tools are fetched from pinned GitHub Releases. A per-platform version
 * manifest keeps local caches in sync with the configured release assets.
 *
 * Tools: ffmpeg, N_m3u8DL-RE, BBDown, aria2, yt-dlp, mediago.
 *
 * Usage:
 *   tsx scripts/download-deps.ts           # Download for current platform only
 *   tsx scripts/download-deps.ts --all     # Download for all platforms
 *   tsx scripts/download-deps.ts --tools aria2,N_m3u8DL-RE,ffmpeg
 */

import {
  createWriteStream,
  createReadStream,
  chmodSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import {
  mkdtemp,
  readFile,
  rename,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { execFileSync } from "node:child_process";
import { selectToolsFromArgs } from "./download-deps-args.ts";
import {
  assertDependencyFileIntegrity,
  dependencyFileMatchesIntegrity,
  resolveDependencySha256,
} from "./download-deps-integrity.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load tool definitions
const depsVersions = JSON.parse(
  readFileSync(path.join(__dirname, "deps-versions.json"), "utf-8"),
);

// ============================================================
// Types
// ============================================================

interface ToolDef {
  /** GitHub repo in `owner/name` form. */
  repo?: string;
  /** Pinned Release tag (e.g. `v1.6.5`). */
  version?: string;
  /** Per-platform asset filename on the GitHub Release. */
  assets?: Record<string, string>;
  /** Per-platform SHA-256 of the final executable. */
  sha256?: Record<string, string>;
  binaryName: { default: string; win32?: string };
  extractBinary?: { default: string; win32?: string };
}

interface ToolVersionRecord {
  repo: string;
  version: string;
  asset: string;
  binaryName: string;
}

interface VersionManifest {
  schemaVersion: 1;
  tools: Record<string, ToolVersionRecord>;
}

// ============================================================
// Platform helpers
// ============================================================

const PLATFORM_MAP: Record<string, string> = {
  darwin: "darwin",
  linux: "linux",
  win32: "win32",
};

const ARCH_MAP: Record<string, string> = {
  x64: "x64",
  arm64: "arm64",
};

function getCurrentPlatformKey(): string {
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!platform || !arch) {
    throw new Error(
      `Unsupported platform: ${process.platform}-${process.arch}`,
    );
  }
  return `${platform}-${arch}`;
}

function getAllPlatformKeys(): string[] {
  const keys: string[] = [];
  for (const p of Object.values(PLATFORM_MAP)) {
    for (const a of Object.values(ARCH_MAP)) {
      keys.push(`${p}-${a}`);
    }
  }
  return keys;
}

function getBinaryName(tool: ToolDef, platformKey: string): string {
  const isWin = platformKey.startsWith("win32");
  return isWin && tool.binaryName.win32
    ? tool.binaryName.win32
    : tool.binaryName.default;
}

function getExtractBinaryName(
  tool: ToolDef,
  platformKey: string,
): string | undefined {
  if (!tool.extractBinary) return undefined;
  const isWin = platformKey.startsWith("win32");
  return isWin && tool.extractBinary.win32
    ? tool.extractBinary.win32
    : tool.extractBinary.default;
}

// ============================================================
// Download and extraction
// ============================================================

const DEPS_DIR = path.resolve(__dirname, "..", ".deps");
const VERSION_STATE_DIR = path.join(DEPS_DIR, ".state");

function createVersionManifest(): VersionManifest {
  return { schemaVersion: 1, tools: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getVersionManifestPath(platformKey: string): string {
  return path.join(VERSION_STATE_DIR, platformKey + ".json");
}

async function loadVersionManifest(
  platformKey: string,
): Promise<VersionManifest> {
  const manifestPath = getVersionManifestPath(platformKey);
  try {
    const parsed: unknown = JSON.parse(await readFile(manifestPath, "utf-8"));
    if (
      isRecord(parsed) &&
      parsed.schemaVersion === 1 &&
      isRecord(parsed.tools)
    ) {
      return {
        schemaVersion: 1,
        tools: parsed.tools as Record<string, ToolVersionRecord>,
      };
    }
    console.warn("  ⚠ Ignoring invalid version state for " + platformKey);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn("  ⚠ Could not read version state for " + platformKey);
    }
  }
  return createVersionManifest();
}

async function saveVersionManifest(
  platformKey: string,
  manifest: VersionManifest,
): Promise<void> {
  mkdirSync(VERSION_STATE_DIR, { recursive: true });
  const workDir = await mkdtemp(
    path.join(VERSION_STATE_DIR, "." + platformKey + "-"),
  );
  const tempFile = path.join(workDir, "manifest.json");
  try {
    await writeFile(
      tempFile,
      JSON.stringify(manifest, null, 2) + "\n",
      "utf-8",
    );
    await rename(tempFile, getVersionManifestPath(platformKey));
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function matchesVersion(
  actual: ToolVersionRecord | undefined,
  expected: ToolVersionRecord,
): boolean {
  return (
    actual?.repo === expected.repo &&
    actual.version === expected.version &&
    actual.asset === expected.asset &&
    actual.binaryName === expected.binaryName
  );
}

async function downloadFile(url: string, dest: string): Promise<void> {
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

  const fileStream = createWriteStream(dest);
  // @ts-expect-error Node.js ReadableStream compatibility
  await pipeline(response.body, fileStream);
}

async function extractGz(filePath: string, outputPath: string): Promise<void> {
  const gunzip = createGunzip();
  const source = createReadStream(filePath);
  const dest = createWriteStream(outputPath);
  await pipeline(source, gunzip, dest);
}

async function extractZip(zipPath: string, outputDir: string): Promise<void> {
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
          MEDIAGO_DEPS_OUTPUT_DIR: outputDir,
          MEDIAGO_DEPS_ZIP_PATH: zipPath,
        },
      },
    );
  } else {
    execFileSync("unzip", ["-o", zipPath, "-d", outputDir], {
      stdio: "pipe",
    });
  }
}

async function extractTarGz(
  tarGzPath: string,
  outputDir: string,
): Promise<void> {
  execFileSync("tar", ["-xzf", tarGzPath, "-C", outputDir], {
    stdio: "pipe",
  });
}

async function downloadTool(
  toolName: string,
  tool: ToolDef,
  platformKey: string,
  versionManifest: VersionManifest,
): Promise<void> {
  if (!tool.assets) {
    console.log(`  ⚠ ${toolName} has no assets defined; skipping`);
    return;
  }
  const assetName = tool.assets[platformKey];
  if (!assetName) {
    console.log(`  ⚠ No asset for ${toolName} on ${platformKey}, skipping`);
    return;
  }
  const repo = tool.repo;
  const version = tool.version;
  if (!repo || !version) {
    console.log(`  ⚠ ${toolName} missing repo/version; skipping`);
    return;
  }

  const destDir = path.join(DEPS_DIR, platformKey);
  mkdirSync(destDir, { recursive: true });

  const binaryName = getBinaryName(tool, platformKey);
  const binaryPath = path.join(destDir, binaryName);
  const expectedSha256 = resolveDependencySha256(
    toolName,
    platformKey,
    tool.sha256,
  );
  const expectedVersion: ToolVersionRecord = {
    repo,
    version,
    asset: assetName,
    binaryName,
  };
  const binaryIsUsable = await dependencyFileMatchesIntegrity(
    binaryPath,
    expectedSha256,
  );

  if (
    binaryIsUsable &&
    matchesVersion(versionManifest.tools[toolName], expectedVersion)
  ) {
    const integrityStatus = expectedSha256 ? " (SHA-256 verified)" : "";
    console.log(
      "  ✓ " +
        toolName +
        " already exists for " +
        platformKey +
        integrityStatus,
    );
    return;
  }
  if (await dependencyFileMatchesIntegrity(binaryPath)) {
    console.log("  ↻ Refreshing stale " + toolName + " for " + platformKey);
  }
  const url = `https://github.com/${repo}/releases/download/${version}/${assetName}`;
  const workDir = await mkdtemp(path.join(destDir, ".download-"));
  const tempFile = path.join(workDir, assetName);
  const extractedFile = path.join(workDir, binaryName);
  const extractDir = path.join(workDir, "extract");

  console.log(`  ↓ Downloading ${toolName} for ${platformKey}...`);

  try {
    await downloadFile(url, tempFile);

    const extractBinaryName = getExtractBinaryName(tool, platformKey);
    let candidateFile: string;

    if (assetName.endsWith(".gz") && !assetName.endsWith(".tar.gz")) {
      await extractGz(tempFile, extractedFile);
      candidateFile = extractedFile;
    } else if (assetName.endsWith(".tar.gz")) {
      mkdirSync(extractDir, { recursive: true });
      await extractTarGz(tempFile, extractDir);

      const found = await findBinaryInDir(
        extractDir,
        extractBinaryName || binaryName,
      );
      if (!found) {
        throw new Error(
          `Could not find ${extractBinaryName || binaryName} in extracted archive`,
        );
      }
      candidateFile = found;
    } else if (assetName.endsWith(".zip")) {
      mkdirSync(extractDir, { recursive: true });
      await extractZip(tempFile, extractDir);

      const found = await findBinaryInDir(
        extractDir,
        extractBinaryName || binaryName,
      );
      if (!found) {
        throw new Error(
          `Could not find ${extractBinaryName || binaryName} in extracted archive`,
        );
      }
      candidateFile = found;
    } else {
      candidateFile = tempFile;
    }

    await assertDependencyFileIntegrity(
      candidateFile,
      expectedSha256,
      `Downloaded ${toolName} binary`,
    );

    // Node's rename replaces an existing file. Keeping the old binary in place
    // until this point means a failed download or extraction never removes it.
    await rename(candidateFile, binaryPath);

    if (!platformKey.startsWith("win32")) {
      try {
        chmodSync(binaryPath, 0o755);
      } catch {
        // Ignore permission errors on Windows host
      }
    }

    const updatedVersionManifest: VersionManifest = {
      schemaVersion: 1,
      tools: {
        ...versionManifest.tools,
        [toolName]: expectedVersion,
      },
    };
    await saveVersionManifest(platformKey, updatedVersionManifest);
    versionManifest.tools = updatedVersionManifest.tools;
    console.log(`  ✓ ${toolName} ready for ${platformKey}`);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

async function findBinaryInDir(
  dir: string,
  name: string,
): Promise<string | null> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    if (entry.isFile() && entry.name === name) {
      return path.join(entry.parentPath || dir, entry.name);
    }
  }
  return null;
}

// ============================================================
// Main
// ============================================================

async function main() {
  const tools = depsVersions as Record<string, ToolDef>;
  const selectedToolNames = selectToolsFromArgs(
    process.argv.slice(2),
    Object.keys(tools),
  );
  const selectedTools = selectedToolNames.map(
    (toolName) => [toolName, tools[toolName]] as const,
  );

  const isAll = process.argv.includes("--all");
  const platformIdx = process.argv.indexOf("--platform");
  const explicitPlatform =
    platformIdx !== -1 ? process.argv[platformIdx + 1] : undefined;

  let platforms: string[];
  if (isAll) {
    platforms = getAllPlatformKeys();
  } else if (explicitPlatform) {
    platforms = [explicitPlatform];
  } else {
    platforms = [getCurrentPlatformKey()];
  }

  console.log(
    `Downloading third-party tools for ${isAll ? "all platforms" : platforms[0]}...`,
  );

  let failureCount = 0;

  for (const platformKey of platforms) {
    console.log(`\n📦 Platform: ${platformKey}`);
    const versionManifest = await loadVersionManifest(platformKey);
    for (const [toolName, tool] of selectedTools) {
      try {
        await downloadTool(toolName, tool, platformKey, versionManifest);
      } catch (err) {
        failureCount += 1;
        console.error(
          `  ✗ Failed to download ${toolName} for ${platformKey}: ${err}`,
        );
      }
    }
  }

  if (failureCount > 0) {
    throw new Error(`${failureCount} dependency operation(s) failed`);
  }

  console.log("\n✅ Done!");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
