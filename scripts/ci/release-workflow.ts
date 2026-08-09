import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync, readdirSync, statSync } from "node:fs";
import path, { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  executeReleaseVersion,
  type ReleaseChannel,
  type ReleaseMode,
} from "../release-version.ts";

const PRODUCT_VERSION_FILE = "apps/electron/app/package.json";
const SCRIPT_FILE = fileURLToPath(import.meta.url);

export type BuildTarget = "all" | "desktop" | "docker";

export type GitHubReleaseRecord = {
  tag_name: string;
  draft: boolean;
  target_commitish: string;
};

export type DesktopReleasePlan = {
  tag: string;
  title: string;
  createArguments: string[];
};

type CommandOptions = {
  inherit?: boolean;
  env?: NodeJS.ProcessEnv;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnvironment(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

function parseChoice<const T extends readonly string[]>(
  name: string,
  value: string,
  choices: T,
): T[number] {
  if (!choices.includes(value)) {
    throw new Error(
      `${name} must be one of ${choices.join(", ")}; received '${value}'`,
    );
  }
  return value as T[number];
}

function parseAttempt(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(
      `RUN_ATTEMPT must be a positive integer; received '${value}'`,
    );
  }
  return Number(value);
}

function parseBoolean(name: string, value: string): boolean {
  if (value === "true") return true;
  if (value === "false" || value === "") return false;
  throw new Error(`${name} must be true or false; received '${value}'`);
}

function run(
  command: string,
  args: readonly string[],
  options: CommandOptions = {},
): string {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    env: options.env ?? process.env,
    maxBuffer: 16 * 1024 * 1024,
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const details = options.inherit
      ? ""
      : (result.stderr || result.stdout || "").trim();
    throw new Error(
      `${command} failed with exit code ${result.status}${details ? `: ${details}` : ""}`,
    );
  }
  return options.inherit ? "" : (result.stdout ?? "").trimEnd();
}

function commandStatus(
  command: string,
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
): { status: number; stderr: string } {
  const result = spawnSync(command, [...args], {
    encoding: "utf8",
    env: environment,
    stdio: ["ignore", "ignore", "pipe"],
  });
  if (result.error) throw result.error;
  if (result.status === null) {
    throw new Error(`${command} terminated without an exit status`);
  }
  return { status: result.status, stderr: (result.stderr ?? "").trim() };
}

function git(args: readonly string[], options: CommandOptions = {}): string {
  return run("git", args, options);
}

function gh(args: readonly string[], options: CommandOptions = {}): string {
  return run("gh", args, {
    ...options,
    env: options.env ?? authenticatedGhEnvironment(),
  });
}

function authenticatedGitEnvironment(token: string): NodeJS.ProcessEnv {
  const serverUrl = new URL(requiredEnvironment("GITHUB_SERVER_URL"));
  if (serverUrl.protocol !== "https:") {
    throw new Error("GITHUB_SERVER_URL must use HTTPS");
  }
  const authorization = Buffer.from(`x-access-token:${token}`).toString(
    "base64",
  );
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${serverUrl.origin}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
  };
}

function authenticatedGhEnvironment(): NodeJS.ProcessEnv {
  const token = requiredEnvironment("GH_TOKEN");
  const hostname = new URL(requiredEnvironment("GITHUB_SERVER_URL")).hostname;
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GH_HOST: hostname,
  };
  if (hostname === "github.com" || hostname.endsWith(".ghe.com")) {
    environment.GH_TOKEN = token;
  } else {
    delete environment.GH_TOKEN;
    environment.GH_ENTERPRISE_TOKEN = token;
  }
  return environment;
}

function appendOutput(name: string, value: string | boolean): void {
  if (/[\r\n]/.test(name) || /[\r\n]/.test(String(value))) {
    throw new Error(`GitHub output ${name} contains a newline`);
  }
  appendFileSync(
    requiredEnvironment("GITHUB_OUTPUT"),
    `${name}=${String(value)}\n`,
    "utf8",
  );
}

