import { expect, test } from "vitest";
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
  expect(resolveBuildTargets("desktop")).toStrictEqual({
    buildDesktop: true,
    buildDocker: false,
  });
  expect(resolveBuildTargets("docker")).toStrictEqual({
    buildDesktop: false,
    buildDocker: true,
  });
  expect(resolveBuildTargets("all")).toStrictEqual({
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
  expect(findUniqueRelease([release], "v3.6.0")).toBe(release);
  expect(findUniqueRelease([release], "v3.6.1")).toBe(undefined);
  expect(() => findUniqueRelease([release, { ...release }], "v3.6.0")).toThrow(
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
  expect(plan.tag).toBe("desktop-test-1234");
  expect(plan.title).toMatch(/Desktop test 3\.5\.0-test\.42/);
  expect(plan.createArguments.includes("--draft")).toBeTruthy();
  expect(plan.createArguments.includes("--prerelease")).toBeTruthy();
  expect(!plan.createArguments.includes("--generate-notes")).toBeTruthy();
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
  expect(stable.createArguments.includes("--generate-notes")).toBeTruthy();
  expect(!stable.createArguments.includes("--prerelease")).toBeTruthy();

  const beta = buildDesktopReleasePlan({
    mode: "release",
    channel: "beta",
    version: "3.6.0-beta.0",
    officialTag: "v3.6.0-beta.0",
    sourceSha: "c".repeat(40),
    runId: "2",
  });
  expect(beta.createArguments.includes("--prerelease")).toBeTruthy();
  expect(beta.createArguments.includes("--latest=false")).toBeTruthy();
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
  expect(draft).toStrictEqual({
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
  expect(unfinished).toStrictEqual({
    resume: true,
    targetCommitish: "c".repeat(40),
  });
});

test("rejects incompatible or completed release recovery", () => {
  expect(() =>
    decideReleaseRecovery({
      currentTag: "v3.6.0",
      tagTarget: "a".repeat(40),
      tagOwnerTarget: "desktop",
      buildTarget: "all",
      runAttempt: 1,
      runId: "100",
    }),
  ).toThrow(/same build target/);
  expect(() =>
    decideReleaseRecovery({
      currentTag: "v3.6.0",
      tagTarget: "a".repeat(40),
      tagOwnerTarget: "docker",
      tagOwnerRunId: "100",
      buildTarget: "docker",
      runAttempt: 2,
      runId: "100",
    }),
  ).toThrow(/already completed/);
  expect(
    decideReleaseRecovery({
      currentTag: "v3.6.0",
      tagTarget: "a".repeat(40),
      tagOwnerTarget: "docker",
      tagOwnerRunId: "99",
      buildTarget: "docker",
      runAttempt: 1,
      runId: "100",
    }),
  ).toStrictEqual({ resume: false });
  expect(() =>
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
  ).toThrow(/already published/);
});

test("selects draft and pending sources without silently changing commits", () => {
  expect(
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: true,
      draftTarget: "b".repeat(40),
      pending: true,
      pendingCommits: ["c".repeat(40)],
      version: "3.6.0",
    }),
  ).toBe("b".repeat(40));
  expect(
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: false,
      pending: true,
      pendingCommits: ["c".repeat(40)],
      version: "3.6.0",
    }),
  ).toBe("c".repeat(40));
  expect(() =>
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: false,
      pending: true,
      pendingCommits: [],
      version: "3.6.0",
    }),
  ).toThrow(/exactly one release commit/);
  expect(() =>
    chooseReleaseSource({
      head: "a".repeat(40),
      resumeDraft: false,
      pending: true,
      pendingCommits: ["b".repeat(40), "c".repeat(40)],
      version: "3.6.0",
    }),
  ).toThrow(/found 2/);
});

test("rejects reruns without one owned commit or after master advances", () => {
  expect(() =>
    selectOwnedRerunCommit({ ownedCommits: [], runId: "100" }),
  ).toThrow(/no unique version commit/);
  expect(() =>
    selectOwnedRerunCommit({
      ownedCommits: ["a".repeat(40), "b".repeat(40)],
      runId: "100",
    }),
  ).toThrow(/no unique version commit/);
  expect(() =>
    selectOwnedRerunCommit({
      ownedCommits: ["a".repeat(40)],
      ownedVersion: "3.6.0",
      masterVersion: "3.7.0",
      runId: "100",
    }),
  ).toThrow(/cannot publish a newer version/);
  expect(
    selectOwnedRerunCommit({
      ownedCommits: ["a".repeat(40)],
      ownedVersion: "3.6.0",
      masterVersion: "3.6.0",
      runId: "100",
    }),
  ).toBe("a".repeat(40));
});
