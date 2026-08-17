# External Downloader Contracts Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, network-free contracts for BBDown and yt-dlp input arguments, output parsing, credential-safe logging, and runner error propagation.

**Architecture:** Keep tests inside the Go core package so they exercise the real schema loader, parser, argument builder, downloader, and Runner boundary. Replay small version-pinned upstream output fixtures through fake runners; never contact Bilibili, YouTube, or other external media services. Make only the minimum production changes required to align parsing and redaction with the pinned tools.

**Tech Stack:** Go tests, existing core downloader/parser packages, JSON fixtures, existing pnpm Go/quality commands.

**Working constraints:** Stay on `codex/automated-testing`; do not create a worktree or merge branches. Keep plans under `plans/`, never `docs/`. Use author and committer `caorushizi <84996057@qq.com>`.

---

## Chunk 1: Output contracts and input safety

### Task 1: Pin external-tool output contracts

**Files:**

- Create: `apps/core/internal/core/testdata/contracts/README.md`
- Create: `apps/core/internal/core/testdata/contracts/bbdown-progress.json`
- Create: `apps/core/internal/core/testdata/contracts/bbdown-failure.json`
- Create: `apps/core/internal/core/testdata/contracts/yt-dlp-progress.json`
- Create: `apps/core/internal/core/testdata/contracts/yt-dlp-error.json`
- Create: `apps/core/internal/core/downloader_contract_test.go`
- Modify: `apps/core/internal/core/schema/loader.go`

- [x] **Step 1: Add pinned fixture provenance**

Document BBDown 1.6.3 and yt-dlp 2026.07.04, matching `scripts/deps-versions.json`. Pin these official tagged sources and map each fixture to its source:

- BBDown progress: `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/ProgressBar.cs` and `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/BBDownUtil.cs`
- BBDown start/failure: `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown/Program.cs`
- BBDown's lack of a stable text error prefix: `https://github.com/nilaoda/BBDown/blob/1.6.3/BBDown.Core/Logger.cs` and the tagged `Program.cs`
- yt-dlp progress/destination: `https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/downloader/common.py`
- yt-dlp error prefix: `https://github.com/yt-dlp/yt-dlp/blob/2026.07.04/yt_dlp/YoutubeDL.py`

State that fixtures are JSON arrays where every element represents one Runner callback chunk, so escaped backspaces survive loading.

- [x] **Step 2: Add minimal captured fixtures**

Use only synthetic identifiers and these stable shapes:

```json
["开始下载P1", " 99%\b\b\b\b 50% - 1.50 MB/s"]
```

```json
["输入有误", "请尝试升级到最新版本后重试!"]
```

```json
[
  "[download] Destination: contract.webm",
  "[download]  42.1% of 1.00MiB at 2.50MiB/s ETA 00:01",
  "[download] Destination: ERROR-demo.webm"
]
```

```json
["ERROR: synthetic contract failure"]
```

- [x] **Step 3: Write focused failing parser/schema tests**

Load every fixture as `[]string`. Every element is one Runner callback chunk: apply `strings.TrimSpace` exactly as `DownloaderSvc.Download` does, then call the real `parser.LineParser`. When parsing emits `"ready"`, explicitly set `state.Ready = true`. Do not join, split, or re-chunk elements; this phase fixes only the captured source fragment grouping and does not claim arbitrary-token cross-chunk support.

Before parser assertions, prove the decoded BBDown progress fixture really contains four backspace bytes:

```go
if got := strings.Count(bbdownProgress[1], "\b"); got != 4 {
    t.Fatalf("decoded backspace count = %d, want 4", got)
}
```

Assert:

- BBDown becomes ready, finishes at 50%, reports 1.50 MB/s, and emits no parsed error.
- BBDown's failure fixture also produces zero parsed errors because upstream has no stable text error prefix.
- yt-dlp becomes ready, reports 42.1% and 2.50 MiB/s, and does not treat `ERROR-demo.webm` as an error.
- yt-dlp's line-start `ERROR:` produces exactly one error.
- BBDown keeps `开始下载`, but has empty Error and IsLive patterns.
- yt-dlp uses a line-start anchored `ERROR:` pattern and has an empty IsLive pattern.

Run:

```bash
cd apps/core
go test ./internal/core -run 'Test(ExternalOutputContracts|ExternalSchemaContracts)' -count=1
```

Expected: FAIL because the current BBDown error/live markers are unsupported and the yt-dlp error/live patterns are too broad.

