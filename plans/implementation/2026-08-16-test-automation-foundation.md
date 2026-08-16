# Automated Testing Foundation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate every TypeScript test to one root-managed Vitest runner, stabilize the existing ServiceRunner suite, expose reliable root test commands, and add a fast PR quality gate.

**Architecture:** A single root `vitest.config.ts` discovers all TypeScript tests and resolves source aliases without requiring generated workspace artifacts. Go remains on its native test runner. GitHub Actions runs quality, TypeScript, and Go jobs in parallel and publishes one deterministic aggregate result.

**Tech Stack:** pnpm 10.15, Vitest 4.1, `@vitest/coverage-v8`, Go 1.25 testing, GitHub Actions

**Design spec:** `plans/specs/2026-08-16-test-automation-foundation-design.md`

---

## File Map

**Create**

- `vitest.config.ts` — authoritative TypeScript test discovery, source aliases, Node environment, and coverage output.
- `.github/workflows/ci.yml` — parallel PR/default-branch quality and test checks with one aggregate gate.

**Modify**

- `package.json` — root Vitest dependencies and stable test commands.
- `pnpm-lock.yaml` — resolved root test dependencies.
- `.gitignore` — ignore root coverage output.
- `packages/core-sdk/package.json` — align Vitest and delegate the package-local test command to the root config.
- `packages/node-service/package.json` — align Vitest and delegate the package-local test command to the root config.
- `packages/node-service/tests/index.test.ts` — remove stale `portfinder` assumptions and isolate its fixture/port probe.
- The 21 existing `node:test` files listed below — mechanical migration to Vitest assertions and cleanup hooks.

**Do not modify unless a test proves it is necessary**

- Production sources under `apps/**/src` and `packages/**/src`.
- `turbo.json`.
- Package-level lockfiles.
- Release workflows.

## Baseline

- 21 `node:test` files: 94 passing tests under `node --import tsx --test`.
- 2 Core SDK Vitest files: 3 passing tests.
- 1 ServiceRunner Vitest file: 3 failing tests because it mocks removed `portfinder` behavior and uses an unreliable fake-timer sequence.
- 11 Go test files: `go test ./...` passes.
- `pnpm check` passes with existing non-blocking lint warnings.

## Shared Vitest Assertion Mapping

Use these exact mappings throughout Tasks 3–6:

| Existing strict Node assertion           | Vitest replacement                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------- |
| `assert.equal(actual, expected)`         | `expect(actual).toBe(expected)`                                                          |
| `assert.notEqual(actual, expected)`      | `expect(actual).not.toBe(expected)`                                                      |
| `assert.deepEqual(actual, expected)`     | `expect(actual).toStrictEqual(expected)`                                                 |
| `assert.ok(value)`                       | `expect(value).toBeTruthy()` when no narrowing is needed; otherwise use a throwing guard |
| `assert.match(value, pattern)`           | `expect(value).toMatch(pattern)`                                                         |
| `assert.throws(fn, pattern)`             | `expect(fn).toThrow(pattern)`                                                            |
| `assert.doesNotThrow(fn)`                | `expect(fn).not.toThrow()`                                                               |
| `await assert.rejects(promise, pattern)` | `await expect(promise).rejects.toThrow(pattern)`                                         |
| `assert.fail(message)`                   | `throw new Error(message)`                                                               |
| `t.after(cleanup)`                       | `onTestFinished(cleanup)`                                                                |

When a truthiness check is followed by a dereference or function call, preserve TypeScript narrowing with a direct guard:

```ts
if (!value) {
  throw new Error("Expected value to be available");
}
```

Use a message specific to the checked value. When an assertion includes a custom message, preserve the intent in the test name or pass the message as the second argument supported by Vitest `expect`. Do not weaken exact object checks while migrating.

## Chunk 1: Runner Foundation and Application Tests

### Task 1: Stabilize the Existing ServiceRunner Vitest Suite

