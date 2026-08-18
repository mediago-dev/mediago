import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import manifestJson from "./deps-versions.json" with { type: "json" };
import {
  RUNTIME_TOOLS,
  dependencyExecutablePath,
  platformKeyFor,
  resolveDepsRoot,
  type PinnedDependencyManifest,
  type RuntimePlatform,
} from "./dependency-layout.ts";
import {
  inspectDependencyReadiness,
  type DependencyReadiness,
} from "./download-deps-provisioner.ts";
import {
  createPnpmLauncher,
  probePnpmPath,
  resolvePnpmEntrypoint,
  type PnpmProbeResult,
} from "./bundle-env-runtime.ts";
import { evaluateTaskVersion } from "./task-version-gate.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const manifest: PinnedDependencyManifest = manifestJson;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const MANIFEST_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/;
const READINESS_STATUSES = new Set<DependencyReadiness["status"]>([
  "ready",
  "missing",
  "stale",
  "corrupt",
  "not-executable",
  "manifest-incomplete",
]);

export interface DoctorProbeResult {
  ok: boolean;
  stdout: string;
}

export type DoctorCommandProbe = (
  command: "go" | "docker",
  args: readonly string[],
) => DoctorProbeResult;

export interface DoctorPnpmLaunch {
  args: string[];
  command: string;
  environment: NodeJS.ProcessEnv;
  shell: false;
}

export type DoctorPnpmVersionProbe = (options: {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}) => Promise<string | undefined>;

export type DoctorRuntimeInspector = (options: {
  depsRoot: string;
  platformKey: RuntimePlatform;
}) => Promise<DependencyReadiness[]>;

export interface CollectDoctorDiagnosticsOptions {
  architecture?: string;
  commandProbe?: DoctorCommandProbe;
  environment?: NodeJS.ProcessEnv;
  inspectRuntime?: DoctorRuntimeInspector;
  nodeVersion?: string;
  packageManager?: string;
  platform?: NodeJS.Platform;
  pnpmProbe?: DoctorPnpmVersionProbe;
  repositoryRoot?: string;
}

export interface DoctorResult {
  exitCode: 0 | 1;
  lines: string[];
}

export function parsePackageManagerPnpmVersion(
  packageManager: unknown,
): string | undefined {
  if (typeof packageManager !== "string") return undefined;
  return /^pnpm@(\d+\.\d+\.\d+)$/.exec(packageManager)?.[1];
}

export function parsePnpmUserAgentVersion(
  userAgent: unknown,
): string | undefined {
  if (typeof userAgent !== "string") return undefined;
  return /(?:^|\s)pnpm\/(\d+\.\d+\.\d+)(?=\s|$)/.exec(userAgent)?.[1];
}

export async function probePnpmVersion(options: {
  environment: NodeJS.ProcessEnv;
  nodeExecutable?: string;
  platform?: NodeJS.Platform;
  probePath?: (candidate: string) => Promise<PnpmProbeResult>;
  runLauncher?: (launch: DoctorPnpmLaunch) => DoctorProbeResult;
}): Promise<string | undefined> {
  const platform = options.platform ?? process.platform;
  try {
    const entrypoint = await resolvePnpmEntrypoint({
      environment: options.environment,
      platform,
      probe: options.probePath ?? probePnpmPath,
    });
    const launcher = createPnpmLauncher({
      args: ["--version"],
      entrypoint,
      nodeExecutable: options.nodeExecutable ?? process.execPath,
      platform,
    });
    const result = (options.runLauncher ?? runPnpmVersionLauncher)({
      ...launcher,
      environment: options.environment,
      shell: false,
    });
    return result.ok ? validatedPlainVersion(result.stdout) : undefined;
  } catch {
    return undefined;
  }
}

