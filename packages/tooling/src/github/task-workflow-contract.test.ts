import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { asRecord } from "../contracts/taskfile-test-helpers.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const ciRunAllowlist = {
  quality: [{ run: "task ci:quality" }, { run: "pnpm security:js" }],
  "test-ts": [{ run: "task ci:test:ts" }],
  "test-go": [
    { run: "task ci:test:go" },
    {
      name: "Install official Go vulnerability scanner",
      run: "go install golang.org/x/vuln/cmd/govulncheck@v1.9.0",
    },
    {
      name: "Check affected backend function calls",
      "working-directory": "apps/core",
      run: "govulncheck ./...",
      env: { CGO_ENABLED: "0" },
    },
  ],
  "test-media-integration": [
    {
      name: "Run media integration tests",
      run: "task ci:test:media",
      env: { GITHUB_TOKEN: "${{ github.token }}" },
    },
  ],
  "test-e2e": [
    {
      name: "Run Playwright project",
      run: "task ci:test:e2e",
      env: {
        MEDIAGO_E2E_PROJECT: "${{ matrix.project }}",
        GITHUB_TOKEN: "${{ github.token }}",
      },
    },
  ],
  "pr-gate": [
    {
      run: [
        "failed=0",
        "for result in \\",
        '  "quality:$QUALITY_RESULT" \\',
        '  "test-ts:$TYPESCRIPT_RESULT" \\',
        '  "test-go:$GO_RESULT" \\',
        '  "media-integration:$MEDIA_INTEGRATION_RESULT" \\',
        '  "test-e2e:$E2E_RESULT"',
        "do",
        '  job="${result%%:*}"',
        '  status="${result#*:}"',
        '  if [ "$status" != "success" ]; then',
        '    echo "$job result: $status"',
        "    failed=1",
        "  fi",
        "done",
        'exit "$failed"',
        "",
      ].join("\n"),
    },
  ],
} as const;
const docsRunAllowlist = {
  build: [{ name: "Build with Vitepress", run: "task ci:docs:build" }],
} as const;
const desktopRunAllowlist = {
  prepare: [
    {
      name: "Validate inputs",
      env: {
        REQUESTED_RUN_MODE: "${{ inputs.run_mode }}",
        REQUESTED_VERSION: "${{ inputs.version }}",
        REQUESTED_CHANNEL: "${{ inputs.release_channel }}",
        REQUESTED_SOURCE_SHA: "${{ inputs.source_sha }}",
        REQUESTED_TEST_RELEASE_ID: "${{ inputs.test_release_id }}",
        REQUESTED_TEST_BUILD_TARGET: "${{ inputs.test_build_target }}",
      },
      run: "task ci:desktop:validate-request",
    },
    {
      name: "Verify source and committed release version",
      id: "verify",
      env: {
        GH_TOKEN: "${{ github.token }}",
        REQUESTED_RUN_MODE: "${{ inputs.run_mode }}",
        REQUESTED_VERSION: "${{ inputs.version }}",
        REQUESTED_CHANNEL: "${{ inputs.release_channel }}",
        REQUESTED_SOURCE_SHA: "${{ inputs.source_sha }}",
        REQUESTED_TEST_RELEASE_ID: "${{ inputs.test_release_id }}",
        REQUESTED_TEST_BUILD_TARGET: "${{ inputs.test_build_target }}",
      },
      run: "task ci:desktop:verify-source",
    },
    {
      name: "Resolve artifact prefix",
      id: "metadata",
      env: {
        REQUESTED_RUN_MODE: "${{ inputs.run_mode }}",
        REQUESTED_VERSION: "${{ inputs.version }}",
        VERIFIED_SOURCE_SHA: "${{ steps.verify.outputs.source_sha }}",
      },
      run: "task ci:desktop:artifact-prefix",
    },
  ],
  build_release: [
    {
      name: "Apply build version",
      env: {
        BUILD_VERSION: "${{ inputs.version }}",
        RUN_MODE: "${{ inputs.run_mode }}",
      },
      run: "task ci:desktop:apply-version",
    },
    {
      name: "Build desktop artifacts",
      run: "task ci:desktop:release",
      env: {
        RUN_MODE: "release",
        APP_TD_APPID:
          "${{ inputs.run_mode == 'release' && secrets.APP_TD_APPID || '' }}",
        CSC_LINK: "${{ runner.os == 'macOS' && secrets.CSC_LINK || '' }}",
        CSC_KEY_PASSWORD:
          "${{ runner.os == 'macOS' && secrets.CSC_KEY_PASSWORD || '' }}",
        APPLE_ID: "${{ runner.os == 'macOS' && secrets.APPLE_ID || '' }}",
        APPLE_APP_SPECIFIC_PASSWORD:
          "${{ runner.os == 'macOS' && secrets.APPLE_APP_SPECIFIC_PASSWORD || '' }}",
        APPLE_TEAM_ID:
          "${{ runner.os == 'macOS' && secrets.APPLE_TEAM_ID || '' }}",
      },
    },
  ],
  build_test: [
    {
      name: "Apply private build version",
      env: { BUILD_VERSION: "${{ inputs.version }}", RUN_MODE: "test" },
      run: "task ci:desktop:apply-version",
    },
    {
      name: "Build private desktop artifacts",
      run: "task ci:desktop:release",
      env: {
        RUN_MODE: "test",
        APP_TD_APPID: "",
        CSC_LINK: "${{ runner.os == 'macOS' && secrets.CSC_LINK || '' }}",
        CSC_KEY_PASSWORD:
          "${{ runner.os == 'macOS' && secrets.CSC_KEY_PASSWORD || '' }}",
        APPLE_ID: "${{ runner.os == 'macOS' && secrets.APPLE_ID || '' }}",
        APPLE_APP_SPECIFIC_PASSWORD:
          "${{ runner.os == 'macOS' && secrets.APPLE_APP_SPECIFIC_PASSWORD || '' }}",
        APPLE_TEAM_ID:
          "${{ runner.os == 'macOS' && secrets.APPLE_TEAM_ID || '' }}",
      },
    },
    {
      name: "Create private staging archive",
      id: "stage",
      env: { DESKTOP_RUNNER: "${{ matrix.runner }}" },
      run: "task ci:desktop:create-test-stage",
    },
    {
      name: "Upload stage directly to private draft",
      env: {
        GH_TOKEN: "${{ github.token }}",
        REPOSITORY: "${{ github.repository }}",
        TEST_RELEASE_ID: "${{ inputs.test_release_id }}",
        STAGE_ARCHIVE: "${{ steps.stage.outputs.archive }}",
        SOURCE_SHA: "${{ needs.prepare.outputs.source_sha }}",
        VERSION: "${{ inputs.version }}",
        BUILD_TARGET: "${{ inputs.test_build_target }}",
      },
      run: "task ci:desktop:upload-test-stage",
    },
  ],
} as const;
const dockerRunAllowlist = {
  docker: [
    {
      name: "Validate inputs",
      env: {
        RUN_MODE: "${{ inputs.run_mode }}",
        VERSION: "${{ inputs.version }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        SOURCE_SHA: "${{ inputs.source_sha }}",
      },
      run: "task ci:docker:validate-inputs",
    },
    {
      name: "Resolve source, version, image, and tag",
      id: "parameters",
      env: {
        RUN_MODE: "${{ inputs.run_mode }}",
        VERSION: "${{ inputs.version }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        SOURCE_SHA: "${{ inputs.source_sha }}",
        REPOSITORY_OWNER: "${{ github.repository_owner }}",
      },
      run: "task ci:docker:resolve-parameters",
    },
    {
      name: "Verify preview package is private",
      if: "inputs.run_mode == 'test'",
      env: {
        GH_TOKEN: "${{ github.token }}",
        OWNER: "${{ github.repository_owner }}",
        GITHUB_API_URL: "${{ github.api_url }}",
      },
      run: "task ci:docker:verify-preview-private",
    },
    {
      name: "Detect Docker Hub credentials for release",
      id: "dockerhub",
      if: "inputs.run_mode == 'release'",
      env: {
        DOCKERHUB_USERNAME: "${{ secrets.DOCKERHUB_USERNAME }}",
        DOCKERHUB_TOKEN: "${{ secrets.DOCKERHUB_TOKEN }}",
      },
      run: "task ci:docker:detect-dockerhub",
    },
    {
      name: "Resolve image targets",
      id: "targets",
      env: {
        PRIMARY_IMAGE: "${{ steps.parameters.outputs.image }}",
        DOCKERHUB_ENABLED: "${{ steps.dockerhub.outputs.enabled || 'false' }}",
        DOCKERHUB_IMAGE: "${{ steps.parameters.outputs.dockerhub_image }}",
      },
      run: "task ci:docker:resolve-targets",
    },
    {
      name: "Build summary",
      env: {
        RUN_MODE: "${{ inputs.run_mode }}",
        VERSION: "${{ inputs.version }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        SOURCE_SHA: "${{ inputs.source_sha }}",
        RESOLVED_SOURCE_SHA: "${{ steps.parameters.outputs.source_sha }}",
        DIGEST: "${{ steps.build.outputs.digest }}",
        PUBLISHED_TAGS: "${{ steps.metadata.outputs.tags }}",
        IMAGE_REF: "${{ steps.parameters.outputs.image_ref }}",
      },
      run: "task ci:docker:write-summary",
    },
  ],
} as const;
const releaseRunAllowlist = {
  prepare: [
    {
      name: "Validate source and targets",
      id: "targets",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        RUN_MODE:
          "${{ inputs.release_channel == 'test' && 'test' || 'release' }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        SELECTED_REF: "${{ github.ref }}",
        SELECTED_SHA: "${{ github.sha }}",
        RUN_ATTEMPT: "${{ github.run_attempt }}",
      },
      run: "task ci:release:validate-request",
    },
    {
      name: "Detect unfinished GitHub Release",
      id: "release_state",
      if: "inputs.release_channel != 'test'",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        RUN_ATTEMPT: "${{ github.run_attempt }}",
        REPOSITORY: "${{ github.repository }}",
      },
      run: "task ci:release:detect-release-state",
    },
    {
      name: "Reserve private test version",
      id: "test_reservation",
      if: "inputs.release_channel == 'test'",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        VERSION_INCREMENT: "${{ inputs.version_increment }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        SELECTED_SHA: "${{ github.sha }}",
        REPOSITORY: "${{ github.repository }}",
      },
      run: "task ci:release:reserve-test-version",
    },
    {
      name: "Calculate version",
      id: "version",
      if: "inputs.release_channel != 'test'",
      shell: "bash",
      env: {
        RUN_MODE: "release",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        VERSION_INCREMENT: "${{ inputs.version_increment }}",
        RESUME_CURRENT: "${{ steps.release_state.outputs.resume || 'false' }}",
      },
      run: "task ci:release:calculate-version",
    },
    {
      name: "Commit official version",
      if: "inputs.release_channel != 'test' && steps.version.outputs.written == 'true'",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        VERSION: "${{ steps.version.outputs.version }}",
        VERSION_FILE: "${{ steps.version.outputs.version_file }}",
      },
      run: "task ci:release:commit-version",
    },
    {
      name: "Resolve build commit",
      id: "source",
      if: "inputs.release_channel != 'test'",
      shell: "bash",
      env: {
        RUN_MODE: "release",
        BUILD_TARGET: "${{ inputs.build_target }}",
        VERSION: "${{ steps.version.outputs.version }}",
        VERSION_FILE: "${{ steps.version.outputs.version_file }}",
        PENDING: "${{ steps.version.outputs.pending }}",
        RESUME_DRAFT: "${{ steps.release_state.outputs.resume }}",
        DRAFT_TARGET: "${{ steps.release_state.outputs.target_commitish }}",
        RUN_ATTEMPT: "${{ github.run_attempt }}",
      },
      run: "task ci:release:resolve-source",
    },
    {
      name: "Version summary",
      shell: "bash",
      env: {
        RUN_MODE:
          "${{ inputs.release_channel == 'test' && 'test' || 'release' }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        VERSION:
          "${{ steps.test_reservation.outputs.version || steps.version.outputs.version }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        SOURCE_SHA:
          "${{ steps.test_reservation.outputs.source_sha || steps.source.outputs.source_sha }}",
        PENDING:
          "${{ steps.test_reservation.outputs.pending || steps.version.outputs.pending }}",
      },
      run: "task ci:release:write-prepare-summary",
    },
  ],
  publish_desktop: [
    {
      name: "Download private test stages",
      id: "test_stages",
      if: "inputs.release_channel == 'test'",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        REPOSITORY: "${{ github.repository }}",
        TEST_RELEASE_ID: "${{ needs.prepare.outputs.release_id }}",
        VERSION: "${{ needs.prepare.outputs.version }}",
        SOURCE_SHA: "${{ needs.prepare.outputs.source_sha }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
      },
      run: "task ci:release:download-test-stages",
    },
    {
      name: "Collect and validate release files",
      if: "inputs.release_channel != 'test' || steps.test_stages.outputs.complete != 'true'",
      env: {
        VERSION: "${{ needs.prepare.outputs.version }}",
        UPDATER_CHANNEL: "${{ inputs.release_channel }}",
      },
      run: "task ci:release:collect-electron-artifacts",
    },
    {
      name: "Create or update GitHub Release",
      id: "release",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        RUN_MODE:
          "${{ inputs.release_channel == 'test' && 'test' || 'release' }}",
        RELEASE_CHANNEL: "${{ inputs.release_channel }}",
        VERSION: "${{ needs.prepare.outputs.version }}",
        OFFICIAL_TAG: "${{ needs.prepare.outputs.tag }}",
        REPOSITORY: "${{ github.repository }}",
        SOURCE_SHA: "${{ needs.prepare.outputs.source_sha }}",
        SERVER_URL: "${{ github.server_url }}",
        TEST_RELEASE_ID: "${{ needs.prepare.outputs.release_id }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
      },
      run: "task ci:release:publish-desktop",
    },
    {
      name: "Release summary",
      shell: "bash",
      env: {
        RUN_MODE:
          "${{ inputs.release_channel == 'test' && 'test' || 'release' }}",
        VERSION: "${{ needs.prepare.outputs.version }}",
        TAG: "${{ steps.release.outputs.tag }}",
        URL: "${{ steps.release.outputs.url }}",
      },
      run: "task ci:release:write-desktop-summary",
    },
  ],
  tag_docker_release: [
    {
      name: "Create version tag",
      shell: "bash",
      env: {
        GH_TOKEN: "${{ github.token }}",
        TAG: "${{ needs.prepare.outputs.tag }}",
        VERSION: "${{ needs.prepare.outputs.version }}",
        SOURCE_SHA: "${{ needs.prepare.outputs.source_sha }}",
      },
      run: "task ci:release:tag-docker-release",
    },
  ],
  record_test_docker: [
    {
      name: "Update private reservation",
      env: {
        GH_TOKEN: "${{ github.token }}",
        REPOSITORY: "${{ github.repository }}",
        TEST_RELEASE_ID: "${{ needs.prepare.outputs.release_id }}",
        VERSION: "${{ needs.prepare.outputs.version }}",
        SOURCE_SHA: "${{ needs.prepare.outputs.source_sha }}",
        BUILD_TARGET: "${{ inputs.build_target }}",
        IMAGE_REF: "${{ needs.docker.outputs.image_ref }}",
        DIGEST: "${{ needs.docker.outputs.digest }}",
      },
      run: "task ci:release:record-test-docker",
    },
  ],
} as const;