- [x] **Step 4: Make the schema change minimal**

In `schema/loader.go`:

- Set BBDown Error and IsLive to empty strings.
- Keep BBDown Start as `开始下载`.
- Anchor yt-dlp Error to the start of a line, for example `(?m)^ERROR:`.
- Set yt-dlp IsLive to an empty string.

- [x] **Step 5: Prove the focused and package suites are green**

Run `gofmt -w apps/core/internal/core/downloader_contract_test.go apps/core/internal/core/schema/loader.go`, then:

```bash
cd apps/core
go test ./internal/core -run 'Test(ExternalOutputContracts|ExternalSchemaContracts)' -count=1
go test ./internal/core/... -count=1
```

- [x] **Step 6: Commit Task 1**

```bash
git add apps/core/internal/core/schema/loader.go apps/core/internal/core/downloader_contract_test.go apps/core/internal/core/testdata/contracts
git commit -m "test(core): add external downloader output contracts"
```

### Task 2: Contract-test semantic arguments and redact credentials

**Files:**

- Modify: `apps/core/internal/core/downloader_contract_test.go`
- Modify: `apps/core/internal/core/downloader_test.go`
- Modify: `apps/core/internal/core/downloader.go`

- [x] **Step 1: Make the test config express proxy settings**

Extend `testDownloaderConfig` with `useProxy bool` and `proxy string`; return those fields from `GetUseProxy` and `GetProxy`. Preserve the existing zero-value behavior.

- [x] **Step 2: Add semantic argv helpers and tests**

Assert adjacent flag/value pairs and required standalone flags with exact occurrence counts, without asserting whole-array order. Repeated `--add-header` values must each occur exactly once; do not use a first-match-only helper such as `slices.Index`. URLs and standalone common flags must also occur exactly once.

For both tools use a name containing invalid filename characters, such as `contract:video?`. For BBDown cover URL, work directory, sanitized `--file-pattern`, cookie, and common encoding priority; separately prove the cookie flag is absent when no Cookie header exists.

For yt-dlp cover URL, `-P`, sanitized `-o`, ordinary headers, proxy, and `--no-mtime --progress --newline --no-colors`. Cover all proxy gates: enabled with a non-empty value adds it exactly once; disabled with a value omits it; enabled with an empty value omits it. Use mixed-case sensitive headers with whitespace around the colon:

```text
cookie : session=test-only
aUtHoRiZaTiOn: Bearer test-only
Proxy-Authorization : Basic test-only
User-Agent: MediaGo-Contract-Test
```

Assert the actual argv still contains the original values, but assertion failures must report only the tool, flag/header name, expected occurrence count, and actual occurrence count. Never print raw argv, sensitive expected values, or call `redactSensitiveArgs` to format a failure while testing redaction.

- [x] **Step 3: Write failing redaction tests**

Cover separate and `--flag=value` forms for:

- `--cookie`
- `--add-header` when the header is Cookie, Authorization, or Proxy-Authorization, case-insensitively
- `--proxy` when the URL contains userinfo

Also retain a separate regression case for the existing `-c <value>` shorthand.

Also cover the built-in `--header` and `--custom-proxy` aliases, scheme-less proxies, malformed proxy URLs, overlapping/missing argument values, and malformed header names. These cases must fail closed without hiding valid ordinary headers or a valid proxy without credentials. Assert the input slice is unchanged.

Redaction assertions must use boolean presence/count checks with fixed messages such as `authorization header remained visible`; do not include the sensitive input, complete redacted slice, or expected slice in failure output.

Run:

```bash
cd apps/core
go test ./internal/core -run 'Test(ExternalInputContracts|RedactSensitiveArgs)' -count=1
```

Expected: FAIL because the current redactor only protects cookie arguments.

- [x] **Step 4: Implement narrow redaction helpers**

Add small helpers in `downloader.go`:

```go
func redactHeader(header string) string
func proxyContainsCredentials(raw string) bool
```

Use `strings.Cut`, `strings.TrimSpace`, an ASCII HTTP-token check, and a lowercase name comparison for Cookie, Authorization, and Proxy-Authorization. Redact credential-bearing proxies while keeping valid non-credential proxies readable; malformed headers and proxies fail closed. Handle separate and equals forms by reading the immutable input slice and writing only its clone.

- [x] **Step 5: Re-run focused and package tests**

Run `gofmt -w apps/core/internal/core/downloader.go apps/core/internal/core/downloader_test.go apps/core/internal/core/downloader_contract_test.go`, then:

