import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  DEPENDENCY_TOOL_NAMES,
  dependencyExecutableName,
  isWindowsPlatformKey,
  platformDepsDir,
  selectedToolNames,
  type DependencyManifest,
  type DependencyManifestEntry,
  type DependencyToolName,
  type RuntimePlatform,
} from "./dependency-layout.ts";
import {
  assertDependencyFileIntegrity,
  dependencyFileMatchesIntegrity,
  resolveDependencySha256,
} from "./download-deps-integrity.ts";

export interface DependencyProvisionTarget {
  toolName: string;
  tool: DependencyManifestEntry;
  platformKey: RuntimePlatform;
  assetName: string;
  destinationDirectory: string;
  executableName: string;
  executablePath: string;
  expectedSha256: string | undefined;
}

interface ToolVersionRecord {
  repo: string;
  version: string;
  asset: string;
  binaryName: string;
  sha256?: string;
}

interface VersionManifest {
  schemaVersion: 1;
  tools: Record<string, ToolVersionRecord>;
}

export interface ProvisionDependenciesOptions {
  depsRoot: string;
  manifest: DependencyManifest;
  selectedToolNames: readonly string[];
  platformKeys: readonly RuntimePlatform[];
  prepareCandidate: (
    target: DependencyProvisionTarget,
    workDir: string,
  ) => Promise<string>;
}

export async function provisionDependencies({
  depsRoot,
  manifest,
  selectedToolNames: requestedToolNames,
  platformKeys,
  prepareCandidate,
}: ProvisionDependenciesOptions): Promise<void> {
  const toolNames = selectedToolNames(manifest, requestedToolNames);

  for (const platformKey of platformKeys) {
    const versionManifest = await loadVersionManifest(depsRoot, platformKey);

    for (const toolName of toolNames) {
      const tool = manifest[toolName];
      const assetName = tool.assets[platformKey];
      if (assetName === undefined) {
        throw new Error(
          `${toolName} ${tool.version} has no preflighted asset for ${platformKey}`,
        );
      }

      const destinationDirectory = platformDepsDir(depsRoot, platformKey);
      await mkdir(destinationDirectory, { recursive: true });
      const executableName = executableNameFor(toolName, tool, platformKey);
      const target: DependencyProvisionTarget = {
        toolName,
        tool,
        platformKey,
        assetName,
        destinationDirectory,
        executableName,
        executablePath: path.join(destinationDirectory, executableName),
        expectedSha256: resolveDependencySha256(
          toolName,
          platformKey,
          tool.sha256,
        ),
      };
      const requireExecutable = !isWindowsPlatformKey(platformKey);
      const expectedVersion = versionRecordFor(target);
      const binaryIsUsable = await dependencyFileMatchesIntegrity(
        target.executablePath,
        target.expectedSha256,
        { requireExecutable },
      );

      if (
        binaryIsUsable &&
        matchesVersionRecord(versionManifest.tools[toolName], expectedVersion)
      ) {
        continue;
      }

      const workDir = await mkdtemp(
        path.join(destinationDirectory, ".download-"),
      );
      try {
        const candidateFile = await prepareCandidate(target, workDir);
        if (requireExecutable) await chmod(candidateFile, 0o755);
        await assertDependencyFileIntegrity(
          candidateFile,
          target.expectedSha256,
          [
            `${toolName} ${tool.version} downloaded candidate for ${platformKey}`,
            `expected executable: ${target.executablePath}`,
            `retry: pnpm deps:download:raw --tools ${toolName} --platform ${platformKey}`,
          ].join("; "),
          { requireExecutable },
        );
        await rename(candidateFile, target.executablePath);

        const updatedVersionManifest: VersionManifest = {
          schemaVersion: 1,
          tools: {
            ...versionManifest.tools,
            [toolName]: expectedVersion,
          },
        };
        await saveVersionManifest(
          depsRoot,
          platformKey,
          updatedVersionManifest,
        );
        versionManifest.tools = updatedVersionManifest.tools;
      } finally {
        await rm(workDir, { recursive: true, force: true });
      }
    }
  }
}

function executableNameFor(
  toolName: string,
  tool: DependencyManifestEntry,
  platformKey: RuntimePlatform,
): string {
  if ((DEPENDENCY_TOOL_NAMES as readonly string[]).includes(toolName)) {
    return dependencyExecutableName(
      toolName as DependencyToolName,
      platformKey,
    );
  }
  return isWindowsPlatformKey(platformKey)
    ? (tool.binaryName.win32 ?? tool.binaryName.default)
    : tool.binaryName.default;
}

function versionRecordFor(
  target: DependencyProvisionTarget,
): ToolVersionRecord {
  return {
    repo: target.tool.repo,
    version: target.tool.version,
    asset: target.assetName,
    binaryName: target.executableName,
    ...(target.expectedSha256 === undefined
      ? {}
      : { sha256: target.expectedSha256 }),
  };
}

function matchesVersionRecord(
  actual: ToolVersionRecord | undefined,
  expected: ToolVersionRecord,
): boolean {
  return (
    actual?.repo === expected.repo &&
    actual.version === expected.version &&
    actual.asset === expected.asset &&
    actual.binaryName === expected.binaryName &&
    actual.sha256 === expected.sha256
  );
}

function createVersionManifest(): VersionManifest {
  return { schemaVersion: 1, tools: {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function versionManifestPath(
  depsRoot: string,
  platformKey: RuntimePlatform,
): string {
  return path.join(depsRoot, ".state", `${platformKey}.json`);
}

async function loadVersionManifest(
  depsRoot: string,
  platformKey: RuntimePlatform,
): Promise<VersionManifest> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(versionManifestPath(depsRoot, platformKey), "utf8"),
    );
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
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // Invalid or unreadable state is treated as an empty cache manifest.
    }
  }
  return createVersionManifest();
}

async function saveVersionManifest(
  depsRoot: string,
  platformKey: RuntimePlatform,
  manifest: VersionManifest,
): Promise<void> {
  const stateDirectory = path.join(depsRoot, ".state");
  await mkdir(stateDirectory, { recursive: true });
  const workDir = await mkdtemp(path.join(stateDirectory, `.${platformKey}-`));
  const temporaryManifestPath = path.join(workDir, "manifest.json");
  try {
    await writeFile(
      temporaryManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8",
    );
    await rename(
      temporaryManifestPath,
      versionManifestPath(depsRoot, platformKey),
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