function appendSummary(markdown: string): void {
  appendFileSync(
    requiredEnvironment("GITHUB_STEP_SUMMARY"),
    markdown.endsWith("\n") ? markdown : `${markdown}\n`,
    "utf8",
  );
}

function readProductVersion(source: string, description: string): string {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${description} is not valid JSON`);
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    typeof value.version !== "string"
  ) {
    throw new Error(`${description} does not contain a string version`);
  }
  return value.version;
}

function currentProductVersion(): string {
  return readProductVersion(
    readFileSync(PRODUCT_VERSION_FILE, "utf8"),
    PRODUCT_VERSION_FILE,
  );
}

function productVersionAt(reference: string, versionFile: string): string {
  return readProductVersion(
    git(["show", `${reference}:${versionFile}`]),
    `${reference}:${versionFile}`,
  );
}

function gitTrailer(commit: string, key: string): string {
  return git([
    "show",
    "-s",
    `--format=%(trailers:key=${key},valueonly)`,
    commit,
  ]).replaceAll(/\s/g, "");
}

function gitCommitForRef(reference: string): string | undefined {
  const commitReference = `${reference}^{commit}`;
  const result = commandStatus("git", [
    "rev-parse",
    "-q",
    "--verify",
    commitReference,
  ]);
  if (result.status !== 0) {
    if (result.status === 1) return undefined;
    throw new Error(
      `Could not resolve ${reference}: ${result.stderr || `git exited ${result.status}`}`,
    );
  }
  return git(["rev-parse", commitReference]);
}

function isAncestor(ancestor: string, descendant: string): boolean {
  const result = commandStatus("git", [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant,
  ]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `Could not compare ${ancestor} and ${descendant}: ${result.stderr || `git exited ${result.status}`}`,
  );
}

function remoteTagExists(tag: string, token: string): boolean {
  const result = commandStatus(
    "git",
    ["ls-remote", "--exit-code", "--tags", "origin", `refs/tags/${tag}`],
    authenticatedGitEnvironment(token),
  );
  if (result.status === 0) return true;
  if (result.status === 2) return false;
  throw new Error(
    `Could not query remote tag ${tag}: ${result.stderr || `git exited ${result.status}`}`,
  );
}

function pushWithToken(args: readonly string[], token: string): void {
  git(["push", ...args], {
    env: authenticatedGitEnvironment(token),
    inherit: true,
  });
}

function listGitHubReleases(repository: string): GitHubReleaseRecord[] {
  const response = gh([
    "api",
    "--paginate",
    `repos/${repository}/releases?per_page=100`,
    "--jq",
    ".[] | {tag_name, draft, target_commitish}",
  ]);
  const releases: GitHubReleaseRecord[] = [];
  for (const line of response.split(/\r?\n/).filter(Boolean)) {
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      throw new Error("GitHub returned invalid JSON while listing Releases");
    }
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("tag_name" in entry) ||
      typeof entry.tag_name !== "string" ||
      !("draft" in entry) ||
      typeof entry.draft !== "boolean" ||
      !("target_commitish" in entry) ||
      typeof entry.target_commitish !== "string"
    ) {
      throw new Error("GitHub Release listing contained an invalid record");
    }
    releases.push({
      tag_name: entry.tag_name,
      draft: entry.draft,
      target_commitish: entry.target_commitish,
    });
  }
  return releases;
}

export function resolveBuildTargets(target: BuildTarget): {
  buildDesktop: boolean;
  buildDocker: boolean;
} {
  switch (target) {
    case "desktop":
      return { buildDesktop: true, buildDocker: false };
    case "docker":
      return { buildDesktop: false, buildDocker: true };
    case "all":
      return { buildDesktop: true, buildDocker: true };
  }
}

export function findUniqueRelease(
  releases: readonly GitHubReleaseRecord[],
  tag: string,
): GitHubReleaseRecord | undefined {
  const matches = releases.filter((release) => release.tag_name === tag);
  if (matches.length > 1) {
    throw new Error(`Found multiple GitHub Releases for ${tag}`);
  }
  return matches[0];
}

export function decideReleaseRecovery(options: {
  currentTag: string;
  release?: GitHubReleaseRecord;
  tagTarget?: string;
  tagOwnerTarget?: string;
  tagOwnerRunId?: string;
  buildTarget: BuildTarget;
  runAttempt: number;
  runId: string;
}): { resume: boolean; targetCommitish?: string } {
  if (options.release) {
    if (options.release.draft) {
      return {
        resume: true,
        targetCommitish: options.tagTarget ?? options.release.target_commitish,
      };
    }
    if (options.runAttempt !== 1) {
      throw new Error(
        `${options.currentTag} is already published; do not rerun this completed release`,
      );
    }
    return { resume: false };
  }

  if (!options.tagTarget) return { resume: false };
  if (
    options.tagOwnerTarget === "desktop" ||
    options.tagOwnerTarget === "all"
  ) {
    if (options.tagOwnerTarget !== options.buildTarget) {
      throw new Error(
        `${options.currentTag} is an unfinished ${options.tagOwnerTarget} release; rerun it with the same build target`,
      );
    }
    return { resume: true, targetCommitish: options.tagTarget };
  }
  if (
    options.tagOwnerTarget === "docker" &&
    options.tagOwnerRunId === options.runId
  ) {
    throw new Error(
      `Docker-only release ${options.currentTag} was already completed by this workflow run`,
    );
  }
  return { resume: false };
}

export function chooseReleaseSource(options: {
  head: string;
  resumeDraft: boolean;
  draftTarget?: string;
  pending: boolean;
  pendingCommits: readonly string[];
  version: string;
}): string {
  if (options.resumeDraft) {
    if (!options.draftTarget) {
      throw new Error("A resumed draft Release has no target commit");
    }
    return options.draftTarget;
  }
  if (!options.pending) return options.head;
  if (options.pendingCommits.length !== 1) {
    throw new Error(
      `Expected exactly one release commit for v${options.version}; found ${options.pendingCommits.length}`,
    );
  }
  return options.pendingCommits[0];
}

export function selectOwnedRerunCommit(options: {
  ownedCommits: readonly string[];
  ownedVersion?: string;
  masterVersion?: string;
  runId: string;
}): string {
  if (options.ownedCommits.length !== 1) {
    throw new Error(
      `Master moved after this run started, and no unique version commit owned by run ${options.runId} was found`,
    );
  }
  if (
    options.ownedVersion !== undefined &&
    options.masterVersion !== undefined &&
    options.ownedVersion !== options.masterVersion
  ) {
    throw new Error(
      `This run prepared v${options.ownedVersion}, but master is already v${options.masterVersion}. Old release runs cannot publish a newer version`,
    );
  }
  return options.ownedCommits[0];
}

export function buildDesktopReleasePlan(options: {
  mode: ReleaseMode;
  channel: ReleaseChannel;
  version: string;
  officialTag: string;
  sourceSha: string;
  runId: string;
}): DesktopReleasePlan {
  if (options.mode === "test") {
    const tag = `desktop-test-${options.runId}`;
    return {
      tag,
      title: `Desktop test ${options.version}`,
      createArguments: [
        tag,
        "--draft",
        "--verify-tag",
        "--target",
        options.sourceSha,
        "--title",
        `Desktop test ${options.version}`,
        "--prerelease",
        "--notes",
        `Private desktop test build from commit ${options.sourceSha}.`,
      ],
    };
  }

  const title = `MediaGo ${options.version}`;
  const createArguments = [
    options.officialTag,
    "--draft",
    "--verify-tag",
    "--target",
    options.sourceSha,
    "--title",
    title,
    "--generate-notes",
  ];
  if (options.channel !== "latest") {
    createArguments.push("--prerelease", "--latest=false");
  }
  return { tag: options.officialTag, title, createArguments };
}

function validateRequest(): void {
  const mode = parseChoice("RUN_MODE", requiredEnvironment("RUN_MODE"), [
    "test",
    "release",
  ] as const);
  const target = parseChoice(
    "BUILD_TARGET",
    requiredEnvironment("BUILD_TARGET"),
    ["all", "desktop", "docker"] as const,
  );
  const selectedRef = requiredEnvironment("SELECTED_REF");
  const selectedSha = requiredEnvironment("SELECTED_SHA");
  const token = requiredEnvironment("GH_TOKEN");
  const attempt = parseAttempt(requiredEnvironment("RUN_ATTEMPT"));
  const targets = resolveBuildTargets(target);
  appendOutput("build_desktop", targets.buildDesktop);
  appendOutput("build_docker", targets.buildDocker);

  if (selectedRef !== "refs/heads/master") {
    throw new Error(
      "Build and release runs must use the master branch in 'Use workflow from'",
    );
  }

  git(
    [
      "fetch",
      "--force",
      "--tags",
      "origin",
      "master:refs/remotes/origin/master",
    ],
    { env: authenticatedGitEnvironment(token), inherit: true },
  );
  if (mode !== "release") return;

  const remoteMaster = git(["rev-parse", "refs/remotes/origin/master"]);
  const checkedOutSha = git(["rev-parse", "HEAD"]);
  if (checkedOutSha !== remoteMaster) {
    throw new Error(
      `Checked out master ${checkedOutSha} is not current origin/master ${remoteMaster}`,
    );
  }
  if (attempt === 1 && selectedSha !== remoteMaster) {
    throw new Error(
      `Selected master commit ${selectedSha} is not current origin/master ${remoteMaster}`,
    );
  }
  if (attempt === 1 || selectedSha === remoteMaster) return;
  if (!isAncestor(selectedSha, remoteMaster)) {
    throw new Error(
      `Original source ${selectedSha} is not in current master history`,
    );
  }

  const runId = requiredEnvironment("GITHUB_RUN_ID");
  const commits = git([
    "rev-list",
    `${selectedSha}..${remoteMaster}`,
    "--",
    PRODUCT_VERSION_FILE,
  ])
    .split(/\r?\n/)
    .filter(Boolean);
  const ownedCommits = commits.filter(
    (commit) =>
      gitTrailer(commit, "MediaGo-Release-Run-Id") === runId &&
      gitTrailer(commit, "MediaGo-Release-Target") === target,
  );
  const ownedCommit = selectOwnedRerunCommit({ ownedCommits, runId });
  const ownedVersion = productVersionAt(ownedCommit, PRODUCT_VERSION_FILE);
  const masterVersion = productVersionAt(
    "refs/remotes/origin/master",
    PRODUCT_VERSION_FILE,
  );
  selectOwnedRerunCommit({
    ownedCommits,
    ownedVersion,
    masterVersion,
    runId,
  });
}

function detectReleaseState(): void {
  const target = parseChoice(
    "BUILD_TARGET",
    requiredEnvironment("BUILD_TARGET"),
    ["all", "desktop", "docker"] as const,
  );
  const attempt = parseAttempt(requiredEnvironment("RUN_ATTEMPT"));
  const runId = requiredEnvironment("GITHUB_RUN_ID");
  const repository = requiredEnvironment("REPOSITORY");
  const currentTag = `v${currentProductVersion()}`;
  const release = findUniqueRelease(listGitHubReleases(repository), currentTag);

  const tagTarget = gitCommitForRef(`refs/tags/${currentTag}`);
  const decision = decideReleaseRecovery({
    currentTag,
    release,
    tagTarget,
    tagOwnerTarget:
      !release && tagTarget
        ? gitTrailer(tagTarget, "MediaGo-Release-Target")
        : undefined,
    tagOwnerRunId:
      !release && tagTarget
        ? gitTrailer(tagTarget, "MediaGo-Release-Run-Id")
        : undefined,
    buildTarget: target,
    runAttempt: attempt,
    runId,
  });
  appendOutput("resume", decision.resume);
  if (decision.targetCommitish) {
    appendOutput("target_commitish", decision.targetCommitish);
  }
}

function calculateVersion(): void {
  const mode = parseChoice("RUN_MODE", requiredEnvironment("RUN_MODE"), [
    "test",
    "release",
  ] as const);
  const channel = parseChoice(
    "RELEASE_CHANNEL",
    requiredEnvironment("RELEASE_CHANNEL"),
    ["alpha", "beta", "latest"] as const,
  );
  const increment = parseChoice(
    "VERSION_INCREMENT",
    requiredEnvironment("VERSION_INCREMENT"),
    ["patch", "minor", "major"] as const,
  );
  const result = executeReleaseVersion({
    mode,
    channel,
    increment,
    resumeCurrent: parseBoolean(
      "RESUME_CURRENT",
      optionalEnvironment("RESUME_CURRENT", "false"),
    ),
    runNumber: requiredEnvironment("GITHUB_RUN_NUMBER"),
    githubOutput: requiredEnvironment("GITHUB_OUTPUT"),
  });
  process.stdout.write(
    `[release-version] ${result.currentVersion} -> ${result.version}` +
      `${result.pending ? " (pending retry)" : ""}${result.written ? " (written)" : ""}\n`,
  );
}

function commitVersion(): void {
  const token = requiredEnvironment("GH_TOKEN");
  const target = requiredEnvironment("BUILD_TARGET");
  const version = requiredEnvironment("VERSION");
  const versionFile = requiredEnvironment("VERSION_FILE");
  const runId = requiredEnvironment("GITHUB_RUN_ID");
  const changedFiles = git(["status", "--short"]);
  if (changedFiles !== ` M ${versionFile}`) {
    throw new Error(
      `Version calculation changed unexpected files:\n${changedFiles || "(none)"}`,
    );
  }

  git(["config", "user.name", "github-actions[bot]"]);
  git([
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  git(["add", "--", versionFile]);
  git(
    [
      "commit",
      "-m",
      `chore(release): v${version}`,
      "-m",
      `MediaGo-Release-Run-Id: ${runId}\nMediaGo-Release-Target: ${target}`,
    ],
    { inherit: true },
  );
  pushWithToken(["origin", "HEAD:master"], token);
}

function resolveSource(): void {
  const mode = parseChoice("RUN_MODE", requiredEnvironment("RUN_MODE"), [
    "test",
    "release",
  ] as const);
  const target = requiredEnvironment("BUILD_TARGET");
  const version = requiredEnvironment("VERSION");
  const versionFile = requiredEnvironment("VERSION_FILE");
  const pending = parseBoolean("PENDING", optionalEnvironment("PENDING"));
  const resumeDraft = parseBoolean(
    "RESUME_DRAFT",
    optionalEnvironment("RESUME_DRAFT"),
  );
  const attempt = parseAttempt(requiredEnvironment("RUN_ATTEMPT"));
  const head = git(["rev-parse", "HEAD"]);
  let pendingCommits: string[] = [];

  if (mode === "release" && pending && !resumeDraft) {
    const expectedSubject = `chore(release): v${version}`;
    pendingCommits = git(["log", "--format=%H%x09%s", "--", versionFile])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const tab = line.indexOf("\t");
        return {
          commit: tab === -1 ? line : line.slice(0, tab),
          subject: tab === -1 ? "" : line.slice(tab + 1),
        };
      })
      .filter((entry) => entry.subject === expectedSubject)
      .map((entry) => entry.commit);
  }

  const sourceSha =
    mode === "release"
      ? chooseReleaseSource({
          head,
          resumeDraft,
          draftTarget: optionalEnvironment("DRAFT_TARGET") || undefined,
          pending,
          pendingCommits,
          version,
        })
      : head;

  if (mode === "release") {
    if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
      throw new Error(
        `Release source must be a full commit SHA; received '${sourceSha}'`,
      );
    }
    if (!isAncestor(sourceSha, "refs/remotes/origin/master")) {
      throw new Error(
        `Release source ${sourceSha} is not in current master history`,
      );
    }
    const changedFiles = git([
      "diff-tree",
      "--no-commit-id",
      "--name-only",
      "-r",
      sourceSha,
    ]);
    if (changedFiles !== versionFile) {
      throw new Error(
        `Release commit ${sourceSha} changed files other than ${versionFile}: ${changedFiles || "(none)"}`,
      );
    }
    const sourceVersion = productVersionAt(sourceSha, versionFile);
    if (sourceVersion !== version) {
      throw new Error(
        `Release source ${sourceSha} contains version ${sourceVersion} instead of ${version}`,
      );
    }

    const ownerRunId = gitTrailer(sourceSha, "MediaGo-Release-Run-Id");
    const ownerTarget = gitTrailer(sourceSha, "MediaGo-Release-Target");
    if (!ownerRunId) {
      throw new Error(
        `Release commit ${sourceSha} has no MediaGo-Release-Run-Id trailer`,
      );
    }
    if (ownerTarget !== target) {
      throw new Error(
        `v${version} was prepared for target '${ownerTarget}', not '${target}'`,
      );
    }
    if (attempt !== 1 && ownerRunId !== requiredEnvironment("GITHUB_RUN_ID")) {
      throw new Error(
        `This rerun belongs to run ${requiredEnvironment("GITHUB_RUN_ID")}, but v${version} belongs to run ${ownerRunId}`,
      );
    }
  }

  appendOutput("source_sha", sourceSha);
}

function writePrepareSummary(): void {
  appendSummary(`### Build request

- **Mode:** \`${requiredEnvironment("RUN_MODE")}\`
- **Target:** \`${requiredEnvironment("BUILD_TARGET")}\`
- **Version:** \`${requiredEnvironment("VERSION")}\`
- **Channel:** \`${requiredEnvironment("RELEASE_CHANNEL")}\`
- **Commit:** \`${requiredEnvironment("SOURCE_SHA")}\`
- **Pending retry:** \`${requiredEnvironment("PENDING")}\`
`);
}

