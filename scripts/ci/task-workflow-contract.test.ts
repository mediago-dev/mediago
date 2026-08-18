import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { asRecord } from "../taskfile-test-helpers.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const ciRunAllowlist = {
  quality: [{ run: "task ci:quality" }],
  "test-ts": [{ run: "task ci:test:ts" }],
  "test-go": [{ run: "task ci:test:go" }],
  "test-media-integration": [
    {
      name: "Run media integration tests",
      run: "task ci:test:media",
      env: { GITHUB_TOKEN: "${{ github.token }}" },
    },
  ],
  "test-e2e": [
    {
      name: "Run three-surface Playwright",
      run: "task ci:test:e2e",
      env: { GITHUB_TOKEN: "${{ github.token }}" },
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
  build: [
    { name: "Build with Vitepress", run: "task ci:docs:build" },
    {
      name: "Install Alibaba Cloud ossutil",
      run: "wget http://gosspublic.alicdn.com/ossutil/1.6.10/ossutil64 && chmod +x ossutil64",
    },
    {
      name: "Configure Alibaba Cloud ossutil",
      run: "./ossutil64 config -i ${ACCESS_KEY} -k ${ACCESS_KEY_SECRET} -e ${ENDPOINT} -c .ossutilconfig",
    },
    {
      name: "Upload the web folder to the chosen OSS bucket",
      run: "./ossutil64 --config-file .ossutilconfig cp ${{ github.workspace }}/docs/.vitepress/dist oss://${BUCKET} -r -f",
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

  it("routes the documentation build through its exact public Task entry", () => {
    expectTaskEntries(workflow, { build: "task ci:docs:build" });
  });

  it("allows only the docs Task and exact OSS platform run steps", () => {
    expectRunStepAllowlist(workflow, docsRunAllowlist);
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

interface LoadedWorkflow {
  jobs: Record<string, unknown>;
}

function loadWorkflow(basename: string): LoadedWorkflow {
  const source = fs.readFileSync(
    path.join(repositoryRoot, ".github/workflows", basename),
    "utf8",
  );
  const workflow = asRecord(parse(source), basename);
  return {
    jobs: asRecord(workflow.jobs, `${basename} jobs`),
  };
}

function expectTaskEntries(
  workflow: LoadedWorkflow,
  entries: Record<string, string>,
) {
  for (const [jobName, expectedCommand] of Object.entries(entries)) {
    const job = asRecord(workflow.jobs[jobName], `job ${jobName}`);
    if (!Array.isArray(job.steps)) {
      throw new Error(`job ${jobName} steps must be an array`);
    }
    const steps = job.steps.map((step, index) =>
      asRecord(step, `job ${jobName} step ${index + 1}`),
    );
    const taskSetupIndexes = steps.flatMap((step, index) =>
      step.uses === "go-task/setup-task@v1" ? [index] : [],
    );
    const checkoutIndex = steps.findIndex(
      (step) =>
        step.uses === "actions/checkout@v7" ||
        step.uses === "actions/checkout@v6",
    );
    const taskCommandIndexes = steps.flatMap((step, index) =>
      step.run === expectedCommand ? [index] : [],
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

    expect(taskCommandIndexes, `${jobName} public Task entry`).toHaveLength(1);
    const taskCommandIndex = taskCommandIndexes[0];
    expect(taskCommandIndex).toBeDefined();
    if (taskCommandIndex === undefined) continue;
    expect(taskSetupIndex).toBeLessThan(taskCommandIndex);

    const allTaskCommands = steps
      .map((step) => step.run)
      .filter(
        (command): command is string =>
          typeof command === "string" && /^task\s/.test(command),
      );
    expect(allTaskCommands, `${jobName} exact Task command`).toEqual([
      expectedCommand,
    ]);
  }
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