**Files:**

- Modify: `packages/node-service/tests/index.test.ts`
- Test: `packages/node-service/tests/index.test.ts`

- [ ] **Step 1: Reproduce the three baseline failures**

Run:

```bash
pnpm -F @mediago/service-runner test -- --run
```

Expected: FAIL with three tests. The first two expect ports returned by the removed `portfinder` dependency; the timeout case exceeds Vitest's 5-second limit.

- [ ] **Step 2: Replace the stale portfinder mock with a per-test ServiceRunner port-probe stub**

Remove `mockPortfinder` and its `vi.mock("portfinder", ...)` block. Add `onTestFinished` to the Vitest imports and add this helper after the mocks:

```ts
async function loadServiceRunnerWithAvailablePort() {
  const { ServiceRunner } = await import("../src/index");
  const original = Reflect.get(ServiceRunner, "isPortFree");
  Reflect.set(
    ServiceRunner,
    "isPortFree",
    vi.fn(async () => true),
  );
  onTestFinished(() => {
    Reflect.set(ServiceRunner, "isPortFree", original);
  });
  return ServiceRunner;
}
```

Use this helper in all three tests. This keeps the test isolated without widening the private production API.

- [ ] **Step 3: Give the executable fixture an explicit suite lifecycle**

Import `rm` from `node:fs/promises`. Replace the module-level fixture promise with:

```ts
let executableFixture:
  | Awaited<ReturnType<typeof createExecutableFixture>>
  | undefined;

beforeAll(async () => {
  executableFixture = await createExecutableFixture();
});

afterAll(async () => {
  if (executableFixture) {
    await rm(executableFixture.dir, { recursive: true, force: true });
  }
});
```

Add a `getExecutableFixture()` guard that throws when setup did not complete, and have each test read the fixture through that guard. The fixture is read-only after creation.

- [ ] **Step 4: Align the successful tests with the current ServiceRunner contract**

In the first test, keep `preferredPort: 4_321` and assert `PORT`, state port, and restart port as `4321` and `9000`, not the removed alternate ports `6789` and `9001`.

In the LAN test, add `preferredPort: 5_555` so the expected URL remains `http://10.0.0.42:5555`.

Continue restoring `findLanIPv4Address` in `finally` or `onTestFinished`.

- [ ] **Step 5: Drive the health failure with deterministic virtual time**

Keep fake timers, but replace the private delay for this test so each requested delay advances Vitest's clock from inside the polling loop:

```ts
vi.useFakeTimers();
onTestFinished(() => vi.useRealTimers());

const originalDelay = Reflect.get(ServiceRunner, "delay");
Reflect.set(
  ServiceRunner,
  "delay",
  vi.fn(async (milliseconds: number) => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  }),
);
onTestFinished(() => {
  Reflect.set(ServiceRunner, "delay", originalDelay);
});
```

Configure:

```ts
healthCheckTimeoutMs: 30,
healthCheckIntervalMs: 5,
healthRequestTimeoutMs: 5,
```

Keep the immediate mocked 503 response and assert that `start()` rejects with `/failed health check/i`. Always call `runner.stop().catch(() => undefined)` in `onTestFinished` or `finally`.

- [ ] **Step 6: Run the focused suite**

Run:

```bash
pnpm -F @mediago/service-runner test -- --run
```

Expected: PASS, 1 file and 3 tests.

- [ ] **Step 7: Run package type checking and formatting**

Run:

```bash
pnpm -F @mediago/service-runner typecheck
pnpm exec oxfmt --check packages/node-service/tests/index.test.ts
```

Expected: both commands PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/node-service/tests/index.test.ts
git commit -m "test(node-service): stabilize service runner suite"
```

### Task 2: Add the Authoritative Root Vitest Runner

**Files:**

- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/core-sdk/package.json`
- Modify: `packages/node-service/package.json`

- [ ] **Step 1: Verify the root does not own Vitest yet**