function ensureRemoteAnnotatedTag(options: {
  tag: string;
  sourceSha: string;
  title: string;
  token: string;
}): void {
  if (remoteTagExists(options.tag, options.token)) {
    git(
      [
        "fetch",
        "--force",
        "origin",
        `refs/tags/${options.tag}:refs/tags/${options.tag}`,
      ],
      {
        env: authenticatedGitEnvironment(options.token),
        inherit: true,
      },
    );
    const existingSha = git(["rev-parse", `refs/tags/${options.tag}^{commit}`]);
    if (existingSha !== options.sourceSha) {
      throw new Error(
        `Existing tag ${options.tag} points to ${existingSha} instead of ${options.sourceSha}`,
      );
    }
    return;
  }

  git(["config", "user.name", "github-actions[bot]"]);
  git([
    "config",
    "user.email",
    "41898282+github-actions[bot]@users.noreply.github.com",
  ]);
  git(["tag", "-a", options.tag, options.sourceSha, "-m", options.title]);
  pushWithToken(["origin", `refs/tags/${options.tag}`], options.token);
}

function publishDesktop(): void {
  const token = requiredEnvironment("GH_TOKEN");
  const mode = parseChoice("RUN_MODE", requiredEnvironment("RUN_MODE"), [
    "test",
    "release",
  ] as const);
  const channel = parseChoice(
    "RELEASE_CHANNEL",
    requiredEnvironment("RELEASE_CHANNEL"),
    ["alpha", "beta", "latest"] as const,
  );
  const version = requiredEnvironment("VERSION");
  const officialTag = requiredEnvironment("OFFICIAL_TAG");
  const repository = requiredEnvironment("REPOSITORY");
  const sourceSha = requiredEnvironment("SOURCE_SHA");
  const plan = buildDesktopReleasePlan({
    mode,
    channel,
    version,
    officialTag,
    sourceSha,
    runId: requiredEnvironment("GITHUB_RUN_ID"),
  });

  ensureRemoteAnnotatedTag({
    tag: plan.tag,
    sourceSha,
    title: plan.title,
    token,
  });

  const existingRelease = findUniqueRelease(
    listGitHubReleases(repository),
    plan.tag,
  );
  if (existingRelease && !existingRelease.draft) {
    throw new Error(`Release ${plan.tag} already exists and is published`);
  }
  if (!existingRelease) {
    gh(["release", "create", ...plan.createArguments, "--repo", repository], {
      inherit: true,
    });
  }

  const releaseFilesDirectory = optionalEnvironment(
    "RELEASE_FILES_DIR",
    "release-files",
  );
  const assets = readdirSync(releaseFilesDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(releaseFilesDirectory, entry.name))
    .filter((file) => statSync(file).isFile());
  if (assets.length === 0) {
    throw new Error("No desktop release files were collected");
  }
  gh(
    [
      "release",
      "upload",
      plan.tag,
      ...assets,
      "--clobber",
      "--repo",
      repository,
    ],
    { inherit: true },
  );

  if (mode === "release") {
    if (channel === "latest") {
      gh(
        [
          "release",
          "edit",
          plan.tag,
          "--draft=false",
          "--latest",
          "--repo",
          repository,
        ],
        { inherit: true },
      );
    } else {
      gh(
        [
          "release",
          "edit",
          plan.tag,
          "--draft=false",
          "--prerelease",
          "--latest=false",
          "--repo",
          repository,
        ],
        { inherit: true },
      );
    }
  }

  const serverUrl = requiredEnvironment("SERVER_URL");
  const url = `${serverUrl}/${repository}/releases/tag/${plan.tag}`;
  appendOutput("tag", plan.tag);
  appendOutput("url", url);
}

