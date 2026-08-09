import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDesktopReleasePlan,
  chooseReleaseSource,
  decideReleaseRecovery,
  findUniqueRelease,
  resolveBuildTargets,
  selectOwnedRerunCommit,
  type GitHubReleaseRecord,
} from "./release-workflow.ts";

test("maps each build target to the requested workers", () => {
  assert.deepEqual(resolveBuildTargets("desktop"), {
    buildDesktop: true,
    buildDocker: false,
  });
  assert.deepEqual(resolveBuildTargets("docker"), {
    buildDesktop: false,
    buildDocker: true,
  });
  assert.deepEqual(resolveBuildTargets("all"), {
    buildDesktop: true,
    buildDocker: true,
  });
});

test("finds one Release by tag and rejects ambiguous state", () => {
  const release: GitHubReleaseRecord = {
    tag_name: "v3.6.0",
    draft: true,
    target_commitish: "a".repeat(40),
  };
  assert.equal(findUniqueRelease([release], "v3.6.0"), release);
  assert.equal(findUniqueRelease([release], "v3.6.1"), undefined);
  assert.throws(
    () => findUniqueRelease([release, { ...release }], "v3.6.0"),
    /multiple GitHub Releases/,
  );
});

test("builds an isolated draft plan for desktop tests", () => {
  const plan = buildDesktopReleasePlan({
    mode: "test",
    channel: "beta",
    version: "3.5.0-test.42",
    officialTag: "unused",
    sourceSha: "a".repeat(40),
    runId: "1234",
  });
  assert.equal(plan.tag, "desktop-test-1234");
  assert.match(plan.title, /Desktop test 3\.5\.0-test\.42/);
  assert.ok(plan.createArguments.includes("--draft"));
  assert.ok(plan.createArguments.includes("--prerelease"));
  assert.ok(!plan.createArguments.includes("--generate-notes"));
});

test("marks only prerelease channels as prereleases", () => {
  const stable = buildDesktopReleasePlan({
    mode: "release",
    channel: "latest",
    version: "3.6.0",
    officialTag: "v3.6.0",
    sourceSha: "b".repeat(40),
    runId: "1",
  });
  assert.ok(stable.createArguments.includes("--generate-notes"));
  assert.ok(!stable.createArguments.includes("--prerelease"));

  const beta = buildDesktopReleasePlan({
    mode: "release",
    channel: "beta",
    version: "3.6.0-beta.0",
    officialTag: "v3.6.0-beta.0",
    sourceSha: "c".repeat(40),
    runId: "2",
  });
  assert.ok(beta.createArguments.includes("--prerelease"));
  assert.ok(beta.createArguments.includes("--latest=false"));
});

test("resumes drafts and unfinished desktop tags at their fixed source", () => {
  const draft = decideReleaseRecovery({
    currentTag: "v3.6.0",
    release: {
      tag_name: "v3.6.0",
      draft: true,
      target_commitish: "a".repeat(40),
    },
    tagTarget: "b".repeat(40),
    buildTarget: "desktop",
    runAttempt: 2,
    runId: "100",
  });
  assert.deepEqual(draft, {
    resume: true,
    targetCommitish: "b".repeat(40),
  });

  const unfinished = decideReleaseRecovery({
    currentTag: "v3.6.0",
    tagTarget: "c".repeat(40),
    tagOwnerTarget: "all",
    tagOwnerRunId: "90",
    buildTarget: "all",
    runAttempt: 1,
    runId: "100",
  });
  assert.deepEqual(unfinished, {
    resume: true,
    targetCommitish: "c".repeat(40),
  });
});

test("rejects incompatible or completed release recovery", () => {
  assert.throws(
    () =>
      decideReleaseRecovery({
        currentTag: "v3.6.0",
        tagTarget: "a".repeat(40),
        tagOwnerTarget: "desktop",
        buildTarget: "all",
        runAttempt: 1,
        runId: "100",
      }),
    /same build target/,
  );
  assert.throws(
    () =>
      decideReleaseRecovery({
        currentTag: "v3.6.0",
        tagTarget: "a".repeat(40),
        tagOwnerTarget: "docker",
        tagOwnerRunId: "100",
        buildTarget: "docker",
        runAttempt: 2,
        runId: "100",
      }),
    /already completed/,
  );
  assert.deepEqual(
    decideReleaseRecovery({
      currentTag: "v3.6.0",
      tagTarget: "a".repeat(40),
      tagOwnerTarget: "docker",
      tagOwnerRunId: "99",
      buildTarget: "docker",
      runAttempt: 1,
      runId: "100",
    }),
    { resume: false },
  );
  assert.throws(
    () =>
      decideReleaseRecovery({
        currentTag: "v3.6.0",
        release: {
          tag_name: "v3.6.0",
          draft: false,
          target_commitish: "master",
        },
        buildTarget: "desktop",
        runAttempt: 2,
        runId: "100",
      }),
    /already published/,
  );
});

test("selects draft and pending sources without silently changing commits", () => {
  assert.equal(
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: true,
      draftTarget: "b".repeat(40),
      pending: true,
      pendingCommits: ["c".repeat(40)],
      version: "3.6.0",
    }),
    "b".repeat(40),
  );
  assert.equal(
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: false,
      pending: true,
      pendingCommits: ["c".repeat(40)],
      version: "3.6.0",
    }),
    "c".repeat(40),
  );
  assert.throws(
    () =>
      chooseReleaseSource({
        head: "a".repeat(40),
        resumeDraft: false,
        pending: true,
        pendingCommits: [],
        version: "3.6.0",
      }),
    /exactly one release commit/,
  );
  assert.throws(
    () =>
      chooseReleaseSource({
        head: "a".repeat(40),
        resumeDraft: false,
        pending: true,
        pendingCommits: ["b".repeat(40), "c".repeat(40)],
        version: "3.6.0",
      }),
    /found 2/,
  );
});

test("rejects reruns without one owned commit or after master advances", () => {
  assert.throws(
    () => selectOwnedRerunCommit({ ownedCommits: [], runId: "100" }),
    /no unique version commit/,
  );
  assert.throws(
    () =>
      selectOwnedRerunCommit({
        ownedCommits: ["a".repeat(40), "b".repeat(40)],
        runId: "100",
      }),
    /no unique version commit/,
  );
  assert.throws(
    () =>
      selectOwnedRerunCommit({
        ownedCommits: ["a".repeat(40)],
        ownedVersion: "3.6.0",
        masterVersion: "3.7.0",
        runId: "100",
      }),
    /cannot publish a newer version/,
  );
  assert.equal(
    selectOwnedRerunCommit({
      ownedCommits: ["a".repeat(40)],
      ownedVersion: "3.6.0",
      masterVersion: "3.6.0",
      runId: "100",
    }),
    "a".repeat(40),
  );
});