Run:

```bash
pnpm -r why vitest --depth 0
```

Expected: Vitest is reported for `packages/core-sdk` and `packages/node-service`, but the root importer does not list it.

- [ ] **Step 2: Add one aligned root Vitest toolchain**

Run:

```bash
pnpm add -Dw vitest@^4.1.2 @vitest/coverage-v8@^4.1.2
```

Expected: root `package.json` and `pnpm-lock.yaml` change; no package-level lockfile changes.

- [ ] **Step 3: Create the root configuration**

Create `vitest.config.ts` with this structure:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@mediago/shared-common",
        replacement: path.resolve(
          repositoryRoot,
          "packages/shared/common/src/index.ts",
        ),
      },
      {
        find: /^@\//,
        replacement: `${path.resolve(repositoryRoot, "apps/ui/src")}/`,
      },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 10_000,
    hookTimeout: 10_000,
    maxWorkers: 4,
    reporters: ["default"],
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/release/**",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/ts",
      reporter: ["text", "html", "json-summary"],
      include: [
        "apps/**/*.{ts,tsx}",
        "packages/**/*.{ts,tsx}",
        "scripts/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/i18n/resources/**",
        "**/{build,dist,release}/**",
      ],
    },
  },
});
```

The explicit 10-second test/hook limits catch hung work without making normal filesystem tests fragile. The four-worker cap avoids saturating local and CI machines, and the same default reporter is used in both environments. Do not add jsdom, custom pools, setup files, global APIs, or Vitest Projects in this stage.

- [ ] **Step 4: Make package-local test commands delegate to the root config**

Set the scripts to:

```json
// packages/core-sdk/package.json
"test": "pnpm --dir ../.. exec vitest run packages/core-sdk"

// packages/node-service/package.json
"test": "pnpm --dir ../.. exec vitest run packages/node-service"
```

Align both package Vitest version ranges to `^4.1.2`. Do not touch their separate lockfiles.

- [ ] **Step 5: Verify the currently-native Vitest suites through the root config**

Run:

```bash
pnpm -F @mediago/core-sdk test
pnpm -F @mediago/service-runner test
```

Expected: Core SDK passes 2 files/3 tests; ServiceRunner passes 1 file/3 tests. Both commands show the standard Vitest file/test summary, confirming the root reporter applies without a CI-only override.

- [ ] **Step 6: Verify format and type health**

Run:

```bash
pnpm exec oxfmt --check vitest.config.ts package.json packages/core-sdk/package.json packages/node-service/package.json
pnpm check
```

Expected: PASS. Existing lint warnings remain non-blocking; no new errors appear.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts package.json pnpm-lock.yaml packages/core-sdk/package.json packages/node-service/package.json
git commit -m "test: add root vitest runner"
```

### Task 3: Migrate the UI Logic Tests

**Files:**

- Modify: `apps/ui/src/components/download-form-logic.test.ts`
- Modify: `apps/ui/src/components/ui/pagination-logic.test.ts`
- Modify: `apps/ui/src/layout/sidebar-sizing.test.ts`
- Modify: `apps/ui/src/pages/converter-page/converter-page-logic.test.ts`
- Modify: `apps/ui/src/pages/source-extract/components/source-filter.test.ts`
- Modify: `apps/ui/src/services/config-change-order.test.ts`
- Modify: `apps/ui/src/services/config-write-coordinator.test.ts`
- Modify: `apps/ui/src/services/pwa.test.ts`
- Modify: `apps/ui/src/services/share-intent.test.ts`
- Modify: `apps/ui/src/store/browser.test.ts`
- Modify: `apps/ui/src/store/download-progress.test.ts`
- Modify: `apps/ui/src/utils/app-theme.test.ts`

- [ ] **Step 1: Confirm the migration target**

Run:

```bash
rg -l 'node:test|node:assert/strict' apps/ui/src --glob '*.test.ts'
```

Expected: exactly the 12 files listed above.