describe("ci.yml Task workflow contract", () => {
  const workflow = loadWorkflow("ci.yml");

  it("routes every repository command job through its exact public Task entry", () => {
    expectTaskEntries(workflow, {
      quality: "task ci:quality",
      "test-ts": "task ci:test:ts",
      "test-go": "task ci:test:go",
      "test-media-integration": "task ci:test:media",
      "test-e2e": "task ci:test:e2e",
    });
  });

  it("allows only the exact run steps assigned to each job", () => {
    expectRunStepAllowlist(workflow, ciRunAllowlist);
  });

  it.each([
    [
      "an indented multiline command",
      "quality",
      "task ci:quality",
      "echo prelude\n  pnpm lint",
    ],
    ["an environment prefix", "quality", "task ci:quality", "env pnpm lint"],
    [
      "a directory-changing shell",
      "test-go",
      "task ci:test:go",
      "cd apps/core && go test ./...",
    ],
  ])("rejects %s", (_description, jobName, expectedCommand, replacement) => {
    expect(() =>
      expectRunStepAllowlist(
        workflowWithReplacedRun(
          workflow,
          jobName,
          expectedCommand,
          replacement,
        ),
        ciRunAllowlist,
      ),
    ).toThrow();
  });

  it("rejects an extra command beside the exact Task entry", () => {
    expect(() =>
      expectRunStepAllowlist(
        workflowWithAdditionalRun(workflow, "quality", "env pnpm lint"),
        ciRunAllowlist,
      ),
    ).toThrow();
  });

  it("keeps the Go-only job free of Node and pnpm setup actions", () => {
    const goJob = JSON.stringify(workflow.jobs["test-go"]);
    expect(goJob).not.toContain("actions/setup-node");
    expect(goJob).not.toContain("pnpm/action-setup");
  });
});

