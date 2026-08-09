import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DesktopRunMode = "test" | "release";
export type DesktopReleaseChannel = "alpha" | "beta" | "latest";

export interface DesktopBuildRequest {
  runMode: string;
  version: string;
  releaseChannel: string;
  sourceSha: string;
}

export interface VerifySourceOptions {
  runMode: DesktopRunMode;
  version: string;
  sourceSha: string;
  gitToken?: string;
  serverUrl?: string;
  workspaceRoot?: string;
  githubOutput?: string;
}

export interface ApplyVersionOptions {
  runMode: DesktopRunMode;
  version: string;
  workspaceRoot?: string;
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const DEFAULT_WORKSPACE_ROOT = resolve(dirname(SCRIPT_FILE), "..", "..");
const PRODUCT_VERSION_FILE = "apps/electron/app/package.json";
const SOURCE_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;
const CORE_PATTERN = "(0|[1-9][0-9]*)";
const SEMVER_PATTERN = new RegExp(
  `^${CORE_PATTERN}\\.${CORE_PATTERN}\\.${CORE_PATTERN}` +
    "(-[0-9A-Za-z-]+(\\.[0-9A-Za-z-]+)*)?$",
);

export function validateDesktopBuildRequest(
  request: DesktopBuildRequest,
): asserts request is DesktopBuildRequest & {
  runMode: DesktopRunMode;
  releaseChannel: DesktopReleaseChannel;
} {
  if (request.runMode !== "test" && request.runMode !== "release") {
    throw new Error(`Unsupported run_mode: ${request.runMode}`);
  }
  if (
    request.releaseChannel !== "alpha" &&
    request.releaseChannel !== "beta" &&
    request.releaseChannel !== "latest"
  ) {
    throw new Error(`Unsupported release_channel: ${request.releaseChannel}`);
  }
  if (!SOURCE_SHA_PATTERN.test(request.sourceSha)) {
    throw new Error("source_sha must be a full 40-character commit SHA");
  }
  if (!SEMVER_PATTERN.test(request.version)) {
    throw new Error("version must be a SemVer value without build metadata");
  }
  if (request.runMode === "release") {
    const channelSuffix =
      request.releaseChannel === "latest"
        ? ""
        : `-${request.releaseChannel}\\.${CORE_PATTERN}`;
    const channelPattern = new RegExp(
      `^${CORE_PATTERN}\\.${CORE_PATTERN}\\.${CORE_PATTERN}${channelSuffix}$`,
    );
    if (!channelPattern.test(request.version)) {
      throw new Error(
        `version ${request.version} does not match release channel ${request.releaseChannel}`,
      );
    }
  }
}

export function verifyDesktopSource(options: VerifySourceOptions): string {
  const workspaceRoot = resolve(
    options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT,
  );
  const actualSha = runGit(workspaceRoot, ["rev-parse", "HEAD"]);
  const expectedSha = options.sourceSha.toLowerCase();
  if (actualSha !== expectedSha) {
    throw new Error(
      `Checked out ${actualSha} instead of requested SHA ${expectedSha}`,
    );
  }

  if (options.runMode === "release") {
    runGit(
      workspaceRoot,
      ["fetch", "--no-tags", "origin", "master:refs/remotes/origin/master"],
      authenticatedGitEnvironment(
        options.gitToken ?? requiredEnvironment("GH_TOKEN"),
        options.serverUrl ?? requiredEnvironment("GITHUB_SERVER_URL"),
      ),
    );
    if (!isGitAncestor(workspaceRoot, actualSha, "origin/master")) {
      throw new Error(
        "Release builds must use a commit from the master branch history",
      );
    }

    const committedVersion = readProductVersion(workspaceRoot);
    if (committedVersion !== options.version) {
      throw new Error(
        `Committed version ${committedVersion} does not match requested version ${options.version}`,
      );
    }
  }

  appendGithubOutput(
    "source_sha",
    actualSha,
    options.githubOutput ?? process.env.GITHUB_OUTPUT,
  );
  return actualSha;
}

export function createDesktopArtifactPrefix(input: {
  runMode: DesktopRunMode;
  version: string;
  sourceSha: string;
  runId: string;
  runAttempt: string;
  githubOutput?: string;
}): string {
  const prefix =
    `mediago-${input.runMode}-${input.version}-${input.sourceSha.slice(0, 12)}` +
    `-${input.runId}-${input.runAttempt}`;
  appendGithubOutput("artifact_prefix", prefix, input.githubOutput);
  return prefix;
}

export function applyDesktopBuildVersion(options: ApplyVersionOptions): void {
  const workspaceRoot = resolve(
    options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT,
  );
  const versionFile = resolve(workspaceRoot, PRODUCT_VERSION_FILE);
  const source = readFileSync(versionFile, "utf8");
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${PRODUCT_VERSION_FILE} must contain a JSON object`);
  }

  const productPackage = parsed as Record<string, unknown>;
  const committedVersion = productPackage.version;
  if (typeof committedVersion !== "string") {
    throw new Error(`${PRODUCT_VERSION_FILE} must contain a string version`);
  }
  if (options.runMode === "release" && committedVersion !== options.version) {
    throw new Error(
      `Committed version ${committedVersion} does not match ${options.version}`,
    );
  }

  productPackage.version = options.version;
  writeFileSync(
    versionFile,
    `${JSON.stringify(productPackage, null, 2)}\n`,
    "utf8",
  );
}

function readProductVersion(workspaceRoot: string): string {
  const versionFile = resolve(workspaceRoot, PRODUCT_VERSION_FILE);
  const parsed: unknown = JSON.parse(readFileSync(versionFile, "utf8"));
  const version =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== "string") {
    throw new Error(`${PRODUCT_VERSION_FILE} must contain a string version`);
  }
  return version;
}

function authenticatedGitEnvironment(
  token: string,
  serverUrlValue: string,
): NodeJS.ProcessEnv {
  const serverUrl = new URL(serverUrlValue);
  if (serverUrl.protocol !== "https:") {
    throw new Error("GITHUB_SERVER_URL must use HTTPS");
  }
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${serverUrl.origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(
      `x-access-token:${token}`,
    ).toString("base64")}`,
  };
}

