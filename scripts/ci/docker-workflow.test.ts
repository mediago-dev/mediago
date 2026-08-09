import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDockerSummary,
  dockerHubCredentialsEnabled,
  resolveDockerParameters,
  resolveImageTargets,
  validateDockerWorkflowInputs,
  verifyPreviewPackagePrivate,
  type GitHubJsonRequest,
  type GitHubJsonResponse,
} from "./docker-workflow.ts";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("validates versions against the selected Docker release mode and channel", () => {
  for (const input of [
    {
      runMode: "test",
      version: "3.6.0-test.123",
      releaseChannel: "beta",
      sourceSha: SHA,
    },
    {
      runMode: "release",
      version: "3.6.0",
      releaseChannel: "latest",
      sourceSha: "",
    },
    {
      runMode: "release",
      version: "3.6.0-alpha.1",
      releaseChannel: "alpha",
      sourceSha: SHA.toUpperCase(),
    },
  ]) {
    assert.doesNotThrow(() => validateDockerWorkflowInputs(input));
  }

  assert.throws(
    () =>
      validateDockerWorkflowInputs({
        runMode: "release",
        version: "3.6.0-beta.1",
        releaseChannel: "latest",
        sourceSha: SHA,
      }),
    /latest version must look like 3\.6\.0/,
  );
  assert.throws(
    () =>
      validateDockerWorkflowInputs({
        runMode: "test",
        version: "3.6.0",
        releaseChannel: "beta",
        sourceSha: "short",
      }),
    /source_sha must be a full 40-character commit SHA/,
  );
});

test("resolves isolated test and versioned release image parameters", () => {
  assert.deepEqual(
    resolveDockerParameters({
      runMode: "test",
      version: "3.6.0-test.123",
      releaseChannel: "beta",
      sourceSha: SHA.toUpperCase(),
      repositoryOwner: "MediaGo-Dev",
      runId: "98765",
      resolvedSha: SHA,
      currentVersion: "3.5.0",
      dockerHubImage: "caorushizi/mediago",
    }),
    {
      image: "ghcr.io/mediago-dev/mediago-preview",
      tag: "test-98765-0123456789ab",
      imageRef: "ghcr.io/mediago-dev/mediago-preview:test-98765-0123456789ab",
      sourceSha: SHA,
      dockerHubImage: "docker.io/caorushizi/mediago",
    },
  );

  const release = resolveDockerParameters({
    runMode: "release",
    version: "3.6.0-beta.1",
    releaseChannel: "beta",
    sourceSha: SHA,
    repositoryOwner: "mediago-dev",
    runId: "98765",
    resolvedSha: SHA,
    currentVersion: "3.6.0-beta.1",
    dockerHubImage: "caorushizi/mediago",
  });
  assert.equal(release.image, "ghcr.io/mediago-dev/mediago");
  assert.equal(release.tag, "3.6.0-beta.1");

  assert.throws(
    () =>
      resolveDockerParameters({
        runMode: "release",
        version: "3.6.0",
        releaseChannel: "latest",
        sourceSha: SHA,
        repositoryOwner: "mediago-dev",
        runId: "98765",
        resolvedSha: SHA,
        currentVersion: "3.5.0",
        dockerHubImage: "caorushizi/mediago",
      }),
    /contains '3\.5\.0', but release version '3\.6\.0' was requested/,
  );
});

test("enables Docker Hub only when both credentials are present", () => {
  assert.equal(dockerHubCredentialsEnabled("user", "token"), true);
  assert.equal(dockerHubCredentialsEnabled("user", ""), false);
  assert.equal(dockerHubCredentialsEnabled("", "token"), false);
  assert.deepEqual(
    resolveImageTargets(
      "ghcr.io/mediago-dev/mediago",
      true,
      "docker.io/caorushizi/mediago",
    ),
    ["ghcr.io/mediago-dev/mediago", "docker.io/caorushizi/mediago"],
  );
  assert.deepEqual(
    resolveImageTargets(
      "ghcr.io/mediago-dev/mediago-preview",
      false,
      "docker.io/caorushizi/mediago",
    ),
    ["ghcr.io/mediago-dev/mediago-preview"],
  );
});

test("accepts only a private or explicitly missing preview package", async () => {
  const requestedPaths: string[] = [];
  const privateRequest: GitHubJsonRequest = async (path) => {
    requestedPaths.push(path);
    return path.startsWith("/users/")
      ? response(200, { type: "Organization" })
      : response(200, { visibility: "private" });
  };
  assert.equal(
    await verifyPreviewPackagePrivate("mediago-dev", privateRequest),
    "private",
  );
  assert.deepEqual(requestedPaths, [
    "/users/mediago-dev",
    "/orgs/mediago-dev/packages/container/mediago-preview",
  ]);

  const missingRequest: GitHubJsonRequest = async (path) =>
    path.includes("/packages/")
      ? response(404, { message: "Not Found" })
      : response(200, { type: "User" });
  assert.equal(
    await verifyPreviewPackagePrivate("caorushizi", missingRequest),
    "missing",
  );

  const publicRequest: GitHubJsonRequest = async (path) =>
    path.startsWith("/users/")
      ? response(200, { type: "Organization" })
      : response(200, { visibility: "public" });
  await assert.rejects(
    verifyPreviewPackagePrivate("mediago-dev", publicRequest),
    /not private/,
  );

  const forbiddenRequest: GitHubJsonRequest = async (path) =>
    path.startsWith("/users/")
      ? response(200, { type: "Organization" })
      : response(403, { message: "Forbidden" });
  await assert.rejects(
    verifyPreviewPackagePrivate("mediago-dev", forbiddenRequest),
    /HTTP 403/,
  );
});

test("renders the Docker job summary including all published tags", () => {
  const summary = buildDockerSummary({
    runMode: "test",
    releaseChannel: "beta",
    version: "3.6.0-test.123",
    sourceSha: SHA,
    digest: "sha256:abc",
    tags: ["ghcr.io/mediago-dev/mediago-preview:test-1-0123456789ab", ""],
    imageRef: "ghcr.io/mediago-dev/mediago-preview:test-1-0123456789ab",
  });
  assert.match(summary, /Docker image published/);
  assert.match(summary, /sha256:abc/);
  assert.match(summary, /mediago-preview:test-1-0123456789ab/);
  assert.match(summary, /Keep the `mediago-preview` GHCR package private/);
});

function response(status: number, data: unknown): GitHubJsonResponse {
  return { status, data, text: JSON.stringify(data) };
}
