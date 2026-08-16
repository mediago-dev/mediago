# Media Download Integration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Follow superpowers:test-driven-development for behavior changes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add owned MP4/HLS fixtures and a real SDK → Core API → downloader integration gate without making the fast unit suite depend on external tools or third-party video sites.

**Architecture:** One committed synthetic media fixture is served by a minimal Node HTTP server on a random localhost port. A dedicated Vitest integration suite builds the current Core, starts it on a temporary port, uses the Core SDK to run Direct and HLS downloads sequentially, and validates the resulting files. CI provisions only aria2, N_m3u8DL-RE, and ffmpeg; media downloads stay on localhost.

**Tech Stack:** Node 24 standard HTTP APIs, TypeScript, Vitest 4.1, Go 1.25 Core, aria2, N_m3u8DL-RE, ffmpeg, GitHub Actions

**Design spec:** `plans/specs/2026-08-16-media-download-integration-design.md`

---

## File Map

**Create**

- `tests/media-service/generate.ts` — generate the synthetic MP4, fMP4 HLS files, and manifest.
- `tests/media-service/server.ts` — allowlisted GET/HEAD/Range fixture server.
- `tests/media-service/server.test.ts` — protocol tests.
- `tests/media-service/verify.ts` — verify a served version against every manifest hash.
- `tests/media-service/README.md` — fixture ownership, generation, and local serving notes.
- `tests/media-service/public/v1/**` — generated fixture and manifest.
- `scripts/download-deps-args.ts` — pure parser for selective dependency provisioning.
- `scripts/download-deps-args.test.ts` — parser contract tests.
- `vitest.integration.config.ts` — isolated long-running integration suite.
- `tsconfig.integration.json` — Bundler-mode type checking for SDK source and integration files.
- `tests/integration/media-download.integration.test.ts` — SDK/Core/real-downloader tests.

**Modify**

- `vitest.config.ts` — discover the media server's unit tests, not the integration suite.
- `scripts/download-deps.ts` — honor an optional validated `--tools` selection.
- `package.json` — add stable integration commands.
- `tsconfig.ci.json` — type-check the new dependency-provisioning scripts.
- `.github/workflows/ci.yml` — add the media integration job and aggregate it into `PR gate`.
- `.gitignore` — ignore only integration-generated temporary output if any is kept under the repository.

## Shared Constraints

- Stay on `codex/automated-testing`; do not merge branches or create a worktree.
- Keep plans under `plans/`, never `docs/`.
- Do not change the production downloader contract unless an integration test demonstrates a real defect.
- No Bilibili or YouTube requests.
- Run Direct and HLS sequentially.
- The normal `pnpm test` command must not download tools or access external media.
- Use current source to build Core; never use `apps/core/bin/*` as an integration fixture.
- Keep the committed media directory below 1 MiB.

## Task 1: Create the Owned Media Fixture and HTTP Service

**Files:**

- Create: `tests/media-service/server.test.ts`
- Create: `tests/media-service/server.ts`
- Create: `tests/media-service/generate.ts`
- Create: `tests/media-service/verify.ts`
- Create: `tests/media-service/README.md`
- Create: `tests/media-service/public/v1/**`
- Modify: `vitest.config.ts`

- [x] **Step 1: Add fixture-server discovery and write failing protocol tests**

Add `tests/media-service/**/*.test.ts` to the root Vitest include list. Write focused tests for `/healthz`, full GET, HEAD, `bytes=0-15`, an invalid range, POST, and an unknown path. Import the not-yet-created `startMediaServer` API.

Run:

```bash
pnpm test:ts -- tests/media-service/server.test.ts
```

Expected: FAIL because `server.ts` or `startMediaServer` does not exist.

- [x] **Step 2: Implement the smallest allowlisted server**

Export `startMediaServer()` returning `{ baseURL, close }`, where `baseURL` ends in `/v1`. Use `127.0.0.1:0`, fixed path mappings, exact media types, strong SHA-256 ETags, CORS, GET/HEAD, and single HTTP ranges. Do not add upload, directory listing, proxying, arbitrary path resolution, rate limiting, or a framework dependency.