```bash
cd apps/core
go test ./internal/core -run 'Test(ExternalInputContracts|RedactSensitiveArgs)' -count=1
go test ./internal/core/... -count=1
```

- [x] **Step 6: Commit Task 2**

```bash
git add apps/core/internal/core/downloader.go apps/core/internal/core/downloader_test.go apps/core/internal/core/downloader_contract_test.go
git commit -m "fix(core): redact downloader credentials"
```

---

## Chunk 2: Runner boundary and final verification

### Task 3: Prove fake-runner replay and error propagation

**Files:**

- Modify: `apps/core/internal/core/downloader_contract_test.go`

- [x] **Step 1: Add a table-driven fake-runner boundary test**

For BBDown and yt-dlp:

- Call the existing `ensureTestLogger()` at test start so the focused test is independently runnable.
- Use `schema.DefaultSchemas()` and `testDownloaderConfig` to construct the real downloader.
- Resolve the temporary binary name from `BinaryNames[tt.downloadType]` and create it with `os.WriteFile(..., 0o700)` so the real precondition check passes.
- Configure a `runnerFunc` that records the command, copies the argv, counts calls, replays the matching failure fixture through `onLine` in fixture order, then returns a unique sentinel error.
- Capture `OnMessage` output.
- Call the real `DownloaderSvc.Download`.

- [x] **Step 2: Assert the complete boundary contract**

Assert:

- The runner is called exactly once and `filepath.Base(bin)` is the expected binary name.
- The semantic URL/output arguments are present.
- Every replayed chunk reaches `OnMessage` once and in order after the same per-element `strings.TrimSpace` applied by `Download`.
- `Download` returns the same sentinel error, verified with `errors.Is`.

- [x] **Step 3: Record a meaningful RED signal**

The error propagation behavior is characterization and may already pass. Before accepting green, temporarily make the fake runner return `nil`; run the focused test and confirm its sentinel assertion fails. Restore the sentinel return immediately. Do not modify production code solely to manufacture a failure.

```bash
cd apps/core
go test ./internal/core -run TestExternalRunnerBoundary -count=1
```

- [x] **Step 4: Prove the restored test is green**

Run `gofmt -w apps/core/internal/core/downloader_contract_test.go`, then:

```bash
cd apps/core
go test ./internal/core -run TestExternalRunnerBoundary -count=1
go test ./internal/core/... -count=1
```

- [x] **Step 5: Commit Task 3**

```bash
git add apps/core/internal/core/downloader_contract_test.go
git commit -m "test(core): cover downloader failure contracts"
```

### Task 4: Verify, document completion, and update the existing PR

**Files:**

- Modify: `plans/implementation/2026-08-16-external-downloader-contracts.md`

- [x] **Step 1: Run the repository verification matrix**

```bash
test "$(git branch --show-current)" = "codex/automated-testing"
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
pnpm test:go
pnpm test:ts
pnpm check
git diff --check 28b73edf
git status --short
```

If sandbox restrictions block loopback or subprocess tests, rerun the unchanged command with the required approval and record both outcomes.

- [x] **Step 2: Audit scope**

```bash
git diff --stat 28b73edf..HEAD
git diff --name-only 28b73edf..HEAD
```

Confirm there are no workflow, package dependency, downloader download-script, UI, or media-network changes. Confirm fixture versions still match `scripts/deps-versions.json`.

- [x] **Step 3: Request final code review**

Use an independent reviewer against base `28b73edf`. Address Critical and Important findings, rerun affected tests, and request re-review until approved.

- [x] **Step 4: Mark this plan complete**

Change every completed checkbox in this file to `[x]`. Do not edit the approved design document unless implementation materially diverged.

- [x] **Step 5: Commit the completed plan**

```bash
git add plans/implementation/2026-08-16-external-downloader-contracts.md
git commit -m "docs(test): complete external downloader contracts"
```

Then verify every committed change and identity:

```bash
git diff --check 28b73edf..HEAD
git log --format='%h %an <%ae> | %cn <%ce> | %s' 28b73edf..HEAD
```

Every author and committer must be `caorushizi <84996057@qq.com>`.

- [x] **Step 6: Push only the current branch**

```bash
git push origin codex/automated-testing
```

Do not merge or create another branch.

- [x] **Step 7: Monitor PR #718**

Verify all required gates, including the local media integration job, complete successfully and the total PR workflow remains under ten minutes. Report any unrelated failure separately rather than broadening this phase.
