import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type DockerRunMode = "test" | "release";
export type DockerReleaseChannel = "alpha" | "beta" | "latest";

export interface DockerWorkflowInputs {
  runMode: string;
  version: string;
  releaseChannel: string;
  sourceSha: string;
}

export interface DockerParameters {
  image: string;
  tag: string;
  imageRef: string;
  sourceSha: string;
  dockerHubImage: string;
}

export interface GitHubJsonResponse {
  status: number;
  data: unknown;
  text: string;
}

export type GitHubJsonRequest = (path: string) => Promise<GitHubJsonResponse>;

interface ResolveDockerParametersInput extends DockerWorkflowInputs {
  repositoryOwner: string;
  runId: string;
  resolvedSha: string;
  currentVersion: string;
  dockerHubImage: string;
}

interface DockerSummaryInput {
  runMode: DockerRunMode;
  releaseChannel: DockerReleaseChannel;
  version: string;
  sourceSha: string;
  digest: string;
  tags: readonly string[];
  imageRef: string;
}

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const PRODUCT_VERSION_FILE = "apps/electron/app/package.json";
const CORE_VERSION_PATTERN =
  "(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)";
const FULL_SHA_PATTERN = /^[0-9a-fA-F]{40}$/;

export function validateDockerWorkflowInputs(
  inputs: DockerWorkflowInputs,
): asserts inputs is DockerWorkflowInputs & {
  runMode: DockerRunMode;
  releaseChannel: DockerReleaseChannel;
} {
  if (inputs.runMode !== "test" && inputs.runMode !== "release") {
    throw new Error(
      `run_mode must be 'test' or 'release' (received '${inputs.runMode}').`,
    );
  }

  if (
    inputs.releaseChannel !== "latest" &&
    inputs.releaseChannel !== "alpha" &&
    inputs.releaseChannel !== "beta"
  ) {
    throw new Error(
      `release_channel must be 'latest', 'alpha', or 'beta' (received '${inputs.releaseChannel}').`,
    );
  }

  if (inputs.sourceSha !== "" && !FULL_SHA_PATTERN.test(inputs.sourceSha)) {
    throw new Error("source_sha must be a full 40-character commit SHA.");
  }

  const escapedCore = CORE_VERSION_PATTERN;
  const versionPattern =
    inputs.runMode === "test"
      ? new RegExp(`^${escapedCore}-test\\.(0|[1-9][0-9]*)$`)
      : inputs.releaseChannel === "latest"
        ? new RegExp(`^${escapedCore}$`)
        : new RegExp(
            `^${escapedCore}-${inputs.releaseChannel}\\.(0|[1-9][0-9]*)$`,
          );

  if (!versionPattern.test(inputs.version)) {
    const example =
      inputs.runMode === "test"
        ? "3.6.0-test.123"
        : inputs.releaseChannel === "latest"
          ? "3.6.0"
          : `3.6.0-${inputs.releaseChannel}.1`;
    throw new Error(
      `A ${inputs.runMode === "test" ? "test" : inputs.releaseChannel} version must look like ${example} (received '${inputs.version}').`,
    );
  }
}

export function resolveDockerParameters(
  input: ResolveDockerParametersInput,
): DockerParameters {
  validateDockerWorkflowInputs(input);

  if (
    input.sourceSha !== "" &&
    input.resolvedSha.toLowerCase() !== input.sourceSha.toLowerCase()
  ) {
    throw new Error(
      `Checked out '${input.resolvedSha}', but source_sha requested '${input.sourceSha}'.`,
    );
  }
  if (!FULL_SHA_PATTERN.test(input.resolvedSha)) {
    throw new Error(
      `git returned an invalid commit SHA: '${input.resolvedSha}'.`,
    );
  }
  if (input.runMode === "release" && input.currentVersion !== input.version) {
    throw new Error(
      `${PRODUCT_VERSION_FILE} contains '${input.currentVersion}', but release version '${input.version}' was requested.`,
    );
  }
  if (
    input.repositoryOwner.length === 0 ||
    /[\r\n/]/.test(input.repositoryOwner)
  ) {
    throw new Error("repository_owner is invalid.");
  }
  if (
    input.dockerHubImage.length === 0 ||
    /[\r\n]/.test(input.dockerHubImage)
  ) {
    throw new Error("dockerhub_image is invalid.");
  }
  if (input.runMode === "test" && !/^[1-9][0-9]*$/.test(input.runId)) {
    throw new Error(
      "GITHUB_RUN_ID must be a positive integer for test builds.",
    );
  }

  const owner = input.repositoryOwner.toLowerCase();
  const image =
    input.runMode === "test"
      ? `ghcr.io/${owner}/mediago-preview`
      : `ghcr.io/${owner}/mediago`;
  const tag =
    input.runMode === "test"
      ? `test-${input.runId}-${input.resolvedSha.slice(0, 12)}`
      : input.version;

  return {
    image,
    tag,
    imageRef: `${image}:${tag}`,
    sourceSha: input.resolvedSha,
    dockerHubImage: `docker.io/${input.dockerHubImage}`,
  };
}