- [ ] **Step 2: Convert imports and assertions mechanically**

For every listed file:

```ts
import { expect, test } from "vitest";
```

Add `describe`, `beforeEach`, or other Vitest imports only when the file already uses the equivalent API. Apply the shared assertion mapping exactly. For truthiness checks followed by property access or calls, use the explicit throwing guard so TypeScript narrowing remains valid. Preserve all 44 test names and cases.

Keep the zero-delay `nextTask()` helper in `config-write-coordinator.test.ts`; it intentionally yields one event-loop turn and is not an external-state sleep.

- [ ] **Step 3: Run only the UI tests**

Run:

```bash
pnpm exec vitest run apps/ui
```

Expected: PASS, 12 files and 44 tests.

- [ ] **Step 4: Confirm UI tests no longer use the Node runner**

Run:

```bash
if rg -n 'node:test|node:assert/strict' apps/ui/src --glob '*.test.ts'; then exit 1; fi
```

Expected: exit 0 with no matches.

- [ ] **Step 5: Format and commit**

```bash
pnpm exec oxfmt --write \
  apps/ui/src/components/download-form-logic.test.ts \
  apps/ui/src/components/ui/pagination-logic.test.ts \
  apps/ui/src/layout/sidebar-sizing.test.ts \
  apps/ui/src/pages/converter-page/converter-page-logic.test.ts \
  apps/ui/src/pages/source-extract/components/source-filter.test.ts \
  apps/ui/src/services/config-change-order.test.ts \
  apps/ui/src/services/config-write-coordinator.test.ts \
  apps/ui/src/services/pwa.test.ts \
  apps/ui/src/services/share-intent.test.ts \
  apps/ui/src/store/browser.test.ts \
  apps/ui/src/store/download-progress.test.ts \
  apps/ui/src/utils/app-theme.test.ts
pnpm exec vitest run apps/ui
git add \
  apps/ui/src/components/download-form-logic.test.ts \
  apps/ui/src/components/ui/pagination-logic.test.ts \
  apps/ui/src/layout/sidebar-sizing.test.ts \
  apps/ui/src/pages/converter-page/converter-page-logic.test.ts \
  apps/ui/src/pages/source-extract/components/source-filter.test.ts \
  apps/ui/src/services/config-change-order.test.ts \
  apps/ui/src/services/config-write-coordinator.test.ts \
  apps/ui/src/services/pwa.test.ts \
  apps/ui/src/services/share-intent.test.ts \
  apps/ui/src/store/browser.test.ts \
  apps/ui/src/store/download-progress.test.ts \
  apps/ui/src/utils/app-theme.test.ts
git commit -m "test(ui): migrate logic suites to vitest"
```

### Task 4: Migrate Electron and Shared Tests

**Files:**

- Modify: `apps/electron/src/services/share-intent-parser.test.ts`
- Modify: `apps/electron/src/utils/source-inspection.test.ts`
- Modify: `packages/shared/common/src/sniff/source-grouping.test.ts`
- Modify: `packages/shared/common/src/utils/share-intent.test.ts`

- [ ] **Step 1: Confirm the four remaining application/shared Node test files**

Run:

```bash
rg -l 'node:test|node:assert/strict' apps/electron/src packages/shared/common/src --glob '*.test.ts'
```

Expected: exactly the four files listed above.

- [ ] **Step 2: Apply the shared Vitest assertion mapping**

Replace the Node imports with:

```ts
import { expect, test } from "vitest";
```

Preserve the existing enum values, fixtures, test names, and strict object comparisons. For truthiness checks followed by property access or calls, use the explicit throwing guard. There are 12 tests total in this group.

- [ ] **Step 3: Run the focused tests**

Run:

```bash
pnpm exec vitest run apps/electron/src packages/shared/common/src
```

Expected: PASS, 4 files and 12 tests.

- [ ] **Step 4: Format and commit**

