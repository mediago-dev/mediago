import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test, { type TestContext } from "node:test";
import {
  assertTagAvailable,
  compareSemVer,
  executeReleaseVersion,
  formatSemVer,
  parseSemVer,
  planRelease,
  type VersionIncrement,
} from "./release-version.ts";

const SCRIPT_FILE = fileURLToPath(
  new URL("./release-version.ts", import.meta.url),
);
const WORKSPACE_ROOT = resolve(dirname(SCRIPT_FILE), "..");

test("strictly parses and compares SemVer", () => {
  const parsed = parseSemVer("3.6.0-beta.2+sha.abc");
  assert.equal(formatSemVer(parsed), "3.6.0-beta.2+sha.abc");
  assert.ok(
    compareSemVer(parseSemVer("3.6.0-alpha.9"), parseSemVer("3.6.0-beta.0")) <
      0,
  );
  assert.ok(
    compareSemVer(parseSemVer("3.6.0-beta.9"), parseSemVer("3.6.0")) < 0,
  );

  for (const invalid of [
    "",
    "1.2",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "1.2.3-beta.01",
    "1.2.3-",
    "1.2.3+",
    "1.2.3-+build",
    "v1.2.3",
  ]) {
    assert.throws(() => parseSemVer(invalid), /Invalid SemVer|leading zeroes/);
  }
});

test("calculates stable patch, minor, and major versions", () => {
  const cases: Array<[VersionIncrement, string]> = [
    ["patch", "3.5.1"],
    ["minor", "3.6.0"],
    ["major", "4.0.0"],
  ];

  for (const [increment, expected] of cases) {
    const plan = planRelease({
      currentVersion: "3.5.0",
      tags: ["v3.5.0", "v3.5.0-beta.1", "not-a-version"],
      channel: "latest",
      increment,
    });
    assert.equal(plan.version, expected);
    assert.equal(plan.tag, `v${expected}`);
    assert.equal(plan.pending, false);
  }
});

test("increments prereleases and supports alpha to beta promotion", () => {
  const alphaTags = ["v3.5.0", "v3.6.0-alpha.0", "v3.6.0-alpha.2"];

  assert.equal(
    planRelease({
      currentVersion: "3.6.0-alpha.2",
      tags: alphaTags,
      channel: "alpha",
      increment: "minor",
    }).version,
    "3.6.0-alpha.3",
  );
  assert.equal(
    planRelease({
      currentVersion: "3.6.0-alpha.2",
      tags: alphaTags,
      channel: "beta",
      increment: "patch",
    }).version,
    "3.6.0-beta.0",
  );
  assert.equal(
    planRelease({
      currentVersion: "3.6.0-beta.1",
      tags: [...alphaTags, "v3.6.0-beta.0", "v3.6.0-beta.1"],
      channel: "beta",
      increment: "patch",
    }).version,
    "3.6.0-beta.2",
  );
});

test("promotes a prerelease to the matching stable version", () => {
  const plan = planRelease({
    currentVersion: "3.6.0-beta.2",
    tags: ["v3.5.0", "v3.6.0-beta.0", "v3.6.0-beta.2"],
    channel: "latest",
    increment: "patch",
  });
  assert.equal(plan.version, "3.6.0");
});

test("rejects stale, non-monotonic, and duplicate versions", () => {
  assert.throws(
    () =>
      planRelease({
        currentVersion: "3.5.0",
        tags: ["v3.6.0"],
        channel: "latest",
        increment: "patch",
      }),
    /behind highest tag/,
  );
  assert.throws(
    () =>
      planRelease({
        currentVersion: "3.6.0-beta.0",
        tags: ["v3.5.0", "v3.6.0-beta.0"],
        channel: "alpha",
        increment: "minor",
      }),
    /not newer than highest tag/,
  );
  assert.throws(
    () => assertTagAvailable("3.5.0", ["v3.5.0+existing-build"]),
    /conflicts with existing tag/,
  );
});

test("pending retries retain their channel and ignore a changed increment", () => {
  assert.throws(
    () =>
      planRelease({
        currentVersion: "3.6.0-beta.0",
        tags: ["v3.5.0"],
        channel: "alpha",
        increment: "minor",
      }),
    /must use alpha\.N/,
  );
  const retry = planRelease({
    currentVersion: "3.6.0-beta.0",
    tags: ["v3.5.0"],
    channel: "beta",
    increment: "patch",
  });
  assert.equal(retry.version, "3.6.0-beta.0");
  assert.equal(retry.pending, true);
});