export function dockerHubCredentialsEnabled(
  username: string,
  token: string,
): boolean {
  return username.length > 0 && token.length > 0;
}

export function resolveImageTargets(
  primaryImage: string,
  dockerHubEnabled: boolean,
  dockerHubImage: string,
): string[] {
  for (const image of [primaryImage, dockerHubImage]) {
    if (image.length === 0 || /[\r\n]/.test(image)) {
      throw new Error(`Invalid image target: ${JSON.stringify(image)}.`);
    }
  }
  return dockerHubEnabled ? [primaryImage, dockerHubImage] : [primaryImage];
}

export async function verifyPreviewPackagePrivate(
  owner: string,
  request: GitHubJsonRequest,
): Promise<"private" | "missing"> {
  if (owner.length === 0 || /[\r\n/]/.test(owner)) {
    throw new Error("GitHub repository owner is invalid.");
  }

  const encodedOwner = encodeURIComponent(owner);
  const ownerResponse = await request(`/users/${encodedOwner}`);
  if (ownerResponse.status < 200 || ownerResponse.status >= 300) {
    throw githubApiError(
      "Could not determine the repository owner type",
      ownerResponse,
    );
  }

  const ownerType = readStringProperty(ownerResponse.data, "type");
  const packagePath =
    ownerType === "Organization"
      ? `/orgs/${encodedOwner}/packages/container/mediago-preview`
      : `/users/${encodedOwner}/packages/container/mediago-preview`;
  const packageResponse = await request(packagePath);

  if (packageResponse.status === 404) {
    return "missing";
  }
  if (packageResponse.status < 200 || packageResponse.status >= 300) {
    throw githubApiError(
      "Could not verify the mediago-preview package visibility",
      packageResponse,
    );
  }

  const visibility = readStringProperty(packageResponse.data, "visibility");
  if (visibility !== "private") {
    throw new Error(
      `The mediago-preview package is '${visibility}', not private. Refusing to publish a test image.`,
    );
  }
  return "private";
}

export function buildDockerSummary(input: DockerSummaryInput): string {
  const publishedTags = input.tags
    .filter((tag) => tag.length > 0)
    .map((tag) => `- \`${tag}\``)
    .join("\n");
  const privateReminder =
    input.runMode === "test"
      ? "\n> Keep the `mediago-preview` GHCR package private in its package settings.\n"
      : "";

  return `### Docker image published

- **Mode:** \`${input.runMode}\`
- **Release channel:** \`${input.releaseChannel}\`
- **Application version:** \`${input.version}\`
- **Source commit:** \`${input.sourceSha}\`
- **Digest:** \`${input.digest}\`
- **Platforms:** \`linux/amd64\`, \`linux/arm64\`

**Published tags:**
${publishedTags}

**Pull:** \`docker pull ${input.imageRef}\`
${privateReminder}`;
}

function githubApiError(context: string, response: GitHubJsonResponse): Error {
  const detail = response.text.trim().slice(0, 500);
  return new Error(
    `${context} (HTTP ${response.status})${detail === "" ? "" : `: ${detail}`}`,
  );
}

function readStringProperty(value: unknown, property: string): string {
  if (
    typeof value !== "object" ||
    value === null ||
    !(property in value) ||
    typeof value[property as keyof typeof value] !== "string"
  ) {
    throw new Error(`GitHub API response is missing a string '${property}'.`);
  }
  return value[property as keyof typeof value] as string;
}

