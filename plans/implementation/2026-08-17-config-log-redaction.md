# Configuration Log Redaction Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Core and Electron configuration logs from persisting proxy credentials or arbitrary configuration update values without changing configuration behavior.

**Architecture:** Core tests capture the real global Zap logger while exercising `NewRuntime`, the real config listener, and the real Gin config handler. Electron moves only proxy normalization/session application/logging into a small dependency-injected function so Node Vitest can verify the production behavior without launching Electron.

**Tech Stack:** Go tests, Zap observer, Gin recorder, TypeScript, Vitest, existing pnpm quality commands.

**Working constraints:** Stay on `codex/automated-testing`; do not create a worktree or merge branches. Keep plans under `plans/`, never `docs/`. Use author and committer `caorushizi <84996057@qq.com>`. Do not change downloader argv logging, config persistence, API responses, SSE payloads, or proxy application semantics.

---

## Chunk 1: Core configuration logs

### Task 0: Verify branch and commit identity

- [x] **Step 1: Run the preflight before any commit**

Run:

```bash
test "$(git branch --show-current)" = "codex/automated-testing"
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git status --short --branch
```

Expected: current branch is `codex/automated-testing`; author and committer are both `caorushizi <84996057@qq.com>`; only the two planned documents are untracked. Do not merge or create another branch.

### Task 1: Protect startup and runtime proxy logs

**Files:**

- Create: `apps/core/internal/app/runtime_test.go`
- Modify: `apps/core/internal/app/runtime.go`

- [x] **Step 1: Add a real log observer test**

Create a test helper that replaces both `logger.Logger` and `logger.Sugar` with a `zaptest/observer` logger and restores the originals with `t.Cleanup`. Build a minimal `AppConfig` using `t.TempDir()`, a pre-created download directory, and a nonexistent temporary `SchemaPath` so production falls back to built-in schemas.

Set a unique credential-bearing startup proxy, call `NewRuntime`, then call the real `rt.AppStore.Set("proxy", runtimeProxy)`. Assert:

- `cfg.GetProxy()` equals the new full proxy, proving configuration behavior is unchanged.
- the observer contains `proxy updated via config change`.
- a combined encoding of every entry's `Message` and `ContextMap()` contains neither test proxy nor either credential marker.

Register `t.Cleanup(rt.Close)` immediately after `NewRuntime` succeeds. Every assertion involving a proxy or captured log must first compute a boolean and report only a fixed message. For example, compare `cfg.GetProxy() != runtimeProxy` but report only `runtime proxy propagation changed`; compute `containsSecret` separately and report only `runtime logs contain a proxy secret`. Never pass a proxy, credential marker, encoded log, observer entry, or config object to `t.Fatalf`.

- [x] **Step 2: Run the test and verify RED**

Run:

```bash
cd apps/core
go test ./internal/app -run TestRuntimeLogsDoNotExposeProxyValues -count=1
```

Expected: FAIL because `Final Config: %+v` exposes the startup proxy and the proxy listener exposes the updated proxy.

- [x] **Step 3: Remove values from the two production logs**

In `runtime.go`:

- delete `logger.Infof("Final Config: %+v", cfg)`;
- replace `logger.Infof("proxy updated to %q via config change", v)` with `logger.Info("proxy updated via config change")`;
- keep `cfg.SetProxy(v)` and all other runtime messages unchanged.

- [x] **Step 4: Re-run the focused test and verify GREEN**

Run the Step 2 command again. Expected: PASS.

### Task 2: Log configuration update keys, never request values

**Files:**

- Create: `apps/core/internal/api/handler/config_test.go`
- Modify: `apps/core/internal/api/handler/config.go`

- [x] **Step 1: Add a handler behavior test**

Create a small `ConfigStore` fake that records `Update` input and otherwise implements the existing interface. Install a Zap observer, construct the real `ConfigHandler` with `sse.New()`, and send a Gin test request containing unsorted keys with unique values for `proxy`, `apiKey`, `mcpToken`, and `passwordHash`.