function runGit(
  workspaceRoot: string,
  args: string[],
  environment: NodeJS.ProcessEnv = process.env,
): string {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      env: environment,
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Git command failed (${args.join(" ")}): ${message}`, {
      cause: error,
    });
  }
}

function isGitAncestor(
  workspaceRoot: string,
  ancestor: string,
  descendant: string,
): boolean {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { cwd: workspaceRoot, encoding: "utf8" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  if (result.error) throw result.error;
  throw new Error(
    `Git merge-base failed with status ${String(result.status)}: ${result.stderr.trim()}`,
  );
}

function appendGithubOutput(
  name: string,
  value: string,
  githubOutput: string | undefined,
): void {
  if (!githubOutput) throw new Error("GITHUB_OUTPUT is required");
  if (/\r|\n/.test(value)) {
    throw new Error(`GitHub output ${name} must be a single line`);
  }
  appendFileSync(githubOutput, `${name}=${value}\n`, "utf8");
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function requestFromEnvironment(): DesktopBuildRequest {
  return {
    runMode: requiredEnvironment("REQUESTED_RUN_MODE"),
    version: requiredEnvironment("REQUESTED_VERSION"),
    releaseChannel: requiredEnvironment("REQUESTED_CHANNEL"),
    sourceSha: requiredEnvironment("REQUESTED_SOURCE_SHA"),
  };
}

function runCommand(command: string | undefined): void {
  if (command === "validate-request") {
    validateDesktopBuildRequest(requestFromEnvironment());
    return;
  }

  if (command === "verify-source") {
    const request = requestFromEnvironment();
    validateDesktopBuildRequest(request);
    verifyDesktopSource({
      runMode: request.runMode,
      version: request.version,
      sourceSha: request.sourceSha,
      gitToken: process.env.GH_TOKEN,
      serverUrl: process.env.GITHUB_SERVER_URL,
    });
    return;
  }

  if (command === "artifact-prefix") {
    const runMode = requiredEnvironment("REQUESTED_RUN_MODE");
    if (runMode !== "test" && runMode !== "release") {
      throw new Error(`Unsupported run_mode: ${runMode}`);
    }
    createDesktopArtifactPrefix({
      runMode,
      version: requiredEnvironment("REQUESTED_VERSION"),
      sourceSha: requiredEnvironment("VERIFIED_SOURCE_SHA"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      runAttempt: requiredEnvironment("GITHUB_RUN_ATTEMPT"),
      githubOutput: requiredEnvironment("GITHUB_OUTPUT"),
    });
    return;
  }

  if (command === "apply-version") {
    const runMode = requiredEnvironment("RUN_MODE");
    if (runMode !== "test" && runMode !== "release") {
      throw new Error(`Unsupported run_mode: ${runMode}`);
    }
    applyDesktopBuildVersion({
      runMode,
      version: requiredEnvironment("BUILD_VERSION"),
    });
    return;
  }

  throw new Error(
    "Usage: node scripts/ci/desktop-workflow.ts " +
      "<validate-request|verify-source|artifact-prefix|apply-version>",
  );
}

function main(): void {
  try {
    runCommand(process.argv[2]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[desktop-workflow] ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_FILE) {
  main();
}
