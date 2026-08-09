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
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import {
  applyDesktopBuildVersion,
  createDesktopArtifactPrefix,
  validateDesktopBuildRequest,
  verifyDesktopSource,
} from "./desktop-workflow.ts";

const SOURCE_SHA = "0123456789abcdef0123456789abcdef01234567";

test("validates desktop build requests and release channels", () => {
  validateDesktopBuildRequest({
    runMode: "test",
    version: "3.6.0-test.42",
    releaseChannel: "beta",
    sourceSha: SOURCE_SHA,
  });
  validateDesktopBuildRequest({
    runMode: "release",
    version: "3.6.0-beta.2",
    releaseChannel: "beta",
    sourceSha: SOURCE_SHA.toUpperCase(),
  });

  assert.throws(
    () =>
      validateDesktopBuildRequest({
        runMode: "publish",
        version: "3.6.0",
        releaseChannel: "latest",
        sourceSha: SOURCE_SHA,
      }),
    /Unsupported run_mode/,
  );
  assert.throws(
    () =>
      validateDesktopBuildRequest({
        runMode: "release",
        version: "3.6.0-beta.2",
        releaseChannel: "latest",
        sourceSha: SOURCE_SHA,
      }),
    /does not match release channel/,
  );
  assert.throws(
    () =>
      validateDesktopBuildRequest({
        runMode: "test",
        version: "3.6.0+build.1",
        releaseChannel: "beta",
        sourceSha: "abc",
      }),
    /source_sha/,
  );
});

test("creates the existing desktop artifact prefix and output", (t) => {
  const root = createWorkspace(t, "3.5.0");
  const output = join(root, "github-output.txt");
  const prefix = createDesktopArtifactPrefix({
    runMode: "test",
    version: "3.5.0-test.42",
    sourceSha: SOURCE_SHA,
    runId: "12345",
    runAttempt: "2",
    githubOutput: output,
  });

  assert.equal(prefix, "mediago-test-3.5.0-test.42-0123456789ab-12345-2");
  assert.equal(readFileSync(output, "utf8"), `artifact_prefix=${prefix}\n`);
});

test("applies test versions but protects committed release versions", (t) => {
  const root = createWorkspace(t, "3.5.0");
  const versionFile = join(root, "apps", "electron", "app", "package.json");

  applyDesktopBuildVersion({
    runMode: "test",
    version: "3.5.0-test.42",
    workspaceRoot: root,
  });
  assert.equal(readPackageVersion(versionFile), "3.5.0-test.42");

  assert.throws(
    () =>
      applyDesktopBuildVersion({
        runMode: "release",
        version: "3.5.1",
        workspaceRoot: root,
      }),
    /does not match/,
  );
});

test("verifies that the checked-out test source has the requested SHA", (t) => {
  const root = createWorkspace(t, "3.5.0", true);
  const actualSha = runGit(root, ["rev-parse", "HEAD"]);
  const output = join(root, "github-output.txt");

  assert.equal(
    verifyDesktopSource({
      runMode: "test",
      version: "3.5.0-test.42",
      sourceSha: actualSha.toUpperCase(),
      workspaceRoot: root,
      githubOutput: output,
    }),
    actualSha,
  );
  assert.equal(readFileSync(output, "utf8"), `source_sha=${actualSha}\n`);

  assert.throws(
    () =>
      verifyDesktopSource({
        runMode: "test",
        version: "3.5.0-test.42",
        sourceSha: SOURCE_SHA,
        workspaceRoot: root,
        githubOutput: output,
      }),
    /instead of requested SHA/,
  );
});

function createWorkspace(
  t: TestContext,
  version: string,
  initializeGit = false,
): string {
  const root = mkdtempSync(join(tmpdir(), "mediago-desktop-workflow-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const appDirectory = join(root, "apps", "electron", "app");
  mkdirSync(appDirectory, { recursive: true });
  writeFileSync(
    join(appDirectory, "package.json"),
    `${JSON.stringify({ name: "mediago-community", version }, null, 2)}\n`,
    "utf8",
  );
  if (initializeGit) {
    runGit(root, ["init", "--quiet"]);
    runGit(root, ["config", "user.email", "desktop-workflow@example.com"]);
    runGit(root, ["config", "user.name", "Desktop Workflow Test"]);
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "--quiet", "-m", "initial"]);
  }
  return root;
}

function runGit(root: string, args: string[]): string {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function readPackageVersion(file: string): string {
  return JSON.parse(readFileSync(file, "utf8")).version;
}