```bash
pnpm exec oxfmt --write apps/electron/src/services/share-intent-parser.test.ts apps/electron/src/utils/source-inspection.test.ts packages/shared/common/src/sniff/source-grouping.test.ts packages/shared/common/src/utils/share-intent.test.ts
git add apps/electron/src/services/share-intent-parser.test.ts apps/electron/src/utils/source-inspection.test.ts packages/shared/common/src/sniff/source-grouping.test.ts packages/shared/common/src/utils/share-intent.test.ts
git commit -m "test(shared): migrate cross-runtime suites to vitest"
```

## Chunk 2: Script Tests, Unified Commands, and CI

### Task 5: Migrate CI Workflow Logic Tests

**Files:**

- Modify: `scripts/ci/desktop-workflow.test.ts`
- Modify: `scripts/ci/docker-workflow.test.ts`
- Modify: `scripts/ci/release-workflow.test.ts`

- [ ] **Step 1: Confirm the three workflow test files still use Node test APIs**

Run:

```bash
rg -l 'node:test|node:assert/strict' scripts/ci --glob '*.test.ts'
```

Expected: the three files listed above.

- [ ] **Step 2: Migrate assertions without changing workflow behavior**

Import `expect`, `test`, and `onTestFinished` from `vitest` as needed. Apply the shared mapping.

In `desktop-workflow.test.ts`, remove `TestContext` from `createWorkspace`. Register cleanup inside the helper:

```ts
function createWorkspace(version: string, initializeGit = false): string {
  const root = mkdtempSync(join(tmpdir(), "mediago-desktop-workflow-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  // Existing fixture construction remains unchanged.
  return root;
}
```

Update callers to remove the `t` argument. Do not change the production workflow modules.

- [ ] **Step 3: Run the three files**

Run:

```bash
pnpm exec vitest run scripts/ci
```

Expected: PASS, 3 files and 17 tests.

- [ ] **Step 4: Format and commit**

```bash
pnpm exec oxfmt --write scripts/ci/desktop-workflow.test.ts scripts/ci/docker-workflow.test.ts scripts/ci/release-workflow.test.ts
pnpm exec vitest run scripts/ci
git add scripts/ci/desktop-workflow.test.ts scripts/ci/docker-workflow.test.ts scripts/ci/release-workflow.test.ts
git commit -m "test(ci): migrate workflow suites to vitest"
```

### Task 6: Migrate Artifact and Release-Version Tests

**Files:**

- Modify: `scripts/collect-electron-artifacts.test.ts`
- Modify: `scripts/release-version.test.ts`

- [ ] **Step 1: Confirm the last two Node test files**

Run:

```bash
rg -l 'node:test|node:assert/strict' scripts --glob '*.test.ts' | sort
```

Expected: only the two files listed above.

- [ ] **Step 2: Migrate artifact collection tests with awaited cleanup**

Import `expect`, `onTestFinished`, and `test` from `vitest`. Replace every:

```ts
t.after(() => rm(root, { recursive: true, force: true }));
```

with:

```ts
onTestFinished(() => rm(root, { recursive: true, force: true }));
```

Remove the unused test context parameters. Apply the shared assertion mapping, including converting `assert.fail` branches to explicit `throw new Error(...)`.

Preserve the property-matching semantics of the stale-file assertion explicitly:

```ts
await expect(readFile(path.join(output, "stale.txt"))).rejects.toMatchObject({
  code: "ENOENT",
});
```

Do not convert that assertion to `rejects.toThrow(...)`; it checks the filesystem error code rather than only its message.

- [ ] **Step 3: Migrate release-version tests and helper cleanup**

Import `expect`, `onTestFinished`, and `test` from `vitest`; remove `TestContext`.

Change `createRepository` to register its own cleanup using `onTestFinished`, and change the standalone `externalCwd` cleanup the same way. Update callers to stop passing `t`. Preserve the temporary Git repository setup and all release assertions.