Assert the HTTP response is successful and the fake store received all original values. Locate the `Config update request received` entry and assert:

- the old `req` field does not exist;
- `keys` is exactly `[]string{"apiKey", "mcpToken", "passwordHash", "proxy"}`;
- `clientIP` remains present;
- neither `Message` nor the encoded `ContextMap()` contains any test value or credential marker.

Use `reflect.DeepEqual` only to compute a boolean for the fake payload comparison and report the fixed message `config update payload changed`. All secret searches similarly assert only `containsSecret == false` with a fixed message; never print the payload, expected map, fields, entries, encoded logs, or search terms.

- [x] **Step 2: Run the handler test and verify RED**

Run:

```bash
cd apps/core
go test ./internal/api/handler -run TestConfigUpdateLogsKeysWithoutValues -count=1
```

Expected: FAIL because the current entry contains `req` with every update value and no `keys` field.

- [x] **Step 3: Replace the request field with stable keys**

Import `sort`, collect keys from `req`, call `sort.Strings(keys)`, and log:

```go
logger.Info(
    "Config update request received",
    zap.Strings("keys", keys),
    zap.String("clientIP", c.ClientIP()),
)
```

Do not change `h.conf.Update(req)`, SSE broadcasting, or the response.

- [x] **Step 4: Verify both Core fixes**

Run:

```bash
cd apps/core
gofmt -w internal/app/runtime.go internal/app/runtime_test.go internal/api/handler/config.go internal/api/handler/config_test.go
go test ./internal/app ./internal/api/handler -count=1
go test ./... -count=1
```

Expected: all PASS.

- [x] **Step 5: Commit the Core fix**

```bash
git add apps/core/internal/app/runtime.go apps/core/internal/app/runtime_test.go apps/core/internal/api/handler/config.go apps/core/internal/api/handler/config_test.go
git commit -m "fix(core): stop logging configuration secrets"
```

---

## Chunk 2: Electron proxy log and final verification

### Task 3: Apply WebView proxy settings without logging their value

**Files:**

- Create: `apps/electron/src/services/webview-proxy.ts`
- Create: `apps/electron/src/services/webview-proxy.test.ts`
- Modify: `apps/electron/src/services/webview.service.ts`

- [x] **Step 1: Add a focused production-function contract**

Test the planned `enableSessionProxy` function with minimal fakes:

```ts
const setProxy = vi.fn();
const info = vi.fn();
const error = vi.fn();

enableSessionProxy(
  { setProxy },
  { info, error },
  "user:pass@proxy.invalid:8080",
);
```

Assert `setProxy` receives `{ proxyRules: "http://user:pass@proxy.invalid:8080" }`, proving the real proxy remains functional. Assert `info` receives exactly `[Proxy] proxy enabled`, and serialize all logger calls to prove they contain neither the full proxy nor the credential markers. Add a second case proving an empty proxy does not call `setProxy` and preserves the fixed empty-address error.

For any call containing the proxy, extract the spy argument, compute a boolean, and assert that boolean with a fixed custom message such as `setProxy proxyRules changed`. Secret searches over logger calls must report only `proxy logger exposed credentials`; do not use `toHaveBeenCalledWith`, `toContain(secret)`, or assertions that expand mock calls, the proxy, or credential markers on failure.

- [x] **Step 2: Run the Electron test and verify RED**

Run:

```bash
pnpm exec vitest run apps/electron/src/services/webview-proxy.test.ts
```

Expected: FAIL because the production helper does not exist yet.

- [x] **Step 3: Extract the smallest proxy application seam**

Create `webview-proxy.ts` with local minimal interfaces and this behavior:

```ts
export function enableSessionProxy(
  targetSession: { setProxy(config: { proxyRules: string }): unknown },
  logger: {
    info(...args: unknown[]): unknown;
    error(...args: unknown[]): unknown;
  },
  rawProxy: string,
): void {
  if (!rawProxy) {
    logger.error("[Proxy] proxy address is empty");
    return;
  }

  const proxyRules = /^(https?|socks5):\/\//i.test(rawProxy)
    ? rawProxy
    : `http://${rawProxy}`;
  targetSession.setProxy({ proxyRules });
  logger.info("[Proxy] proxy enabled");
}
```

Make `WebviewService.enableProxy()` delegate to this function with `this.session`, `this.logger`, and the unchanged raw proxy. Leave `disableProxy()` unchanged.

- [x] **Step 4: Verify the Electron fix**

Run:

```bash
pnpm exec oxfmt --write apps/electron/src/services/webview-proxy.ts apps/electron/src/services/webview-proxy.test.ts apps/electron/src/services/webview.service.ts
pnpm exec vitest run apps/electron/src/services/webview-proxy.test.ts
pnpm -F @mediago/electron type:check
pnpm exec oxfmt --check apps/electron/src/services/webview-proxy.ts apps/electron/src/services/webview-proxy.test.ts apps/electron/src/services/webview.service.ts
```

Expected: all PASS.

- [x] **Step 5: Commit the Electron fix**

```bash
git add apps/electron/src/services/webview-proxy.ts apps/electron/src/services/webview-proxy.test.ts apps/electron/src/services/webview.service.ts
git commit -m "fix(electron): stop logging proxy credentials"
```

### Task 4: Commit the reviewed plans and verify the branch

**Files:**

- Add: `plans/specs/2026-08-17-config-log-redaction-design.md`
- Add: `plans/implementation/2026-08-17-config-log-redaction.md`

- [x] **Step 1: Run the complete relevant matrix**

Run:

```bash
pnpm test:go
pnpm test:ts
pnpm check
git status --short
```

Expected: Go and TypeScript tests PASS; quality check exits 0 with no new errors; only the two reviewed plan files remain uncommitted.

- [x] **Step 2: Format, stage, and validate the reviewed plans**

Run:

```bash
pnpm exec oxfmt --write plans/specs/2026-08-17-config-log-redaction-design.md plans/implementation/2026-08-17-config-log-redaction.md
pnpm exec oxfmt --check plans/specs/2026-08-17-config-log-redaction-design.md plans/implementation/2026-08-17-config-log-redaction.md
git add plans/specs/2026-08-17-config-log-redaction-design.md plans/implementation/2026-08-17-config-log-redaction.md
git diff --cached --check
```

Expected: formatting and staged diff checks PASS; staged files are exactly the two reviewed plan files.

- [x] **Step 3: Commit the reviewed plans**

```bash
git commit -m "docs(security): document configuration log redaction"
```

- [x] **Step 4: Verify commit identity and clean state**

Run:

```bash
git log -3 --format='%h %an <%ae> | %cn <%ce> | %s'
git diff --check origin/codex/automated-testing..HEAD
git status --short --branch
```

Expected: author and committer are `caorushizi <84996057@qq.com>`; branch is clean and ahead of its current remote.

- [ ] **Step 5: Push the current branch and inspect PR checks**

Push and inspect the current SHA without merging:

```bash
test "$(git branch --show-current)" = "codex/automated-testing"
git push origin codex/automated-testing
gh pr checks 718 --required --watch --fail-fast
gh run list --workflow "Validate MediaGo" --commit "$(git rev-parse HEAD)" --event pull_request --limit 1 --json databaseId,status,conclusion,createdAt,updatedAt,headSha
gh run view "$(gh run list --workflow "Validate MediaGo" --commit "$(git rev-parse HEAD)" --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId')" --json conclusion,createdAt,updatedAt,jobs --exit-status
gh run list --workflow "Validate MediaGo" --commit "$(git rev-parse HEAD)" --event pull_request --limit 1 --json createdAt,updatedAt --jq '.[0] | ((.updatedAt | fromdateiso8601) - (.createdAt | fromdateiso8601))'
git status --short --branch
```

Expected: all required PR checks PASS; the last command reports the complete `Validate MediaGo` workflow wall-clock duration below 600 seconds; the branch is clean and synchronized with `origin/codex/automated-testing`.