describe("build-docs.yml Task workflow contract", () => {
  const workflow = loadWorkflow("build-docs.yml");

  it("runs only when manually dispatched", () => {
    expect(workflow.definition.on).toEqual({ workflow_dispatch: null });
  });

  it("routes the documentation build through its exact public Task entry", () => {
    expectTaskEntries(workflow, { build: "task ci:docs:build" });
  });

  it("allows only the docs Task run step", () => {
    expectRunStepAllowlist(workflow, docsRunAllowlist);
  });

  it("publishes the VitePress artifact through GitHub Pages", () => {
    const build = asRecord(workflow.jobs.build, "docs build job");
    const deploy = asRecord(workflow.jobs.deploy, "docs deploy job");

    expect(build.steps).toContainEqual({
      name: "Configure GitHub Pages",
      uses: "actions/configure-pages@v5",
    });
    expect(build.steps).toContainEqual({
      name: "Upload GitHub Pages artifact",
      uses: "actions/upload-pages-artifact@v5",
      with: { path: "docs/.vitepress/dist" },
    });
    expect(deploy.steps).toContainEqual({
      name: "Deploy to GitHub Pages",
      id: "deployment",
      uses: "actions/deploy-pages@v4",
    });
    expect(deploy.needs).toBe("build");
    expect(deploy.environment).toEqual({
      name: "github-pages",
      url: "${{ steps.deployment.outputs.page_url }}",
    });

    const permissions = asRecord(
      workflow.definition.permissions,
      "docs workflow permissions",
    );
    expect(permissions).toEqual({
      contents: "read",
      pages: "write",
      "id-token": "write",
    });
    expect(workflow.definition.env).toEqual({ DOCS_BASE: "/" });
    expect(JSON.stringify(workflow.definition)).not.toContain("ossutil");
    expect(JSON.stringify(workflow.definition)).not.toContain("ACCESS_KEY");
  });

  it("rejects wrapped repository commands beside the docs Task entry", () => {
    expect(() =>
      expectRunStepAllowlist(
        workflowWithReplacedRun(
          workflow,
          "build",
          "task ci:docs:build",
          "task ci:docs:build\nenv pnpm lint",
        ),
        docsRunAllowlist,
      ),
    ).toThrow();
  });
});

