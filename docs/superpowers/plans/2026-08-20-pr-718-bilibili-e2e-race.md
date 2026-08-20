# PR 718 Controlled Bilibili E2E Race Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the controlled Bilibili Playwright race by loading those scenarios on a neutral loopback page that cannot trigger automatic direct-media capture.

**Architecture:** Extend the existing lifecycle-managed test-page server with a `/blank` route and expose it as `StartedTestPage.blankURL`. Keep `/` unchanged for direct MP4 coverage, and migrate only controlled Bilibili callers to the neutral URL. Production extension code and badge behavior remain untouched.

**Tech Stack:** TypeScript, Node HTTP server, Vitest, Playwright, pnpm, Task

**Spec:** `docs/superpowers/specs/2026-08-20-pr-718-bilibili-e2e-race-design.md`

---

## File Map

- Create `tests/e2e/support/test-page.test.ts`: own the loopback test-page route contract and guaranteed server cleanup.
- Modify `tests/e2e/support/test-page.ts`: serve the neutral page and expose `blankURL` without changing the media page lifecycle.
- Modify `tests/e2e/extension/capture-and-download.spec.ts`: use the neutral URL only for controlled Bilibili scenarios.
- Update this plan's checkboxes as each RED, GREEN, verification, and commit step completes.

## Chunk 1: Neutral Loopback Page

### Task 1: Specify and implement the neutral route

Use `@superpowers:test-driven-development` for the complete RED/GREEN cycle.

**Files:**

- Create: `tests/e2e/support/test-page.test.ts`
- Modify: `tests/e2e/support/test-page.ts:1-72`

- [x] **Step 1: Write the failing neutral-route contract test**

Create `tests/e2e/support/test-page.test.ts` with a unique sample URL and a
`try/finally` around every started server:

```ts
import { describe, expect, test } from "vitest";
import { startTestPage } from "./test-page.ts";

const SAMPLE_URL = "http://127.0.0.1:45678/v1/sample.mp4?fixture=neutral";

describe("loopback test page", () => {
  test("serves a neutral page without media capture inputs", async () => {
    const page = await startTestPage(SAMPLE_URL);
    try {
      const expectedBlankURL = new URL("/blank", page.url).toString();
      expect(page.blankURL).toBe(expectedBlankURL);

      const response = await fetch(page.blankURL);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(body).not.toContain(SAMPLE_URL);
      expect(body).not.toContain("<script");
      expect(body).not.toContain("fixtureMediaLoaded");
    } finally {
      await page.close();
    }
  });
});
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm exec vitest run tests/e2e/support/test-page.test.ts
```

Expected: FAIL because `StartedTestPage` does not expose `blankURL`; the first
assertion reports `undefined` instead of the loopback `/blank` URL. Do not
change implementation until this exact failure is observed.

- [x] **Step 3: Add passing coverage for the retained media route**

Before implementing the neutral route, add a second test to the same file:

```ts
test("preserves the media capture page", async () => {
  const page = await startTestPage(SAMPLE_URL);
  try {
    const mediaResponse = await fetch(page.url);
    const mediaBody = await mediaResponse.text();
    expect(mediaResponse.status).toBe(200);
    expect(mediaBody).toContain(SAMPLE_URL);
    expect(mediaBody).toContain("fixtureMediaLoaded");
  } finally {
    await page.close();
  }
});
```

- [x] **Step 4: Add passing coverage for an unknown path**

Add one focused test to the same file:

```ts
test("returns 404 for an unknown path", async () => {
  const page = await startTestPage(SAMPLE_URL);
  try {
    const response = await fetch(new URL("/missing", page.url));
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not Found\n");
  } finally {
    await page.close();
  }
});
```

- [x] **Step 5: Add passing coverage for a non-GET request**

Add one focused test to the same file:

```ts
test("returns 404 for a non-GET request", async () => {
  const page = await startTestPage(SAMPLE_URL);
  try {
    const response = await fetch(new URL("/blank", page.url), {
      method: "POST",
    });
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Not Found\n");
  } finally {
    await page.close();
  }
});
```

- [x] **Step 6: Re-run the route tests and confirm one intentional RED**

Run:

```bash
pnpm exec vitest run tests/e2e/support/test-page.test.ts
```

Expected: the media, unknown-path, and non-GET tests pass. Only the neutral
route test fails because `blankURL` is still missing.

- [x] **Step 7: Implement the minimal neutral page and public URL**