export async function collectDoctorDiagnostics(
  options: CollectDoctorDiagnosticsOptions = {},
): Promise<DoctorResult> {
  const environment = options.environment ?? process.env;
  const projectRoot = options.repositoryRoot ?? repositoryRoot;
  const packageManager =
    options.packageManager ?? readRootPackageManager(projectRoot);
  const expectedPnpmVersion = parsePackageManagerPnpmVersion(packageManager);
  const commandProbe = options.commandProbe ?? probeCommand;
  const platform = options.platform ?? process.platform;
  const architecture = options.architecture ?? process.arch;
  const lines: string[] = [];
  let failed = false;

  const taskVersion = evaluateTaskVersion(
    environment.MEDIAGO_TASK_VERSION,
    environment.MEDIAGO_REQUIRED_TASK_VERSION,
  );
  if (taskVersion.exitCode === 0) {
    lines.push("ok: Task 3.51.1 ready");
  } else {
    failed = true;
    lines.push(`error: ${taskVersion.message}`);
  }

  const nodeVersion = validatedNodeVersion(
    options.nodeVersion ?? process.version,
  );
  if (nodeVersion === undefined) {
    failed = true;
    lines.push("error: Node version unavailable");
  } else {
    lines.push(`ok: Node ${nodeVersion} ready`);
  }

  let actualPnpmVersion: string | undefined;
  try {
    actualPnpmVersion = await (options.pnpmProbe ?? probePnpmVersion)({
      environment,
      platform,
    });
  } catch {
    actualPnpmVersion = undefined;
  }
  if (expectedPnpmVersion === undefined || actualPnpmVersion === undefined) {
    failed = true;
    lines.push("error: pnpm version unavailable");
  } else if (actualPnpmVersion !== expectedPnpmVersion) {
    failed = true;
    lines.push(
      `error: pnpm ${actualPnpmVersion} does not match expected ${expectedPnpmVersion}`,
    );
  } else {
    lines.push(`ok: pnpm ${actualPnpmVersion} ready`);
  }

  const goVersion = validatedGoVersion(commandProbe("go", ["version"]));
  if (goVersion === undefined) {
    failed = true;
    lines.push("error: Go unavailable");
  } else {
    lines.push(`ok: Go ${goVersion} ready`);
  }

  const dockerVersion = validatedDockerVersion(
    commandProbe("docker", ["--version"]),
  );
  if (dockerVersion === undefined) {
    failed = true;
    lines.push("error: Docker unavailable");
  } else {
    lines.push(`ok: Docker ${dockerVersion} ready`);
  }

  let platformKey: RuntimePlatform | undefined;
  let runtimeRepairNeeded = false;
  try {
    platformKey = platformKeyFor(platform, architecture);
  } catch {
    failed = true;
    lines.push("error: current runtime platform is unsupported");
  }
  const depsRoot = resolveDepsRoot(projectRoot, environment);
  if (platformKey !== undefined) {
    let readiness: DependencyReadiness[] = [];
    try {
      readiness = await (options.inspectRuntime ?? defaultRuntimeInspector)({
        depsRoot,
        platformKey,
      });
    } catch {
      failed = true;
    }
    const readinessByTool = new Map(
      readiness.map((entry) => [entry.toolName, entry]),
    );
    for (const toolName of RUNTIME_TOOLS) {
      const entry = readinessByTool.get(toolName);
      if (
        entry === undefined ||
        !validReadinessEntry(entry, depsRoot, platformKey, toolName)
      ) {
        failed = true;
        runtimeRepairNeeded = true;
        lines.push(`error: runtime ${toolName}: corrupt`);
        continue;
      }

      const prefix = entry.status === "ready" ? "ok" : "error";
      if (entry.status !== "ready") {
        failed = true;
        runtimeRepairNeeded = true;
      }
      lines.push(
        `${prefix}: runtime ${toolName} ${entry.version}: ${entry.status} at ${JSON.stringify(entry.executablePath)}`,
      );
    }
  }

  if (runtimeRepairNeeded) {
    lines.push(
      "hint: Run task deps:runtime to repair runtime dependencies, then run task doctor again.",
    );
  }

  return { exitCode: failed ? 1 : 0, lines };
}

export async function runTaskDoctor(
  options: CollectDoctorDiagnosticsOptions = {},
  writeLine: (line: string) => void = (line) =>
    process.stdout.write(`${line}\n`),
): Promise<number> {
  const result = await collectDoctorDiagnostics(options);
  for (const line of result.lines) writeLine(line);
  return result.exitCode;
}

function readRootPackageManager(projectRoot: string): unknown {
  try {
    const packageJson = JSON.parse(
      readFileSync(path.join(projectRoot, "package.json"), "utf8"),
    ) as { packageManager?: unknown };
    return packageJson.packageManager;
  } catch {
    return undefined;
  }
}

function probeCommand(
  command: "go" | "docker",
  args: readonly string[],
): DoctorProbeResult {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function runPnpmVersionLauncher(launch: DoctorPnpmLaunch): DoctorProbeResult {
  const result = spawnSync(launch.command, launch.args, {
    encoding: "utf8",
    env: launch.environment,
    shell: launch.shell,
    windowsHide: true,
  });
  return {
    ok: result.error === undefined && result.status === 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
  };
}

function validatedNodeVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.startsWith("v") ? value.slice(1) : value;
  return VERSION_PATTERN.test(normalized) ? normalized : undefined;
}

function validatedPlainVersion(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return VERSION_PATTERN.test(normalized) ? normalized : undefined;
}

function validatedGoVersion(result: DoctorProbeResult): string | undefined {
  if (!result.ok) return undefined;
  return /^go version go([0-9A-Za-z.-]+) [a-z0-9]+\/[a-z0-9]+\s*$/.exec(
    result.stdout,
  )?.[1];
}

function validatedDockerVersion(result: DoctorProbeResult): string | undefined {
  if (!result.ok) return undefined;
  return /^Docker version (\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?),/.exec(
    result.stdout,
  )?.[1];
}

async function defaultRuntimeInspector({
  depsRoot,
  platformKey,
}: {
  depsRoot: string;
  platformKey: RuntimePlatform;
}): Promise<DependencyReadiness[]> {
  return inspectDependencyReadiness({
    depsRoot,
    manifest,
    selectedToolNames: RUNTIME_TOOLS,
    platformKey,
  });
}

function validReadinessEntry(
  entry: DependencyReadiness,
  depsRoot: string,
  platformKey: RuntimePlatform,
  toolName: (typeof RUNTIME_TOOLS)[number],
): boolean {
  return (
    entry.toolName === toolName &&
    entry.platformKey === platformKey &&
    entry.executablePath ===
      dependencyExecutablePath(depsRoot, platformKey, toolName) &&
    MANIFEST_VERSION_PATTERN.test(entry.version) &&
    READINESS_STATUSES.has(entry.status)
  );
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(entrypoint).href
  );
}

if (isMainModule()) {
  void runTaskDoctor().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    () => {
      process.stderr.write("error: Doctor failed unexpectedly\n");
      process.exitCode = 1;
    },
  );
}