function createGitHubRequest(token: string, apiUrl: string): GitHubJsonRequest {
  if (token.length === 0) throw new Error("GH_TOKEN is required.");
  const baseUrl = apiUrl.endsWith("/") ? apiUrl : `${apiUrl}/`;

  return async (path: string): Promise<GitHubJsonResponse> => {
    const url = new URL(path.replace(/^\//, ""), baseUrl);
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "mediago-release-workflow",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    const text = await response.text();
    let data: unknown = null;
    if (text !== "") {
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = null;
      }
    }
    return { status: response.status, data, text };
  };
}

function getWorkflowInputs(): DockerWorkflowInputs {
  return {
    runMode: requiredEnvironment("RUN_MODE"),
    version: requiredEnvironment("VERSION"),
    releaseChannel: requiredEnvironment("RELEASE_CHANNEL"),
    sourceSha: process.env.SOURCE_SHA ?? "",
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function readProductVersion(workspaceRoot: string): string {
  const file = resolve(workspaceRoot, PRODUCT_VERSION_FILE);
  const product = JSON.parse(readFileSync(file, "utf8")) as {
    version?: unknown;
  };
  if (typeof product.version !== "string") {
    throw new Error(
      `${PRODUCT_VERSION_FILE} does not contain a string version.`,
    );
  }
  return product.version;
}

function writeProductVersion(workspaceRoot: string, version: string): void {
  const file = resolve(workspaceRoot, PRODUCT_VERSION_FILE);
  const product = JSON.parse(readFileSync(file, "utf8")) as Record<
    string,
    unknown
  >;
  product.version = version;
  writeFileSync(file, `${JSON.stringify(product, null, 2)}\n`);
}

function writeGitHubOutput(name: string, value: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid GitHub output name: '${name}'.`);
  }
  const outputFile = requiredEnvironment("GITHUB_OUTPUT");
  if (!/[\r\n]/.test(value)) {
    appendFileSync(outputFile, `${name}=${value}\n`);
    return;
  }

  let delimiter = "MEDIAGO_OUTPUT";
  while (value.split(/\r?\n/).includes(delimiter)) delimiter += "_END";
  appendFileSync(outputFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function escapeWorkflowCommand(value: string): string {
  return value
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
}

async function executeCommand(command: string): Promise<void> {
  if (command === "validate-inputs") {
    validateDockerWorkflowInputs(getWorkflowInputs());
    return;
  }

  if (command === "resolve-parameters") {
    const workspaceRoot = process.env.GITHUB_WORKSPACE ?? process.cwd();
    const workflowInputs = getWorkflowInputs();
    const currentVersion = readProductVersion(workspaceRoot);
    const resolvedSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    }).trim();
    const parameters = resolveDockerParameters({
      ...workflowInputs,
      repositoryOwner: requiredEnvironment("REPOSITORY_OWNER"),
      runId: requiredEnvironment("GITHUB_RUN_ID"),
      resolvedSha,
      currentVersion,
      dockerHubImage: requiredEnvironment("DOCKERHUB_IMAGE"),
    });

    if (workflowInputs.runMode === "test") {
      writeProductVersion(workspaceRoot, workflowInputs.version);
      process.stdout.write(
        `Temporarily changed ${PRODUCT_VERSION_FILE} from '${currentVersion}' to '${workflowInputs.version}' for this test build.\n`,
      );
    }
    writeGitHubOutput("image", parameters.image);
    writeGitHubOutput("tag", parameters.tag);
    writeGitHubOutput("image_ref", parameters.imageRef);
    writeGitHubOutput("source_sha", parameters.sourceSha);
    writeGitHubOutput("dockerhub_image", parameters.dockerHubImage);
    return;
  }

  if (command === "verify-preview-private") {
    const result = await verifyPreviewPackagePrivate(
      requiredEnvironment("OWNER"),
      createGitHubRequest(
        requiredEnvironment("GH_TOKEN"),
        requiredEnvironment("GITHUB_API_URL"),
      ),
    );
    if (result === "missing") {
      process.stdout.write(
        "mediago-preview does not exist yet; GHCR creates new container packages as private by default.\n",
      );
    }
    return;
  }

  if (command === "detect-dockerhub") {
    writeGitHubOutput(
      "enabled",
      String(
        dockerHubCredentialsEnabled(
          process.env.DOCKERHUB_USERNAME ?? "",
          process.env.DOCKERHUB_TOKEN ?? "",
        ),
      ),
    );
    return;
  }

  if (command === "resolve-targets") {
    const images = resolveImageTargets(
      requiredEnvironment("PRIMARY_IMAGE"),
      requiredEnvironment("DOCKERHUB_ENABLED") === "true",
      requiredEnvironment("DOCKERHUB_IMAGE"),
    );
    writeGitHubOutput("images", images.join("\n"));
    return;
  }

  if (command === "write-summary") {
    const inputs = getWorkflowInputs();
    validateDockerWorkflowInputs(inputs);
    const summary = buildDockerSummary({
      runMode: inputs.runMode,
      releaseChannel: inputs.releaseChannel,
      version: inputs.version,
      sourceSha: requiredEnvironment("RESOLVED_SOURCE_SHA"),
      digest: requiredEnvironment("DIGEST"),
      tags: requiredEnvironment("PUBLISHED_TAGS").split(/\r?\n/),
      imageRef: requiredEnvironment("IMAGE_REF"),
    });
    appendFileSync(requiredEnvironment("GITHUB_STEP_SUMMARY"), summary);
    return;
  }

  throw new Error(
    `Unknown command '${command}'. Expected validate-inputs, resolve-parameters, verify-preview-private, detect-dockerhub, resolve-targets, or write-summary.`,
  );
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_FILE)) {
  executeCommand(process.argv[2] ?? "").catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`::error::${escapeWorkflowCommand(message)}\n`);
    process.exitCode = 1;
  });
}
