import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ExecuteReleaseVersionOptions,
  ReleaseVersionResult,
} from "./contracts.ts";
import {
  planRelease,
  planResumedRelease,
  planTestRelease,
} from "./planning.ts";
import { parseSemVer } from "./semver.ts";

const PRODUCT_VERSION_FILE = "apps/electron/app/package.json";
const DEFAULT_WORKSPACE_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

class ReleaseVersionError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

export function readGitTags(workspaceRoot: string): string[] {
  if (
    runGit(workspaceRoot, ["rev-parse", "--is-shallow-repository"]) === "true"
  ) {
    throw new Error(
      "Cannot calculate a release version from a shallow clone; checkout with fetch-depth: 0",
    );
  }
  const output = runGit(workspaceRoot, ["tag", "--list"]);
  return output === "" ? [] : output.split(/\r?\n/).filter(Boolean);
}

function runGit(workspaceRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: workspaceRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReleaseVersionError(
      `Git command failed (${args.join(" ")}): ${message}`,
      error,
    );
  }
}

function readProductVersion(source: string, versionFile: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ReleaseVersionError(
      `Invalid JSON in ${versionFile}: ${message}`,
      error,
    );
  }
  const version =
    typeof parsed === "object" && parsed !== null
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (typeof version !== "string") {
    throw new Error(`${versionFile} must contain a string version`);
  }
  parseSemVer(version);
  return version;
}

function replaceProductVersion(
  source: string,
  currentVersion: string,
  nextVersion: string,
  versionFile: string,
): string {
  const propertyMatches = [...source.matchAll(/^\s*"version"\s*:/gm)];
  if (propertyMatches.length !== 1) {
    throw new Error(`${versionFile} must contain exactly one version property`);
  }

  let replaced = false;
  const result = source.replace(
    /^(\s*"version"\s*:\s*")([^"]+)(".*)$/m,
    (_match, prefix: string, value: string, suffix: string) => {
      if (value !== currentVersion) {
        throw new Error(
          `Version property changed while updating ${versionFile}`,
        );
      }
      replaced = true;
      return `${prefix}${nextVersion}${suffix}`;
    },
  );
  if (!replaced) {
    throw new Error(`Unable to update version property in ${versionFile}`);
  }
  return result;
}

export function executeReleaseVersion(
  options: ExecuteReleaseVersionOptions,
): ReleaseVersionResult {
  if (options.resumeCurrent && options.mode !== "release") {
    throw new Error("resume-current is only valid in release mode");
  }

  const workspaceRoot = resolve(
    options.workspaceRoot ?? DEFAULT_WORKSPACE_ROOT,
  );
  const versionFile = resolve(workspaceRoot, PRODUCT_VERSION_FILE);
  const source = readFileSync(versionFile, "utf8");
  const currentVersion = readProductVersion(source, versionFile);
  const plan = options.resumeCurrent
    ? planResumedRelease(currentVersion, options.channel)
    : options.mode === "test"
      ? planTestRelease(
          currentVersion,
          options.runNumber ?? process.env.GITHUB_RUN_NUMBER,
        )
      : planRelease({
          currentVersion,
          tags: options.tags ? [...options.tags] : readGitTags(workspaceRoot),
          channel: options.channel,
          increment: options.increment,
        });

  let written = false;
  if (options.mode === "release" && plan.changed) {
    writeFileSync(
      versionFile,
      replaceProductVersion(
        source,
        plan.currentVersion,
        plan.version,
        versionFile,
      ),
      "utf8",
    );
    written = true;
  }

  const outputs: Record<string, string> = {
    version: plan.version,
    tag: plan.tag,
    current_version: plan.currentVersion,
    base_version: plan.baseVersion ?? "",
    channel: options.channel,
    increment: options.increment,
    mode: options.mode,
    release_type:
      options.mode === "test"
        ? "draft"
        : options.channel === "latest"
          ? "release"
          : "prerelease",
    prerelease: String(options.mode === "test" || options.channel !== "latest"),
    changed: String(plan.changed),
    written: String(written),
    pending: String(plan.pending),
    resumed: String(options.resumeCurrent === true),
    version_file: PRODUCT_VERSION_FILE,
  };

  const githubOutput =
    options.githubOutput ?? (process.env.GITHUB_OUTPUT || undefined);
  if (githubOutput) {
    appendFileSync(githubOutput, `${formatOutputs(outputs)}\n`, "utf8");
  }
  return {
    ...plan,
    mode: options.mode,
    channel: options.channel,
    increment: options.increment,
    written,
    outputs,
  };
}

export function formatOutputs(outputs: Record<string, string>): string {
  return Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}