describe("build-electron.yml Task workflow contract", () => {
  const workflow = loadWorkflow("build-electron.yml");

  it("declares the standard macOS signing and notarization secrets", () => {
    const workflowCall = asRecord(
      asRecord(workflow.definition.on, "build-electron on").workflow_call,
      "build-electron workflow_call",
    );
    const secrets = asRecord(
      workflowCall.secrets,
      "build-electron workflow_call secrets",
    );
    expect(secrets).toMatchObject({
      CSC_LINK: { required: true },
      CSC_KEY_PASSWORD: { required: true },
      APPLE_ID: { required: true },
      APPLE_APP_SPECIFIC_PASSWORD: { required: true },
      APPLE_TEAM_ID: { required: true },
    });
  });

  it("keeps private test stages out of GitHub Actions artifacts", () => {
    const official = asRecord(
      workflow.jobs.build_release,
      "official desktop build",
    );
    const testBuild = asRecord(
      workflow.jobs.build_test,
      "private desktop build",
    );
    expect(JSON.stringify(official.steps)).toContain(
      "actions/upload-artifact@v7",
    );
    expect(JSON.stringify(testBuild.steps)).not.toContain(
      "actions/upload-artifact",
    );
    expect(JSON.stringify(testBuild.steps)).toContain(
      "task ci:desktop:upload-test-stage",
    );
    expect(asRecord(testBuild.permissions, "test permissions").contents).toBe(
      "write",
    );
  });

  it("routes desktop metadata and the install/download/release sequence through exact public Tasks", () => {
    expectTaskEntries(workflow, {
      prepare: [
        "task ci:desktop:validate-request",
        "task ci:desktop:verify-source",
        "task ci:desktop:artifact-prefix",
      ],
      build_release: [
        "task ci:desktop:apply-version",
        "task ci:desktop:release",
      ],
      build_test: [
        "task ci:desktop:apply-version",
        "task ci:desktop:release",
        "task ci:desktop:create-test-stage",
        "task ci:desktop:upload-test-stage",
      ],
    });
  });

  it("allows only the exact desktop Task run steps", () => {
    expectRunStepAllowlist(workflow, desktopRunAllowlist);
  });

  it("rejects wrapped or additional desktop orchestration", () => {
    expectRejectedRunMutations(
      workflow,
      desktopRunAllowlist,
      "build_release",
      "task ci:desktop:release",
    );
  });
});

