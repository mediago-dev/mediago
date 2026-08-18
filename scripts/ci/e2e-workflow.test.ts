import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const workflow = fs.readFileSync(
  path.join(repositoryRoot, ".github/workflows/ci.yml"),
  "utf8",
);

test("defines the bounded three-surface Playwright job contract", () => {
  assertE2EWorkflowContract(workflow);
});

test("requires every worker result in the bounded PR gate contract", () => {
  assertPrGateContract(workflow);
});

test("pins Task before repository commands in the TypeScript test job", () => {
  const testJob = extractJob(workflow, "test-ts");
  expect(testJob).toBeDefined();
  if (testJob === undefined) return;

  const taskSetup = [
    "      - uses: go-task/setup-task@v1",
    "        with:",
    '          version: "3.51.1"',
  ].join("\n");
  expect(testJob.match(/uses: go-task\/setup-task@v1/g) ?? []).toHaveLength(1);
  expect(testJob).toContain(taskSetup);
  expect(testJob.indexOf(taskSetup)).toBeLessThan(
    testJob.indexOf("run: pnpm install --frozen-lockfile"),
  );
  expect(testJob.indexOf(taskSetup)).toBeLessThan(
    testJob.indexOf("run: pnpm test:ts"),
  );
});

test("rejects misplaced failure conditions and unrelated later-job tokens", () => {
  const runStep = extractNamedStep(
    extractJob(workflow, "test-e2e"),
    "Run three-surface Playwright",
  );
  const uploadStep = extractNamedStep(
    extractJob(workflow, "test-e2e"),
    "Upload Playwright failure artifacts",
  );
  expect(runStep).toBeDefined();
  expect(uploadStep).toBeDefined();
  if (runStep === undefined || uploadStep === undefined) return;

  const misplacedFailureCondition = workflow
    .replace(
      runStep,
      runStep.replace("        run:", "        if: failure()\n        run:"),
    )
    .replace(uploadStep, uploadStep.replace("        if: failure()\n", ""));
  expect(() => assertE2EWorkflowContract(misplacedFailureCondition)).toThrow();

  const gateWithoutE2EEnv = workflow.replace(
    "      E2E_RESULT: ${{ needs.test-e2e.result }}\n",
    "",
  );
  const unrelatedLaterJob = `${gateWithoutE2EEnv}\n  unrelated-job:\n    env:\n      E2E_RESULT: \${{ needs.test-e2e.result }}\n`;
  expect(() => assertPrGateContract(unrelatedLaterJob)).toThrow();
});

