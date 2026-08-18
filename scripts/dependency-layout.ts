import path from "node:path";

export const SUPPORTED_RUNTIME_PLATFORMS = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-arm64",
  "win32-x64",
] as const;

export type RuntimePlatform = (typeof SUPPORTED_RUNTIME_PLATFORMS)[number];

export const DEPENDENCY_TOOL_NAMES = [
  "ffmpeg",
  "N_m3u8DL-RE",
  "BBDown",
  "aria2",
  "yt-dlp",
  "mediago",
] as const;

export type DependencyToolName = (typeof DEPENDENCY_TOOL_NAMES)[number];

export interface DependencyManifestEntry {
  repo: string;
  version: string;
  assets: Partial<Record<RuntimePlatform, string>>;
  sha256?: Partial<Record<RuntimePlatform, string>>;
  binaryName: { default: string; win32?: string };
  extractBinary?: { default: string; win32?: string };
}

export type DependencyManifest = Readonly<
  Record<string, DependencyManifestEntry>
>;

export type PinnedDependencyManifest = Readonly<
  Record<DependencyToolName, DependencyManifestEntry>
>;

const EXECUTABLE_NAMES: Readonly<
  Record<DependencyToolName, { unix: string; windows: string }>
> = {
  ffmpeg: { unix: "ffmpeg", windows: "ffmpeg.exe" },
  "N_m3u8DL-RE": {
    unix: "N_m3u8DL-RE",
    windows: "N_m3u8DL-RE.exe",
  },
  BBDown: { unix: "BBDown", windows: "BBDown.exe" },
  aria2: { unix: "aria2c", windows: "aria2c.exe" },
  "yt-dlp": { unix: "yt-dlp", windows: "yt-dlp.exe" },
  mediago: { unix: "mediago", windows: "mediago.exe" },
};

export function platformKeyFor(
  platform: string,
  arch: string,
): RuntimePlatform {
  const key = `${platform}-${arch}`;
  if (!(SUPPORTED_RUNTIME_PLATFORMS as readonly string[]).includes(key)) {
    throw new Error(`Unsupported runtime platform: ${key}`);
  }
  return key as RuntimePlatform;
}

export function resolveDepsRoot(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(
    environment.MEDIAGO_DEPS_ROOT ?? path.join(repositoryRoot, ".deps"),
  );
}

export function platformDepsDir(
  root: string,
  platformKey: RuntimePlatform,
): string {
  return path.join(root, platformKey);
}

export function isWindowsPlatformKey(platformKey: RuntimePlatform): boolean {
  return platformKey.startsWith("win32-");
}

export function dependencyExecutableName(
  toolName: DependencyToolName,
  platformKey: RuntimePlatform,
): string {
  const names = EXECUTABLE_NAMES[toolName];
  return isWindowsPlatformKey(platformKey) ? names.windows : names.unix;
}

export function dependencyExecutablePath(
  root: string,
  platformKey: RuntimePlatform,
  toolName: DependencyToolName,
): string {
  return path.join(
    platformDepsDir(root, platformKey),
    dependencyExecutableName(toolName, platformKey),
  );
}

export function selectedToolNames(
  manifest: DependencyManifest,
  requestedTools?: readonly string[],
): string[] {
  const manifestToolNames = Object.keys(manifest);
  if (requestedTools === undefined) return manifestToolNames;

  const availableTools = new Set(manifestToolNames);
  const unknownTools = [...new Set(requestedTools)].filter(
    (toolName) => !availableTools.has(toolName),
  );
  if (unknownTools.length > 0) {
    const unknownDescription =
      unknownTools.length === 1
        ? `Unknown dependency tool "${unknownTools[0]}"`
        : `Unknown dependency tools: ${unknownTools
            .map((toolName) => `"${toolName}"`)
            .join(", ")}`;
    throw new Error(
      `${unknownDescription}. Available tools: ${manifestToolNames.join(", ")}`,
    );
  }

  const requestedToolSet = new Set(requestedTools);
  return manifestToolNames.filter((toolName) => requestedToolSet.has(toolName));
}

export function preflightToolAssets(
  toolNames: readonly string[],
  manifest: DependencyManifest,
  platformKeys: readonly RuntimePlatform[],
  depsRoot: string,
): void {
  const failures: string[] = [];
  for (const toolName of selectedToolNames(manifest, toolNames)) {
    const tool = manifest[toolName];
    for (const platformKey of platformKeys) {
      if (tool.assets[platformKey]) continue;

      const executableName = isWindowsPlatformKey(platformKey)
        ? (tool.binaryName.win32 ?? tool.binaryName.default)
        : tool.binaryName.default;
      failures.push(
        [
          `${toolName} ${tool.version} has no pinned asset for ${platformKey}`,
          `expected executable: ${path.join(platformDepsDir(depsRoot, platformKey), executableName)}`,
          `retry: pnpm deps:download:raw --tools ${toolName} --platform ${platformKey}`,
        ].join("; "),
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}