describe("build-server.yml Task workflow contract", () => {
  const workflow = loadWorkflow("build-server.yml");

  it("routes all Docker metadata through exact public Tasks", () => {
    expectTaskEntries(workflow, {
      docker: [
        "task ci:docker:validate-inputs",
        "task ci:docker:resolve-parameters",
        "task ci:docker:verify-preview-private",
        "task ci:docker:detect-dockerhub",
        "task ci:docker:resolve-targets",
        "task ci:docker:write-summary",
      ],
    });
  });

  it("allows only the exact Docker Task run steps", () => {
    expectRunStepAllowlist(workflow, dockerRunAllowlist);
  });

  it("rejects wrapped or additional Docker orchestration", () => {
    expectRejectedRunMutations(
      workflow,
      dockerRunAllowlist,
      "docker",
      "task ci:docker:validate-inputs",
    );
  });
});

describe("release.yml Task workflow contract", () => {
  const workflow = loadWorkflow("release.yml");

  it("exposes one channel input with exactly test, beta, and latest", () => {
    const workflowDispatch = asRecord(
      asRecord(workflow.definition.on, "release on").workflow_dispatch,
      "release workflow_dispatch",
    );
    const inputs = asRecord(workflowDispatch.inputs, "release inputs");
    expect(inputs).not.toHaveProperty("run_mode");
    expect(
      asRecord(inputs.release_channel, "release_channel").options,
    ).toStrictEqual(["test", "beta", "latest"]);
    expect(asRecord(inputs.release_channel, "release_channel").default).toBe(
      "test",
    );
  });

  it("passes the standard macOS signing secrets to desktop builds", () => {
    const desktop = asRecord(workflow.jobs.desktop, "release desktop job");
    expect(asRecord(desktop.secrets, "release desktop secrets")).toMatchObject({
      CSC_LINK: "${{ secrets.CSC_LINK }}",
      CSC_KEY_PASSWORD: "${{ secrets.CSC_KEY_PASSWORD }}",
      APPLE_ID: "${{ secrets.APPLE_ID }}",
      APPLE_APP_SPECIFIC_PASSWORD: "${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}",
      APPLE_TEAM_ID: "${{ secrets.APPLE_TEAM_ID }}",
    });
  });

  it("routes all release and artifact commands through exact public Tasks", () => {
    expectTaskEntries(workflow, {
      prepare: [
        "task ci:release:validate-request",
        "task ci:release:detect-release-state",
        "task ci:release:reserve-test-version",
        "task ci:release:calculate-version",
        "task ci:release:commit-version",
        "task ci:release:resolve-source",
        "task ci:release:write-prepare-summary",
      ],
      publish_desktop: [
        "task ci:release:download-test-stages",
        "task ci:release:collect-electron-artifacts",
        "task ci:release:publish-desktop",
        "task ci:release:write-desktop-summary",
      ],
      tag_docker_release: ["task ci:release:tag-docker-release"],
      record_test_docker: ["task ci:release:record-test-docker"],
    });
  });

  it("allows only the exact release Task run steps", () => {
    expectRunStepAllowlist(workflow, releaseRunAllowlist);
  });

  it("rejects wrapped or additional release orchestration", () => {
    expectRejectedRunMutations(
      workflow,
      releaseRunAllowlist,
      "prepare",
      "task ci:release:validate-request",
    );
  });
});

