import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const lines = (value: string) => value.split(/\r?\n/).filter(Boolean);

const VERSION_FILE = "apps/electron/app/package.json";
const SHA = /^[0-9a-f]{40}$/;
const RUNNERS = ["windows-latest", "ubuntu-latest", "macos-15"] as const;

interface RecoveryInput {
  runId: string;
  sourceSha: string;
  sourceParent: string;
  ownerRunId: string;
  ownerTarget: string;
  version: string;
  releaseFiles: string[];
  toolingChanges: string[];
  run: {
    id: number;
    path: string;
    head_sha: string;
    status: string;
    conclusion: string;
  };
  jobs: { name: string; conclusion: string }[];
  artifacts: { name: string; expired: boolean; size_in_bytes: number }[];
  published: boolean;
}

export function validateMacOSRecovery(input: RecoveryInput): string {
  if (!/^[1-9]\d*$/.test(input.runId) || !SHA.test(input.sourceSha)) {
    throw new Error("Recovery requires an exact run ID and full source SHA");
  }
  if (!/^\d+\.\d+\.\d+-beta\.\d+$/.test(input.version)) {
    throw new Error("Recovery supports an existing beta version only");
  }
  if (
    String(input.run.id) !== input.runId ||
    input.run.path !== ".github/workflows/release.yml" ||
    input.run.status !== "completed" ||
    input.run.conclusion !== "failure"
  )
    throw new Error(
      "Original official release run must have completed with failure",
    );
  if (
    input.ownerRunId !== input.runId ||
    input.ownerTarget !== "all" ||
    input.sourceParent !== input.run.head_sha ||
    input.releaseFiles.length !== 1 ||
    input.releaseFiles[0] !== VERSION_FILE
  )
    throw new Error(
      "Source is not the exact version commit owned by the original all-platform run",
    );
  if (input.published) throw new Error("This version is already published");
  if (
    input.toolingChanges.some(
      (file) =>
        !(
          file.startsWith("packages/tooling/src/electron/") ||
          file === "packages/tooling/src/github/release-recovery.ts"
        ) &&
        !file.startsWith(".github/workflows/") &&
        file !== "Taskfile.yml" &&
        file !== "mise.toml",
    )
  )
    throw new Error("Recovery tooling revision changes product source");
  const prefixStart =
    "mediago-release-" +
    input.version +
    "-" +
    input.sourceSha.slice(0, 12) +
    "-" +
    input.runId +
    "-";
  const prefixes = new Set<string>();
  for (const runner of RUNNERS) {
    if (
      !input.jobs.some(
        (job) =>
          job.name ===
            "Desktop builds / Build official desktop (" + runner + ")" &&
          job.conclusion === "success",
      )
    )
      throw new Error("Original platform did not succeed: " + runner);
    const artifacts = input.artifacts.filter(
      (artifact) =>
        artifact.name.startsWith(prefixStart) &&
        artifact.name.endsWith("-" + runner),
    );
    if (
      artifacts.length !== 1 ||
      artifacts[0].expired ||
      artifacts[0].size_in_bytes <= 0
    ) {
      throw new Error("Missing, duplicate or expired artifact: " + runner);
    }
    const prefix = artifacts[0].name.slice(0, -runner.length - 1);
    if (!/^[1-9]\d*$/.test(prefix.slice(prefixStart.length))) {
      throw new Error("Invalid original artifact attempt");
    }
    prefixes.add(prefix);
  }
  if (prefixes.size !== 1)
    throw new Error("Original artifacts have mixed provenance");
  if (
    !input.jobs.some(
      (job) =>
        job.name === "Docker build / Build and push multi-arch image" &&
        job.conclusion === "success",
    )
  )
    throw new Error("Original Docker release did not succeed");
  if (
    input.artifacts.some(
      (artifact) =>
        artifact.name.startsWith(prefixStart) &&
        artifact.name.endsWith("-macos-15-intel"),
    )
  )
    throw new Error("Intel artifact already exists; do not rebuild it");
  return [...prefixes][0];
}

function execute(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(name + " is required");
  return value;
}

