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
import { expect, onTestFinished, test } from "vitest";
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
  expect(formatSemVer(parsed)).toBe("3.6.0-beta.2+sha.abc");
  expect(
    compareSemVer(parseSemVer("3.6.0-alpha.9"), parseSemVer("3.6.0-beta.0")) <
      0,
  ).toBeTruthy();
  expect(
    compareSemVer(parseSemVer("3.6.0-beta.9"), parseSemVer("3.6.0")) < 0,
  ).toBeTruthy();

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
    expect(() => parseSemVer(invalid)).toThrow(/Invalid SemVer|leading zeroes/);
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
    expect(plan.version).toBe(expected);
    expect(plan.tag).toBe(`v${expected}`);
    expect(plan.pending).toBe(false);
  }
});

test("increments prereleases and supports alpha to beta promotion", () => {
  const alphaTags = ["v3.5.0", "v3.6.0-alpha.0", "v3.6.0-alpha.2"];

  expect(
    planRelease({
      currentVersion: "3.6.0-alpha.2",
      tags: alphaTags,
      channel: "alpha",
      increment: "minor",
    }).version,
  ).toBe("3.6.0-alpha.3");
  expect(
    planRelease({
      currentVersion: "3.6.0-alpha.2",
      tags: alphaTags,
      channel: "beta",
      increment: "patch",
    }).version,
  ).toBe("3.6.0-beta.0");
  expect(
    planRelease({
      currentVersion: "3.6.0-beta.1",
      tags: [...alphaTags, "v3.6.0-beta.0", "v3.6.0-beta.1"],
      channel: "beta",
      increment: "patch",
    }).version,
  ).toBe("3.6.0-beta.2");
});

test("promotes a prerelease to the matching stable version", () => {
  const plan = planRelease({
    currentVersion: "3.6.0-beta.2",
    tags: ["v3.5.0", "v3.6.0-beta.0", "v3.6.0-beta.2"],
    channel: "latest",
    increment: "patch",
  });
  expect(plan.version).toBe("3.6.0");
});

test("rejects stale, non-monotonic, and duplicate versions", () => {
  expect(() =>
    planRelease({
      currentVersion: "3.5.0",
      tags: ["v3.6.0"],
      channel: "latest",
      increment: "patch",
    }),
  ).toThrow(/behind highest tag/);
  expect(() =>
    planRelease({
      currentVersion: "3.6.0-beta.0",
      tags: ["v3.5.0", "v3.6.0-beta.0"],
      channel: "alpha",
      increment: "minor",
    }),
  ).toThrow(/not newer than highest tag/);
  expect(() => assertTagAvailable("3.5.0", ["v3.5.0+existing-build"])).toThrow(
    /conflicts with existing tag/,
  );
});

test("pending retries retain their channel and ignore a changed increment", () => {
  expect(() =>
    planRelease({
      currentVersion: "3.6.0-beta.0",
      tags: ["v3.5.0"],
      channel: "alpha",
      increment: "minor",
    }),
  ).toThrow(/must use alpha\.N/);
  const retry = planRelease({
    currentVersion: "3.6.0-beta.0",
    tags: ["v3.5.0"],
    channel: "beta",
    increment: "patch",
  });
  expect(retry.version).toBe("3.6.0-beta.0");
  expect(retry.pending).toBe(true);
});

test("test mode is read-only and release retries are idempotent", () => {
  const root = createRepository("3.5.0", ["v3.5.0"]);
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
  expect(preview.version).toBe("3.5.0-test.42");
  expect(preview.written).toBe(false);
  expect(readPackageVersion(versionFile)).toBe("3.5.0");
  expect(readFileSync(githubOutput, "utf8")).toMatch(/^release_type=draft$/m);

  const release = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "minor",
  });
  expect(release.version).toBe("3.6.0-beta.0");
  expect(release.written).toBe(true);
  expect(readPackageVersion(versionFile)).toBe("3.6.0-beta.0");
  expect(readFileSync(versionFile, "utf8")).toBe(
    originalPackage.replace('"version": "3.5.0"', '"version": "3.6.0-beta.0"'),
  );

  const retry = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "minor",
  });
  expect(retry.version).toBe("3.6.0-beta.0");
  expect(retry.pending).toBe(true);
  expect(retry.written).toBe(false);
});

test("CLI is cwd-independent and preserves GitHub output order", () => {
  const externalCwd = mkdtempSync(join(tmpdir(), "mediago-release-cli-"));
  onTestFinished(() => rmSync(externalCwd, { recursive: true, force: true }));

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

  expect(stdout).toMatch(
    new RegExp(
      `^version=${parsed.major}\\.${parsed.minor}\\.${parsed.patch}-test\\.4242$`,
      "m",
    ),
  );
  expect(
    stdout
      .trim()
      .split(/\r?\n/)
      .map((line) => line.slice(0, line.indexOf("="))),
  ).toStrictEqual([
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
  ]);
});

test("explicitly resumes a current version even when its tag exists", () => {
  const root = createRepository("3.6.0-beta.0", ["v3.5.0", "v3.6.0-beta.0"]);
  const resumed = executeReleaseVersion({
    workspaceRoot: root,
    mode: "release",
    channel: "beta",
    increment: "patch",
    resumeCurrent: true,
  });

  expect(resumed.version).toBe("3.6.0-beta.0");
  expect(resumed.pending).toBe(true);
  expect(resumed.written).toBe(false);
  expect(resumed.outputs.resumed).toBe("true");
});

test("rejects resume-current in test mode", () => {
  const root = createRepository("3.6.0-beta.0", ["v3.5.0"]);
  expect(() =>
    executeReleaseVersion({
      workspaceRoot: root,
      mode: "test",
      channel: "beta",
      increment: "patch",
      runNumber: "42",
      resumeCurrent: true,
    }),
  ).toThrow(/only valid in release mode/);
});

function createRepository(version: string, tags: string[]): string {
  const root = mkdtempSync(join(tmpdir(), "mediago-release-version-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));

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