interface LoadedWorkflow {
  definition: Record<string, unknown>;
  jobs: Record<string, unknown>;
}

function loadWorkflow(basename: string): LoadedWorkflow {
  const source = fs.readFileSync(
    path.join(repositoryRoot, ".github/workflows", basename),
    "utf8",
  );
  const workflow = asRecord(parse(source), basename);
  return {
    definition: workflow,
    jobs: asRecord(workflow.jobs, `${basename} jobs`),
  };
}

function expectTaskEntries(
  workflow: LoadedWorkflow,
  entries: Record<string, string | readonly string[]>,
) {
  for (const [jobName, expectedEntry] of Object.entries(entries)) {
    const expectedCommands =
      typeof expectedEntry === "string" ? [expectedEntry] : expectedEntry;
    const job = asRecord(workflow.jobs[jobName], `job ${jobName}`);
    if (!Array.isArray(job.steps)) {
      throw new Error(`job ${jobName} steps must be an array`);
    }
    const steps = job.steps.map((step, index) =>
      asRecord(step, `job ${jobName} step ${index + 1}`),
    );
    const taskSetupIndexes = steps.flatMap((step, index) =>
      step.uses === "go-task/setup-task@v2" ? [index] : [],
    );
    const checkoutIndex = steps.findIndex(
      (step) =>
        step.uses === "actions/checkout@v7" ||
        step.uses === "actions/checkout@v6",
    );
    expect(taskSetupIndexes, `${jobName} pinned Task setup`).toHaveLength(1);
    const taskSetupIndex = taskSetupIndexes[0];
    expect(taskSetupIndex).toBeDefined();
    if (taskSetupIndex === undefined) continue;
    expect(checkoutIndex, `${jobName} checkout`).toBeGreaterThanOrEqual(0);
    expect(taskSetupIndex, `${jobName} installs Task after checkout`).toBe(
      checkoutIndex + 1,
    );
    expect(
      asRecord(steps[taskSetupIndex]?.with, `${jobName} Task setup with`)
        .version,
    ).toBe("3.51.1");

    for (const expectedCommand of expectedCommands) {
      const taskCommandIndexes = steps.flatMap((step, index) =>
        step.run === expectedCommand ? [index] : [],
      );
      expect(
        taskCommandIndexes,
        `${jobName} public Task entry ${expectedCommand}`,
      ).toHaveLength(1);
      const taskCommandIndex = taskCommandIndexes[0];
      expect(taskCommandIndex).toBeDefined();
      if (taskCommandIndex === undefined) continue;
      expect(taskSetupIndex).toBeLessThan(taskCommandIndex);
    }

    const allTaskCommands = steps
      .map((step) => step.run)
      .filter(
        (command): command is string =>
          typeof command === "string" && /^task\s/.test(command),
      );
    expect(allTaskCommands, `${jobName} exact Task commands`).toEqual(
      expectedCommands,
    );
  }
}