- [ ] **Step 4: Run both focused files**

Run:

```bash
pnpm exec vitest run scripts/collect-electron-artifacts.test.ts scripts/release-version.test.ts
```

Expected: PASS, 2 files and 21 tests.

- [ ] **Step 5: Prove the Node runner migration is complete**

Run:

```bash
if rg -n 'node:test|node:assert/strict' apps packages scripts --glob '*.test.ts'; then exit 1; fi
```

Expected: exit 0 with no matches.

- [ ] **Step 6: Format and commit**

```bash
pnpm exec oxfmt --write scripts/collect-electron-artifacts.test.ts scripts/release-version.test.ts
pnpm exec vitest run scripts/collect-electron-artifacts.test.ts scripts/release-version.test.ts
git add scripts/collect-electron-artifacts.test.ts scripts/release-version.test.ts
git commit -m "test(release): migrate artifact suites to vitest"
```

### Task 7: Expose Unified Root Commands and Coverage

**Files:**

- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Add stable root scripts**

Add these scripts to root `package.json`:

```json
"test": "pnpm test:ts && pnpm test:go",
"test:ts": "vitest run",
"test:watch": "vitest",
"test:go": "cd apps/core && go test ./...",
"test:unit": "pnpm test",
"test:coverage:ts": "vitest run --coverage",
"test:coverage:go": "node --input-type=module --eval \"import fs from 'node:fs'; fs.rmSync('coverage/go', { recursive: true, force: true }); fs.mkdirSync('coverage/go', { recursive: true });\" && cd apps/core && go test -coverprofile=../../coverage/go/coverage.out ./...",
"test:coverage": "node --input-type=module --eval \"import fs from 'node:fs'; fs.rmSync('coverage', { recursive: true, force: true });\" && pnpm test:coverage:ts && pnpm test:coverage:go",
"test:ci": "pnpm test"
```

These aliases are intentional: later stages can extend `test:ci` without changing CI call sites.

- [ ] **Step 2: Ignore generated coverage**

Add this root `.gitignore` entry:

```gitignore
coverage/
```

- [ ] **Step 3: Run all TypeScript tests through the root**

Run:

```bash
pnpm test:ts
```

Expected: PASS, 24 files and 100 tests.

- [ ] **Step 4: Run the unified fast suite**

Run:

```bash
pnpm test
```

Expected: all 100 TypeScript tests and all Go packages pass.

- [ ] **Step 5: Generate both coverage outputs**

Run:

```bash
pnpm test:coverage
test -f coverage/ts/coverage-summary.json
test -f coverage/go/coverage.out
```

Expected: all commands PASS. Coverage is reported but no threshold blocks this stage.

- [ ] **Step 6: Run the repository health check**

Run:

```bash
pnpm check
git diff --check
```

Expected: PASS with no new errors or formatting issues.

- [ ] **Step 7: Commit**

```bash
git add package.json .gitignore
git commit -m "test: add unified test commands"
```

### Task 8: Add the Pull Request Quality Gate

**Files:**

- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: Validate MediaGo

on:
  pull_request:
  push:
    branches: [master]

permissions:
  contents: read

concurrency:
  group: ci-${{ github.workflow }}-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

jobs:
  quality:
    name: Quality
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with:
          version: "10.15.0"
          run_install: false
      - uses: actions/setup-node@v7
        with:
          node-version: "24.14.0"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm check

  test-ts:
    name: TypeScript tests
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
        with:
          version: "10.15.0"
          run_install: false
      - uses: actions/setup-node@v7
        with:
          node-version: "24.14.0"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm test:ts

  test-go:
    name: Go tests
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-go@v7
        with:
          go-version: "1.25.0"
          cache-dependency-path: apps/core/go.sum
      - run: go test ./...
        working-directory: apps/core

  pr-gate:
    name: PR gate
    if: ${{ always() }}
    needs: [quality, test-ts, test-go]
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - name: Require successful jobs
        env:
          QUALITY_RESULT: ${{ needs.quality.result }}
          TYPESCRIPT_RESULT: ${{ needs.test-ts.result }}
          GO_RESULT: ${{ needs.test-go.result }}
        run: |
          failed=0
          for result in \
            "quality:$QUALITY_RESULT" \
            "test-ts:$TYPESCRIPT_RESULT" \
            "test-go:$GO_RESULT"
          do
            job="${result%%:*}"
            status="${result#*:}"
            if [ "$status" != "success" ]; then
              echo "$job result: $status"
              failed=1
            fi
          done
          exit "$failed"