function writeDesktopSummary(): void {
  const visibility =
    requiredEnvironment("RUN_MODE") === "test"
      ? "\n- **Visibility:** draft; repository collaborators only"
      : "";
  appendSummary(`### Desktop result

- **Version:** \`${requiredEnvironment("VERSION")}\`
- **Tag:** \`${requiredEnvironment("TAG")}\`
- **URL:** ${requiredEnvironment("URL")}${visibility}
`);
}

function tagDockerRelease(): void {
  ensureRemoteAnnotatedTag({
    tag: requiredEnvironment("TAG"),
    sourceSha: requiredEnvironment("SOURCE_SHA"),
    title: `MediaGo ${requiredEnvironment("VERSION")}`,
    token: requiredEnvironment("GH_TOKEN"),
  });
}

export function runReleaseWorkflowCommand(command: string): void {
  switch (command) {
    case "validate-request":
      validateRequest();
      return;
    case "detect-release-state":
      detectReleaseState();
      return;
    case "calculate-version":
      calculateVersion();
      return;
    case "commit-version":
      commitVersion();
      return;
    case "resolve-source":
      resolveSource();
      return;
    case "write-prepare-summary":
      writePrepareSummary();
      return;
    case "publish-desktop":
      publishDesktop();
      return;
    case "write-desktop-summary":
      writeDesktopSummary();
      return;
    case "tag-docker-release":
      tagDockerRelease();
      return;
    default:
      throw new Error(`Unknown release workflow command: ${command}`);
  }
}

function main(): void {
  try {
    runReleaseWorkflowCommand(process.argv[2] ?? "");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === SCRIPT_FILE) {
  main();
}
