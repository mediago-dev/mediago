# PR 718 Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve all four open PR 718 review findings with regression coverage and cross-platform-safe behavior.

**Architecture:** Keep downloader redaction at the logging boundary, isolate ad-blocker cache/network policy behind a focused loader, enforce dependency integrity at manifest resolution, and canonicalize filesystem trust checks without broad test exclusions. Each fix is independently testable and preserves existing runtime interfaces.

**Tech Stack:** Go, TypeScript, Electron, Vitest, Node.js filesystem APIs, `@ghostery/adblocker-electron`, pnpm/Turborepo.

---

## Chunk 1: Security boundaries

### Task 1: Default-deny Header Logging

**Files:**

- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] Add regression inputs for `X-API-Key`, `X-Auth-Token`, and arbitrary valid headers and assert no value reaches the redacted arguments.
- [x] Run `go test ./internal/core -run TestRedactSensitiveArgs -count=1` from `apps/core` and confirm the new assertions fail because values are visible.
- [x] Change `redactHeader` to retain only a validated header name plus `[REDACTED]`.
- [x] Re-run the focused Go test and the complete `./internal/core` package tests.

### Task 2: Complete Runtime Asset Checksums

**Files:**

- Modify: `scripts/download-deps-integrity.test.ts`
- Modify: `scripts/download-deps-integrity.ts`
- Modify: `scripts/deps-versions.json`

- [x] Add a manifest contract test requiring every asset platform to have exactly one valid checksum.
- [x] Run the integrity test and confirm it reports the currently missing platform checksums.
- [x] Populate verified checksums for every pinned asset.
- [x] Make `resolveDependencySha256` reject every missing checksum instead of one special case.
- [x] Run the integrity and provisioner suites and confirm cached/downloaded files remain fail-closed.

## Chunk 2: Runtime responsiveness

### Task 3: Non-blocking Cached Ad Blocker

**Files:**

- Create: `apps/electron/src/services/ad-blocker-cache.ts`
- Create: `apps/electron/src/services/ad-blocker-cache.test.ts`
- Modify: `apps/electron/src/services/ad-blocker-loader.ts`
- Modify: `apps/electron/src/services/ad-blocker-loader.test.ts`
- Modify: `apps/electron/src/services/webview.service.ts`
- Modify: `apps/electron/src/services/webview.service.test.ts`
- Modify: `apps/electron/src/app.ts`

- [x] Add a webview regression test proving navigation starts while the blocker promise is pending.
- [x] Run the focused test and confirm `loadURL` is not called before blocker resolution.
- [x] Remove the blocker await from the navigation path and contain background errors.
- [x] Add cache tests for fresh, stale, missing, corrupt, timeout, and atomic-write behavior.
- [x] Implement versioned serialized cache loading with stale-while-refresh and a bounded fetch.
- [x] Add a loader retry regression test, confirm failure, then reset failed single-flight attempts for retry.
- [x] Trigger prewarming after initial configuration seeding and run all Electron service tests.

## Chunk 3: Cross-platform correctness

### Task 4: Linux-only Helpers and macOS Real Paths

**Files:**

- Modify: `tests/e2e/support/fake-dependencies.test.ts`
- Modify: `tests/e2e/support/core-process.test.ts`
- Modify: `scripts/bundle-env-runtime.test.ts`
- Modify: `scripts/bundle-env-runtime.ts`

- [x] Mark only the two helper suites as `linux-x64`-only.
- [x] Add a simulated canonical-path regression where the declared target alias differs from the probed real path.
- [x] Run the alias regression and confirm the current pre-probe containment check incorrectly rejects the legitimate canonical target.
- [x] Read-only probe syntactically valid declared targets first (`realpath`/`lstat`, without execution), then validate containment using both canonical real paths before returning an executable entrypoint.
- [x] Keep the symlink-escape regression and assert an escaping canonical target is never returned for later execution.
- [x] Normalize filesystem-backed expected paths with `fs.realpath` and run the three focused suites.

## Chunk 4: Verification

### Task 5: Full Validation

**Files:**

- Inspect all modified files.

- [x] Run the focused Go and Vitest regression suites.
- [x] Run `pnpm format` on the modified TypeScript/JSON/Markdown files and `gofmt` on modified Go files.
- [x] Run `pnpm type:check`, `pnpm lint`, `pnpm test`, and `go test ./...` from `apps/core`.
- [x] Inspect `git diff --check`, `git status --short`, and the complete diff for unrelated changes.
- [x] Do not commit, push, reply to reviews, or resolve threads without separate authorization.