In `tests/e2e/support/test-page.ts`, add the interface field:

```ts
export interface StartedTestPage {
  url: string;
  blankURL: string;
  close(): Promise<void>;
}
```

Add a fixed, dependency-free page body near `fixtureHTML`:

```ts
const blankHTML = Buffer.from(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MediaGo E2E Neutral Fixture</title>
  </head>
  <body>
    <main><h1>MediaGo E2E Neutral Fixture</h1></main>
  </body>
</html>`);
```

Keep the existing media HTML buffer, select a body only for the two supported
GET routes, and leave the current `404` response unchanged:

```ts
const mediaHTML = Buffer.from(fixtureHTML(sampleURL));
const server = createServer((request, response) => {
  const body =
    request.method === "GET"
      ? request.url === "/"
        ? mediaHTML
        : request.url === "/blank"
          ? blankHTML
          : undefined
      : undefined;
  if (!body) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": "10",
    });
    response.end("Not Found\n");
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": String(body.length),
    "Cache-Control": "no-store",
  });
  response.end(body);
});
```

After the server binds, build one base URL and return both routes:

```ts
const baseURL = `http://127.0.0.1:${address.port}`;
return {
  url: `${baseURL}/`,
  blankURL: `${baseURL}/blank`,
  close: async () => {
    // Keep the existing close implementation exactly as-is.
  },
};
```

- [x] **Step 8: Run focused tests and verify GREEN**

Run:

```bash
pnpm exec vitest run tests/e2e/support/test-page.test.ts
```

Expected: PASS, 1 file and 4 tests. Confirm no listener or unhandled-rejection
warnings appear.

- [x] **Step 9: Run E2E TypeScript checking**

Run:

```bash
pnpm type:check:e2e
```

Expected: exit 0. This command is mandatory because `pnpm check` does not load
`tsconfig.e2e.json`.

- [x] **Step 10: Review and commit the neutral route**

Inspect the unstaged diff before staging. It must contain only the support
server, its focused tests, and checkbox updates in this plan:

```bash
git diff --check
git diff --stat
git diff -- tests/e2e/support/test-page.ts tests/e2e/support/test-page.test.ts
```

Then stage only the two Task 1 files plus this plan and inspect the staged
scope before committing:

```bash
git add tests/e2e/support/test-page.ts tests/e2e/support/test-page.test.ts docs/superpowers/plans/2026-08-20-pr-718-bilibili-e2e-race.md
git diff --cached --check
git diff --cached --name-only
git commit -m "test(e2e): add neutral loopback fixture page"
```

Expected: the staged name list contains exactly the three named paths, followed
by one local commit. Do not push.

## Chunk 2: Controlled Bilibili Isolation and Verification

### Task 2: Migrate only controlled Bilibili scenarios

**Files:**

- Modify: `tests/e2e/extension/capture-and-download.spec.ts:852-946`
- Test: `tests/e2e/extension/capture-and-download.spec.ts:915-967`

- [x] **Step 1: Confirm the observed end-to-end RED evidence**

Use GitHub Actions run `32358193901`, job `96391861860`, as the existing RED
checkpoint. It failed the
`missing Download ID` scenario with `Expected: "1"`, `Received: "2"`. The
trace shows `sample.mp4` still in flight when controlled injection completed.
This is the regression's already-observed end-to-end RED; do not weaken the
badge assertion or add sleeps/retries.

- [x] **Step 2: Switch both controlled call sites to the neutral URL**

In the successful controlled import and the `MALFORMED_BILIBILI_RESPONSES`
loop, change only:

```ts
localPageURL: extensionRuntime.testPage.url,
```

to:

```ts
localPageURL: extensionRuntime.testPage.blankURL,
```

Keep the direct MP4 scenario at line 818 on `extensionRuntime.testPage.url`.
Do not modify `openControlledBilibiliPopup`, source injection, badge assertions,
or production extension files.

- [x] **Step 3: Review the exact caller diff**

Run:

```bash
git diff --check
git diff -- tests/e2e/extension/capture-and-download.spec.ts
rg -n "testPage\.(?:url|blankURL)" tests/e2e/extension/capture-and-download.spec.ts
```

Expected: the file diff contains exactly two `.url` to `.blankURL`
substitutions. The direct MP4 navigation still uses `.url`, exactly two
controlled Bilibili option objects use `.blankURL`, and no other hunk changes.

- [x] **Step 4: Build dependencies and run the complete extension project**

Run the public Task target under Xvfb on headless Linux. This target downloads
the declared E2E dependency, builds Core and the extension surfaces, installs
Chromium, exports the test profile, and then runs every extension scenario:

```bash
xvfb-run -a task test:e2e:extension
```

Expected: all extension Playwright scenarios pass, including the real Bilibili
import and all malformed-response cases.

- [x] **Step 5: Run the former failure repeatedly on the prepared build**

The previous step provides every prerequisite, so run the focused scenario ten
times:

```bash
xvfb-run -a pnpm exec playwright test tests/e2e/extension/capture-and-download.spec.ts --project=extension --grep "missing Download ID" --repeat-each=10 --reporter=line
```

Expected: 10 passed with no badge-count timeout. Use a short external `TMPDIR`
if the workstation's `/tmp` quota or Chromium socket length requires it; do not
change repository code to work around the local environment.

- [x] **Step 6: Stage and inspect only the controlled caller migration**

Inspect the complete unstaged caller diff, then stage only the caller and this
plan. Inspect the staged names and caller patch before committing:

```bash
git diff --check
git diff --stat
git diff -- tests/e2e/extension/capture-and-download.spec.ts
git add tests/e2e/extension/capture-and-download.spec.ts docs/superpowers/plans/2026-08-20-pr-718-bilibili-e2e-race.md
git diff --cached --check
git diff --cached --name-only
git diff --cached -- tests/e2e/extension/capture-and-download.spec.ts
```

Expected: the staged name list contains exactly the two named paths and the
caller patch contains only the two approved substitutions.

- [x] **Step 7: Commit the controlled caller migration**

```bash
git commit -m "test(e2e): isolate controlled Bilibili capture"
```

Expected: one local commit; do not push.

### Task 3: Complete repository verification

Use `@superpowers:verification-before-completion` before claiming success.

**Files:**

- Verify: `tests/e2e/support/test-page.test.ts`
- Verify: `tests/e2e/support/test-page.ts`
- Verify: `tests/e2e/extension/capture-and-download.spec.ts`

- [x] **Step 1: Run focused support tests**

```bash
pnpm exec vitest run tests/e2e/support/test-page.test.ts
```

Expected: 1 file and 4 tests pass.

- [x] **Step 2: Run the dedicated E2E type check**

```bash
pnpm type:check:e2e
```

Expected: exit 0.

- [x] **Step 3: Run repository quality checks**

```bash
pnpm check
```

Expected: exit 0. Existing lint warnings are acceptable only when the command
reports zero errors and no warning originates from the changed files.

- [x] **Step 4: Run the normal full test suite**

```bash
pnpm test
```

Expected: all Go and Vitest tests pass, including the new support tests.

- [x] **Step 5: Run the CI-equivalent three-surface Playwright suite**

```bash
task ci:test:e2e
```

Expected: all web, Electron, and extension Playwright scenarios pass. If local
system-package installation is unavailable but browser libraries are already
installed, use this self-contained public target instead:

```bash
xvfb-run -a task test:e2e
```

It retains the Taskfile dependency download, Core build, surface build,
Chromium install, and test-profile environment. Report this environmental
substitution explicitly.

- [x] **Step 6: Audit committed and uncommitted scope from the implementation baseline**

```bash
git diff --check c2ed244f..HEAD
git diff --name-status c2ed244f..HEAD
git diff --stat c2ed244f..HEAD
git diff c2ed244f..HEAD -- tests/e2e/support/test-page.ts tests/e2e/support/test-page.test.ts tests/e2e/extension/capture-and-download.spec.ts
git diff --check
git status --short --branch
```

Expected: the committed name list contains exactly the three implementation
paths and this plan. Both diff checks are silent; the implementation patch
contains only the neutral route, its four focused tests, and two controlled
caller substitutions. Only this plan may remain modified by final checkbox
updates.

- [x] **Step 7: Commit the completed verification record**

```bash
git add docs/superpowers/plans/2026-08-20-pr-718-bilibili-e2e-race.md
git diff --cached --check
git diff --cached --name-only
git diff --cached -- docs/superpowers/plans/2026-08-20-pr-718-bilibili-e2e-race.md
git commit -m "docs: record Bilibili E2E race verification"
```

Expected: only the plan is staged and committed.

- [x] **Step 8: Confirm the final worktree state**

```bash
git status --short --branch
```

Expected: no modified or untracked files. Do not push, reply to GitHub, resolve
threads, or rerun Actions without explicit authorization.