```

- [ ] **Step 2: Validate repository formatting and workflow invariants**

Run:

```bash
pnpm exec oxfmt --check .github/workflows/ci.yml
rg -n 'pull_request_target|write-all|contents: write' .github/workflows/ci.yml && exit 1 || true
git diff --check
```

Expected: formatting passes; the security search finds no match; diff check passes.

- [ ] **Step 3: Run the exact local equivalents of all worker jobs**

Run:

```bash
pnpm check
pnpm test:ts
(cd apps/core && go test ./...)
```

Expected: all three commands PASS.

- [ ] **Step 4: Simulate aggregate gate results**

Run the same gate body with one success case and one distinct non-success result for each dependency:

```bash
gate_script='failed=0
for result in "quality:$QUALITY_RESULT" "test-ts:$TYPESCRIPT_RESULT" "test-go:$GO_RESULT"; do
  job="${result%%:*}"
  status="${result#*:}"
  if [ "$status" != "success" ]; then
    echo "$job result: $status"
    failed=1
  fi
done
exit "$failed"'

run_gate() {
  QUALITY_RESULT="$1" TYPESCRIPT_RESULT="$2" GO_RESULT="$3" \
    bash -c "$gate_script"
}

run_gate success success success
if run_gate failure success success; then exit 1; fi
if run_gate success cancelled success; then exit 1; fi
if run_gate success success skipped; then exit 1; fi
```

Expected: the success case exits 0. The other cases exit nonzero and print, respectively, `quality result: failure`, `test-ts result: cancelled`, and `test-go result: skipped`.

Also confirm in the YAML that `pr-gate` has `if: ${{ always() }}` and needs all three worker jobs.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add pull request quality gate"
```

### Task 9: Final Verification

**Files:**

- Verify all files changed in Tasks 1–8.

- [ ] **Step 1: Invoke `superpowers:verification-before-completion`**

Follow the skill before making any completion claim.

- [ ] **Step 2: Verify complete TypeScript discovery and migration**

Run:

```bash
pnpm test:ts
test "$(rg -l 'node:test|node:assert/strict' apps packages scripts --glob '*.test.ts' | wc -l)" -eq 0
test "$(rg --files apps packages scripts -g '*.test.ts' | wc -l)" -eq 24
```

Expected: 24 files and 100 Vitest tests pass; both shell assertions pass.

- [ ] **Step 3: Verify every root entry point**

Run:

```bash
pnpm test
pnpm test:unit
pnpm test:ci
pnpm test:coverage
```

Expected: all commands exit 0; coverage files exist in `coverage/ts/` and `coverage/go/`.

- [ ] **Step 4: Verify package-local entry points**

Run:

```bash
pnpm -F @mediago/core-sdk test
pnpm -F @mediago/service-runner test
```

Expected: both delegate to the root config and only run their own package tests.

- [ ] **Step 5: Verify repository health**

Run:

```bash
pnpm check
git diff --check
git status --short
```

Expected: checks pass; status contains only intentional implementation-plan tracking if the plan checkboxes were updated.

- [ ] **Step 6: Record CI timing after the first pushed PR run**

The first complete GitHub Actions run must finish in under 10 minutes. After 20 eligible runs, calculate the P95 defined in the design spec. Branch-protection configuration remains a maintainer action outside this code change.