function prepare(): void {
  if (
    required("GITHUB_REF") !== "refs/heads/master" ||
    required("GITHUB_REPOSITORY") !== "mediago-dev/mediago"
  ) {
    throw new Error("Recovery must run from this repository's reviewed master");
  }
  const runId = required("ORIGINAL_RUN_ID");
  const sourceSha = required("SOURCE_SHA");
  if (!/^[1-9]\d*$/.test(runId) || !SHA.test(sourceSha))
    throw new Error("Invalid recovery input");
  const toolingSha = execute("git", ["rev-parse", "HEAD"]);
  if (toolingSha !== required("GITHUB_SHA"))
    throw new Error("Tooling checkout does not match workflow SHA");
  execute("git", ["merge-base", "--is-ancestor", sourceSha, toolingSha]);
  const api = (endpoint: string) =>
    JSON.parse(execute("gh", ["api", "repos/mediago-dev/mediago/" + endpoint]));
  const run = api("actions/runs/" + runId);
  const version = JSON.parse(
    execute("git", ["show", sourceSha + ":" + VERSION_FILE]),
  ).version as string;
  const releases = JSON.parse(
    execute("gh", [
      "api",
      "repos/mediago-dev/mediago/releases?per_page=100",
      "--paginate",
      "--slurp",
    ]),
  ).flat() as { tag_name: string; draft: boolean }[];
  const prefix = validateMacOSRecovery({
    runId,
    sourceSha,
    version,
    run,
    sourceParent: execute("git", ["rev-parse", sourceSha + "^"]),
    ownerRunId: execute("git", [
      "show",
      "-s",
      "--format=%(trailers:key=MediaGo-Release-Run-Id,valueonly)",
      sourceSha,
    ]),
    ownerTarget: execute("git", [
      "show",
      "-s",
      "--format=%(trailers:key=MediaGo-Release-Target,valueonly)",
      sourceSha,
    ]),
    releaseFiles: lines(
      execute("git", [
        "diff-tree",
        "--no-commit-id",
        "--name-only",
        "-r",
        sourceSha,
      ]),
    ),
    toolingChanges: lines(
      execute("git", ["diff", "--name-only", sourceSha, toolingSha]),
    ),
    jobs: api("actions/runs/" + runId + "/jobs?per_page=100").jobs,
    artifacts: api("actions/runs/" + runId + "/artifacts?per_page=100")
      .artifacts,
    published: releases.some(
      (release) => release.tag_name === "v" + version && !release.draft,
    ),
  });
  for (const [name, value] of Object.entries({
    version,
    tag: "v" + version,
    source_sha: sourceSha,
    tooling_sha: toolingSha,
    artifact_prefix: prefix,
  }))
    appendFileSync(required("GITHUB_OUTPUT"), name + "=" + value + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      "### Resume existing beta release\nProduct source: " +
        sourceSha +
        "\n\nReviewed build tooling: " +
        toolingSha +
        "\n\nReuse Windows, Linux, ARM Mac and Docker from run " +
        runId +
        "; rebuild and validate Intel Mac only. Version stays " +
        version +
        ".\n",
    );
  }
}

function applyTooling(): void {
  const source = required("SOURCE_SHA");
  const tooling = required("TOOLING_SHA");
  if (!SHA.test(source) || !SHA.test(tooling))
    throw new Error("Invalid recovery source");
  if (execute("git", ["rev-parse", "HEAD"]) !== tooling)
    throw new Error("Unexpected tooling checkout");
  execute("git", ["merge-base", "--is-ancestor", source, tooling]);
  const changes = execute("git", ["diff", "--name-only", source, tooling])
    .split(/\r?\n/)
    .filter(Boolean);
  if (
    changes.some(
      (file) =>
        !(
          file.startsWith("packages/tooling/src/electron/") ||
          file === "packages/tooling/src/github/release-recovery.ts"
        ) &&
        !file.startsWith(".github/workflows/") &&
        file !== "Taskfile.yml" &&
        file !== "mise.toml",
    )
  ) {
    throw new Error("Recovery would change product source");
  }
  execute("git", ["checkout", "--detach", source]);
  execute("git", [
    "restore",
    "--source",
    tooling,
    "--",
    "packages/tooling/src/electron",
  ]);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  if (process.argv[2] === "prepare") prepare();
  else if (process.argv[2] === "apply-tooling") applyTooling();
  else throw new Error("Expected prepare or apply-tooling");
}