test("test mode is read-only and release retries are idempotent", (t) => {
  const root = createRepository(t, "3.5.0", ["v3.5.0"]);
  const versionFile = join(root, "apps", "electron", "app", "package.json");
  const githubOutput = join(root, "github-output.txt");
  const originalPackage = readFileSync(versionFile, "utf8");

  const preview = executeReleaseVersion({
    workspaceRoot: root,
    githubOutput,
    mode: "test",
    channel: "beta",
    increment: "minor",
    runNumber: "42",
  });
  assert.equal(preview.version, "3.5.0-test.42");
  assert.equal(preview.written, false);
  assert.equal(readPackageVersion(versionFile), "3.5.0");
  assert.match(readFileSync(githubOutput, "utf8"), /^release_type=draft$/m);

  const release = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "minor",
  });
  assert.equal(release.version, "3.6.0-beta.0");
  assert.equal(release.written, true);
  assert.equal(readPackageVersion(versionFile), "3.6.0-beta.0");
  assert.equal(
    readFileSync(versionFile, "utf8"),
    originalPackage.replace('"version": "3.5.0"', '"version": "3.6.0-beta.0"'),
  );

  const retry = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "minor",
  });
  assert.equal(retry.version, "3.6.0-beta.0");
  assert.equal(retry.pending, true);
  assert.equal(retry.written, false);
});

test("CLI is cwd-independent and preserves GitHub output order", (t) => {
  const externalCwd = mkdtempSync(join(tmpdir(), "mediago-release-cli-"));
  t.after(() => rmSync(externalCwd, { recursive: true, force: true }));

  const productVersion = readPackageVersion(
    join(WORKSPACE_ROOT, "apps", "electron", "app", "package.json"),
  );
  const parsed = parseSemVer(productVersion);
  const stdout = execFileSync(
    process.execPath,
    [
      SCRIPT_FILE,
      "--mode",
      "test",
      "--channel",
      "beta",
      "--increment",
      "patch",
      "--run-number",
      "4242",
    ],
    {
      cwd: externalCwd,
      encoding: "utf8",
      env: { ...process.env, GITHUB_OUTPUT: "", GITHUB_RUN_NUMBER: "" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  assert.match(
    stdout,
    new RegExp(
      `^version=${parsed.major}\\.${parsed.minor}\\.${parsed.patch}-test\\.4242$`,
      "m",
    ),
  );
  assert.deepEqual(
    stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.slice(0, line.indexOf("="))),
    [
      "version",
      "tag",
      "current_version",
      "base_version",
      "channel",
      "increment",
      "mode",
      "release_type",
      "prerelease",
      "changed",
      "written",
      "pending",
      "resumed",
      "version_file",
    ],
  );
});

test("explicitly resumes a current version even when its tag exists", (t) => {
  const root = createRepository(t, "3.6.0-beta.0", ["v3.5.0", "v3.6.0-beta.0"]);
  const resumed = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "patch",
    resumeCurrent: true,
  });

  assert.equal(resumed.version, "3.6.0-beta.0");
  assert.equal(resumed.pending, true);
  assert.equal(resumed.written, false);
  assert.equal(resumed.outputs.resumed, "true");
});

test("rejects resume-current in test mode", (t) => {
  const root = createRepository(t, "3.6.0-beta.0", ["v3.5.0"]);
  assert.throws(
    () =>
      executeReleaseVersion({
        workspaceRoot: root,
        mode: "test",
        channel: "beta",
        increment: "patch",
        runNumber: "42",
        resumeCurrent: true,
      }),
    /only valid in release mode/,
  );
});

function createRepository(
  t: TestContext,
  version: string,
  tags: string[],
): string {
  const root = mkdtempSync(join(tmpdir(), "mediago-release-version-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));

  const appDirectory = join(root, "apps", "electron", "app");
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(
    join(appDirectory, "package.json"),
    `${JSON.stringify({ name: "mediago-community", version, private: true }, null, 2)}\n`,
    "utf8",
  );
  runGit(root, ["init", "--quiet"]);
  runGit(root, ["config", "user.email", "release-version@example.com"]);
  runGit(root, ["config", "user.name", "Release Version Test"]);
  runGit(root, ["add", "."]);
  runGit(root, ["commit", "--quiet", "-m", "initial"]);
  for (const tag of tags) runGit(root, ["tag", tag]);
  return root;
}

function runGit(root: string, args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

function readPackageVersion(file: string): string {
  return JSON.parse(readFileSync(file, "utf8")).version;
}