function expectRejectedRunMutations(
  workflow: LoadedWorkflow,
  allowlist: Readonly<Record<string, readonly Record<string, unknown>[]>>,
  jobName: string,
  expectedCommand: string,
) {
  for (const replacement of [
    `${expectedCommand}\nenv pnpm lint`,
    `env ${expectedCommand}`,
    `cd apps/core && ${expectedCommand}`,
  ]) {
    expect(() =>
      expectRunStepAllowlist(
        workflowWithReplacedRun(
          workflow,
          jobName,
          expectedCommand,
          replacement,
        ),
        allowlist,
      ),
    ).toThrow();
  }
  expect(() =>
    expectRunStepAllowlist(
      workflowWithAdditionalRun(workflow, jobName, "env pnpm lint"),
      allowlist,
    ),
  ).toThrow();
}

function expectRunStepAllowlist(
  workflow: LoadedWorkflow,
  allowlist: Readonly<Record<string, readonly Record<string, unknown>[]>>,
) {
  const actual: Record<string, Record<string, unknown>[]> = {};
  for (const [jobName, jobValue] of Object.entries(workflow.jobs)) {
    const job = asRecord(jobValue, `job ${jobName}`);
    if (!Array.isArray(job.steps)) continue;
    const runSteps: Record<string, unknown>[] = [];
    for (const [index, stepValue] of job.steps.entries()) {
      const step = asRecord(stepValue, `job ${jobName} step ${index + 1}`);
      if (typeof step.run !== "string") continue;
      runSteps.push(step);
    }
    if (runSteps.length > 0) actual[jobName] = runSteps;
  }
  expect(actual).toEqual(allowlist);
}

function workflowWithAdditionalRun(
  workflow: LoadedWorkflow,
  jobName: string,
  command: string,
): LoadedWorkflow {
  const mutated = structuredClone(workflow);
  const job = asRecord(mutated.jobs[jobName], `job ${jobName}`);
  if (!Array.isArray(job.steps)) {
    throw new Error(`job ${jobName} steps must be an array`);
  }
  job.steps.push({ run: command });
  return mutated;
}

function workflowWithReplacedRun(
  workflow: LoadedWorkflow,
  jobName: string,
  expectedCommand: string,
  replacement: string,
): LoadedWorkflow {
  const mutated = structuredClone(workflow);
  const job = asRecord(mutated.jobs[jobName], `job ${jobName}`);
  if (!Array.isArray(job.steps)) {
    throw new Error(`job ${jobName} steps must be an array`);
  }
  const runStep = job.steps
    .map((step, index) => asRecord(step, `job ${jobName} step ${index + 1}`))
    .find((step) => step.run === expectedCommand);
  if (runStep === undefined) {
    throw new Error(`job ${jobName} must run ${expectedCommand}`);
  }
  runStep.run = replacement;
  return mutated;
}
