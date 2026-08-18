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
const forbiddenCiOrchestration = /^(?:pnpm\b|go\s+test\b|xvfb-run\b)/m;
const forbiddenDocsOrchestration = /^pnpm\b/m;

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

  it("rejects direct high-level repository orchestration", () => {
    expectNoDirectOrchestration(workflow, forbiddenCiOrchestration);
    expect(() =>
      expectNoDirectOrchestration(
        workflowWithRunCommand("pnpm lint"),
        forbiddenCiOrchestration,
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

  it("rejects direct high-level repository orchestration", () => {
    expectNoDirectOrchestration(workflow, forbiddenDocsOrchestration);
    expect(() =>
      expectNoDirectOrchestration(
        workflowWithRunCommand("pnpm -F @mediago/docs run docs:build"),
        forbiddenDocsOrchestration,
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

function expectNoDirectOrchestration(
  workflow: LoadedWorkflow,
  forbidden: RegExp,
) {
  for (const [jobName, jobValue] of Object.entries(workflow.jobs)) {
    const job = asRecord(jobValue, `job ${jobName}`);
    if (!Array.isArray(job.steps)) continue;
    for (const [index, stepValue] of job.steps.entries()) {
      const step = asRecord(stepValue, `job ${jobName} step ${index + 1}`);
      if (typeof step.run !== "string") continue;
      expect(step.run.trim(), `${jobName} direct orchestration`).not.toMatch(
        forbidden,
      );
    }
  }
}

function workflowWithRunCommand(command: string): LoadedWorkflow {
  return { jobs: { probe: { steps: [{ run: command }] } } };
}