function assertE2EWorkflowContract(workflowContents: string) {
  const permissions = workflowContents.match(
    /^permissions:\n(?:  [^\n]+\n)*/m,
  )?.[0];
  expect(permissions).toBe("permissions:\n  contents: read\n");

  const e2eJob = extractJob(workflowContents, "test-e2e");
  expect(e2eJob).toBeDefined();
  if (e2eJob === undefined) return;

  expect(e2eJob).toContain("name: Test three-surface Playwright");
  expect(e2eJob).toContain("timeout-minutes: 8");
  expect(e2eJob).toContain("uses: actions/checkout@v7");
  expect(e2eJob).toContain("uses: pnpm/action-setup@v6");
  expect(e2eJob).toContain('version: "10.15.0"');
  expect(e2eJob).toContain("uses: actions/setup-node@v7");
  expect(e2eJob).toContain('node-version: "24.14.0"');
  expect(e2eJob).toContain("uses: actions/setup-go@v7");
  expect(e2eJob).toContain('go-version: "1.25.0"');

  const orderedCommands = [
    "pnpm install --frozen-lockfile",
    "pnpm test:e2e:setup:deps",
    "pnpm exec playwright install-deps chromium",
    "pnpm exec playwright install chromium",
    "pnpm type:check:e2e",
    "pnpm test:e2e:build",
    "xvfb-run -a pnpm test:e2e",
  ];
  let previousIndex = -1;
  for (const command of orderedCommands) {
    const commandIndex = e2eJob.indexOf(command);
    expect(
      commandIndex,
      `${command} must exist and remain ordered`,
    ).toBeGreaterThan(previousIndex);
    previousIndex = commandIndex;
  }

  expect(e2eJob).toContain("GITHUB_TOKEN: ${{ github.token }}");
  expect(e2eJob).not.toContain("secrets.");

  const dependencyCache = extractNamedStep(e2eJob, "Cache E2E dependencies");
  expect(dependencyCache).toContain("uses: actions/cache@v4");
  expect(dependencyCache).toContain("path: .deps");
  expect(dependencyCache).toContain(
    "key: e2e-deps-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/deps-versions.json') }}-${{ hashFiles('scripts/download-deps.ts', 'scripts/download-deps-args.ts', 'scripts/download-deps-integrity.ts') }}",
  );

  const playwrightCache = extractNamedStep(e2eJob, "Cache Playwright browsers");
  expect(playwrightCache).toContain("uses: actions/cache@v4");
  expect(playwrightCache).toContain("path: ~/.cache/ms-playwright");
  expect(playwrightCache).toContain(
    "key: playwright-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('pnpm-lock.yaml') }}",
  );

  const runStep = extractNamedStep(e2eJob, "Run three-surface Playwright");
  expect(runStep).toContain("run: xvfb-run -a pnpm test:e2e");
  expect(runStep).not.toContain("if:");

  const uploadStep = extractNamedStep(
    e2eJob,
    "Upload Playwright failure artifacts",
  );
  expect(uploadStep).toContain("if: failure()");
  expect(uploadStep).toContain("uses: actions/upload-artifact@v4");
  expect(uploadStep).toContain("path: |\n");
  expect(uploadStep).toContain("playwright-report\n");
  expect(uploadStep).toContain("test-results\n");
  expect(uploadStep).toContain("retention-days: 3");
  expect(uploadStep).not.toContain("if: success()");
}

function assertPrGateContract(workflowContents: string) {
  const gateJob = extractJob(workflowContents, "pr-gate");
  expect(gateJob).toBeDefined();
  if (gateJob === undefined) return;

  for (const dependency of [
    "quality",
    "test-ts",
    "test-go",
    "test-media-integration",
    "test-e2e",
  ]) {
    expect(gateJob).toMatch(
      new RegExp(`needs: \\[[^\\n]*\\b${dependency}\\b[^\\n]*\\]`),
    );
  }

  for (const result of [
    "QUALITY_RESULT: ${{ needs.quality.result }}",
    "TYPESCRIPT_RESULT: ${{ needs.test-ts.result }}",
    "GO_RESULT: ${{ needs.test-go.result }}",
    "MEDIA_INTEGRATION_RESULT: ${{ needs.test-media-integration.result }}",
    "E2E_RESULT: ${{ needs.test-e2e.result }}",
  ]) {
    expect(gateJob).toContain(result);
  }

  for (const enumeratedResult of [
    "quality:$QUALITY_RESULT",
    "test-ts:$TYPESCRIPT_RESULT",
    "test-go:$GO_RESULT",
    "media-integration:$MEDIA_INTEGRATION_RESULT",
    "test-e2e:$E2E_RESULT",
  ]) {
    expect(gateJob).toContain(`"${enumeratedResult}"`);
  }
}

function extractJob(
  workflowContents: string,
  jobName: string,
): string | undefined {
  return workflowContents.match(
    new RegExp(
      `^  ${escapeRegExp(jobName)}:\\n[\\s\\S]*?(?=^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`,
      "m",
    ),
  )?.[0];
}

function extractNamedStep(
  job: string | undefined,
  stepName: string,
): string | undefined {
  if (job === undefined) return undefined;
  return job.match(
    new RegExp(
      `^      - name: ${escapeRegExp(stepName)}\\n[\\s\\S]*?(?=^      - (?:name:|run:|uses:)|^  [a-z][\\w-]*:\\n|(?![\\s\\S]))`,
      "m",
    ),
  )?.[0];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