Run the focused test and confirm it passes.

- [x] **Step 3: Add the deterministic generator and create the fixture**

Use `execFile`/`spawn` with argument arrays to run ffmpeg. Accept an explicit fixture version, generate a one-second 160×90 H.264/AAC MP4 and one-segment fMP4 HLS output in a temporary directory, then install it only when that version does not exist. If an existing version differs, fail and require a new version instead of overwriting it. Write a stable `manifest.json` containing schema version, fixture version, generator identity, paths, byte sizes, and SHA-256 values. No source is downloaded.

Run:

```bash
pnpm exec tsx tests/media-service/generate.ts --version v1
du -sh tests/media-service/public/v1
```

Expected: generation succeeds and total size is below 1 MiB.

- [x] **Step 4: Verify fixture integrity in the server tests**

Add assertions that every manifest entry exists and matches its declared size/hash. Add a small reusable service verifier that fetches a manifest and every allowlisted entry and validates size/SHA-256; cover its successful local-server path in the focused tests. Re-run the focused tests, then run:

```bash
pnpm exec oxfmt --check tests/media-service vitest.config.ts
pnpm type:check:ci
```

Expected: PASS.

- [x] **Step 5: Document regeneration and local serving**

In `tests/media-service/README.md`, state that the media is synthetic, show the generation command, describe the version immutability rule, and document that CI serves it read-only on localhost without uploading it. Keep it short and operational.

## Task 2: Provision Only the Required Downloader Tools

**Files:**

- Create: `scripts/download-deps-args.test.ts`
- Create: `scripts/download-deps-args.ts`
- Modify: `scripts/download-deps.ts`

- [x] **Step 1: Write failing argument-selection tests**

Cover no filter, comma-separated values, whitespace/duplicates, `--tools=value`, missing value, and unknown names. The result must preserve manifest order and list valid names in failures.

Run:

```bash
pnpm test:ts -- scripts/download-deps-args.test.ts
```

Expected: FAIL because the parser does not exist.

- [x] **Step 2: Implement the pure parser**

Export one small function that receives argv and available tool names. Return all names when no filter is present and a validated ordered subset otherwise. Keep CLI parsing out of the network/download functions.

- [x] **Step 3: Wire the parser into the existing script**

Select tool entries before entering the platform loop. Leave behavior unchanged when `--tools` is omitted. Update the usage comment with one selective example.

Run:

```bash
pnpm test:ts -- scripts/download-deps-args.test.ts
pnpm exec tsx scripts/download-deps.ts --tools does-not-exist
```

Expected: tests pass; the CLI fails before network access and prints the valid tool names.

- [x] **Step 4: Run local static checks**

```bash
pnpm exec oxfmt --check scripts/download-deps.ts scripts/download-deps-args.ts scripts/download-deps-args.test.ts
pnpm type:check:ci
```

Expected: PASS.

## Task 3: Add the SDK → Core → Downloader Integration Harness

**Files:**

- Create: `vitest.integration.config.ts`
- Create: `tsconfig.integration.json`
- Create: `tests/integration/media-download.integration.test.ts`
- Modify: `package.json`
- Modify: `tsconfig.ci.json`

- [x] **Step 1: Create an isolated integration configuration**

Include only `tests/integration/**/*.integration.test.ts`, use one worker, disable file parallelism, and set explicit suite/test/hook timeouts suitable for Core build and two tiny downloads. Alias `@mediago/core-sdk` directly to `packages/core-sdk/src/index.ts` so a clean checkout never depends on ignored `dist/` output. Add `tsconfig.integration.json` with Bundler module resolution, the same alias as a TypeScript `paths` mapping, and includes for the SDK source, media service, integration config, and integration tests. This avoids forcing the SDK's existing extensionless source imports through NodeNext. Do not change the root unit-test timeouts.

- [x] **Step 2: Write the failing end-to-end test**

The test must:

- load the committed local manifest as its truth;
- always use `startMediaServer()` and its random `127.0.0.1` URL;
- build `apps/core/cmd/server` from the current source into `t.TempDir`-equivalent Node temporary storage;
- allocate a loopback port, start Core with isolated config/log/download folders and `.deps/<platform>`;
- sanitize Core/downloader proxy variables, fix `HOST`/`PORT`, isolate `HOME`, and disable Axios proxying;
- retry startup once only when readiness fails before Core becomes healthy;
- call `MediaGoClient.health()`, `createTask()`, and `getTask()`;
- poll with a deadline and include Core's bounded output tail on failure;
- clean up the Core process, server, and temporary directory on every outcome.

Add sequential Direct and HLS cases. First run without the required tools to confirm a clear precondition failure rather than an unrelated timeout.

- [x] **Step 3: Add Direct assertions**

Create a Direct task against the localhost fixture and require success. Verify the downloaded MP4 size and SHA-256 against the committed manifest. Range behavior remains covered by the media server protocol tests.

- [x] **Step 4: Add HLS assertions**

Create one M3U8 task after Direct finishes. Require success, find the new non-empty merged file by sanitized name, and run the provisioned ffmpeg with a short timeout to decode the full output into a null sink.

- [x] **Step 5: Add stable commands**

Add:

```text
test:integration:media:setup
test:integration:media:run
test:integration:media
test:integration
type:check:integration
```

The setup command provisions `aria2,N_m3u8DL-RE,ffmpeg`; the run command executes only the isolated Vitest config; the combined command runs both. Do not add integration tests to `pnpm test` or `pnpm test:ci` yet.

Extend `tsconfig.ci.json` to cover the dependency argument parser. Make the existing root `type:check` command also invoke `type:check:integration`, so `pnpm check` covers all new TypeScript.

- [x] **Step 6: Run locally against the loopback service**

```bash
pnpm test:integration:media
```

Expected: actual Direct and HLS downloads pass sequentially. If dependency download is blocked by the sandbox, request network approval and retry the same command.

## Task 4: Add the Local Media PR Gate

**Files:**

- Modify: `.github/workflows/ci.yml`

- [x] **Step 1: Add the integration job**

Use Node 24.14, pnpm 10.15, and Go 1.25 on Linux with an 8-minute timeout. Restore `.deps` using a key derived from OS, architecture, and `scripts/deps-versions.json`. Install workspace dependencies, provision the selected tools, then run only `test:integration:media:run`.

- [x] **Step 2: Use the localhost fixture service**

Do not set `MEDIAGO_TEST_MEDIA_BASE_URL` in CI. The integration suite starts the fixture server on a random `127.0.0.1` port and sends both real downloads to that service. CI must not read media from GitHub Raw, OSS, or third-party video sites.

- [x] **Step 3: Aggregate the new result**

Add the integration job to `pr-gate.needs` and require `success` in the existing summary script. Keep the stable check name `PR gate`.

- [x] **Step 4: Validate workflow syntax and behavior**

Run repository formatting/check commands and inspect the resulting workflow. Confirm fork PRs need no media secret and no workflow uploads media.

## Task 5: Full Verification, Review, Commit, and Push

**Files:** all Phase 2 files above.

- [x] **Step 1: Run focused and complete local verification**

```bash
pnpm test:ts
pnpm test:go
pnpm test:integration:media:run
pnpm check
git diff --check
```

Expected: every command exits 0. Existing non-blocking lint warnings may remain, but no new warning or error should be introduced.

- [x] **Step 2: Run an independent final review**

Review against every acceptance criterion in the design spec, with special attention to process cleanup, localhost isolation, Range behavior, and keeping the fast suite offline.

- [x] **Step 3: Commit intentionally on the current branch**

```bash
git add plans tests scripts vitest.config.ts vitest.integration.config.ts tsconfig.integration.json tsconfig.ci.json package.json .github/workflows .gitignore
git commit -m "test(integration): add owned media download coverage"
```

Confirm the author/committer is `caorushizi <84996057@qq.com>`.

- [x] **Step 4: Push without merging**

```bash
git push origin codex/automated-testing
```

Do not merge the branch. After push, inspect the PR checks and record the integration job's wall-clock time.
