# Three-Surface Playwright V1 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic Linux x64 Playwright coverage for MediaGo Web, Electron, and the standalone MV3 extension, with every download using the committed localhost MP4 fixture.

**Architecture:** One root Playwright runner owns three serial projects. Small support modules own processes, ports, local media, Core, network policy, and artifacts; Web and Electron each drive the real UI, while the extension drives its real Options, MV3 worker, Badge, Popup, and desktop HTTP submission. Two focused Electron production corrections make the real app testable without backdoors: deterministic Core shutdown and lazy EasyList loading.

**Tech Stack:** TypeScript 7, Playwright 1.61.1, Vitest 4, Electron 41, React 19, Go 1.25, pnpm/Turbo, GitHub Actions

**Constraints:** Work only on `codex/automated-testing`; do not merge or create another worktree. Store plans under `plans/`, never `docs/`. Keep the complete GitHub workflow under ten minutes and the E2E job under eight minutes. Do not access Bilibili, YouTube, or external media.

**Reference spec:** `plans/specs/2026-08-17-three-surface-playwright-design.md`

---

## Chunk 1: Toolchain and production-safe lifecycle prerequisites

### Task 1: Pin and isolate the Playwright toolchain

**Files:**

- Create: `scripts/ci/e2e-toolchain.test.ts`
- Create: `playwright.config.ts`
- Create: `tsconfig.e2e.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.gitignore`

- [ ] **Step 1: Write the failing toolchain contract**

Create `scripts/ci/e2e-toolchain.test.ts`. Resolve the repository root from `import.meta.url`, parse `package.json`, and assert:

```ts
expect(pkg.devDependencies["@playwright/test"]).toBe("1.61.1");
expect(pkg.devDependencies.playwright).toBe("1.61.1");
expect(pkg.scripts["test:e2e:setup:deps"]).toContain("--tools aria2");
expect(pkg.scripts["test:e2e:build:core"]).toBe(
  "cd apps/core && go build -o bin/mediago-core ./cmd/server",
);
expect(pkg.scripts["type:check:e2e"]).toBe("tsc -p tsconfig.e2e.json");
expect(await readFile(path.join(root, ".gitignore"), "utf8")).toContain(
  "playwright-report/",
);
```

Also assert the focused commands select `web`, `electron`, and `extension` by project name and that setup does not mention `N_m3u8DL-RE` or `ffmpeg`.

- [ ] **Step 2: Run the contract and verify RED**

Run:

```bash
pnpm exec vitest run scripts/ci/e2e-toolchain.test.ts
```

Expected: FAIL because Playwright dependencies, scripts, and ignore entries do not exist.

- [ ] **Step 3: Install exact dependencies and add scripts**

Run:

```bash
pnpm add -Dw @playwright/test@1.61.1 playwright@1.61.1
```

Add these root scripts without changing the existing media-integration scripts:

```json
{
  "test:e2e:setup:deps": "tsx scripts/download-deps.ts --tools aria2",
  "test:e2e:setup:browser": "playwright install chromium",
  "test:e2e:setup": "pnpm test:e2e:setup:deps && pnpm test:e2e:setup:browser",
  "test:e2e:build:core": "cd apps/core && go build -o bin/mediago-core ./cmd/server",
  "test:e2e:build": "pnpm test:e2e:build:core && cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/server -F @mediago/electron -F @mediago/electron-preload -F @mediago/extension",
  "test:e2e": "playwright test",
  "test:e2e:web": "playwright test --project=web",
  "test:e2e:electron": "playwright test --project=electron",
  "test:e2e:extension": "playwright test --project=extension",
  "test:e2e:ui": "playwright test --ui",
  "type:check:e2e": "tsc -p tsconfig.e2e.json"
}
```

Add `playwright-report/` and `test-results/` to `.gitignore`.

- [ ] **Step 4: Add the root Playwright configuration**

Create `playwright.config.ts` with these exact behavioral settings:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "test-results",
  timeout: 60_000,
  globalTimeout: process.env.CI ? 180_000 : 240_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ],
  use: {
    locale: "en-US",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "web", testMatch: /web\/.*\.spec\.ts/ },
    { name: "electron", testMatch: /electron\/.*\.spec\.ts/ },
    { name: "extension", testMatch: /extension\/.*\.spec\.ts/ },
  ],
});
```

Do not add top-level `webServer` entries; focused extension runs must not start either UI renderer.

- [ ] **Step 5: Add the dedicated E2E TypeScript project**

Create `tsconfig.e2e.json` extending `tsconfig.node.json`, with `noEmit`, `strict`, `lib: ["ES2023", "DOM"]`, `module: "ESNext"`, `moduleResolution: "Bundler"`, and source paths for clean-checkout type resolution:

```json
{
  "compilerOptions": {
    "noEmit": true,
    "strict": true,
    "lib": ["ES2023", "DOM"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "paths": {
      "@mediago/core-sdk": ["./packages/core-sdk/src/index.ts"],
      "@mediago/shared-common": ["./packages/shared/common/src/index.ts"]
    },
    "types": ["node", "@playwright/test"]
  },
  "include": ["playwright.config.ts", "tests/e2e/**/*.ts"],
  "exclude": []
}
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run scripts/ci/e2e-toolchain.test.ts
pnpm type:check:e2e
pnpm exec oxfmt --check package.json playwright.config.ts tsconfig.e2e.json scripts/ci/e2e-toolchain.test.ts .gitignore
git diff --check
```

Expected: contract and type check PASS. `playwright test --list` is deferred until the first spec exists.

Commit only this task:

```bash
git add package.json pnpm-lock.yaml .gitignore playwright.config.ts tsconfig.e2e.json scripts/ci/e2e-toolchain.test.ts
git commit -m "test(e2e): add pinned Playwright toolchain"
```

### Task 2: Isolate Web server runtime state

**Files:**

- Create: `apps/server/src/server-paths.ts`
- Create: `apps/server/src/server-paths.test.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Write the failing path-resolution tests**

Create `server-paths.test.ts` with a pure helper contract:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerPaths } from "./server-paths";

describe("resolveServerPaths", () => {
  it("keeps the existing home default", () => {
    expect(
      resolveServerPaths({ appName: "mediago", homeDir: "/home/test" }),
    ).toMatchObject({ root: path.resolve("/home/test/.mediago-server") });
  });

  it("places every persistent path under the explicit override", () => {
    const paths = resolveServerPaths({
      appName: "mediago",
      homeDir: "/home/test",
      rootOverride: "/tmp/e2e-root",
    });
    expect(paths).toEqual({
      root: path.resolve("/tmp/e2e-root"),
      data: path.resolve("/tmp/e2e-root/data"),
      logs: path.resolve("/tmp/e2e-root/logs"),
      downloads: path.resolve("/tmp/e2e-root/downloads"),
      database: path.resolve("/tmp/e2e-root/data/mediago.db"),
    });
  });
});
```

- [ ] **Step 2: Run focused RED**

Run `pnpm exec vitest run apps/server/src/server-paths.test.ts`.

Expected: FAIL because `server-paths.ts` is missing.

- [ ] **Step 3: Implement the pure path helper and wire the launcher**

Implement only the five paths above. Treat an undefined or whitespace-only override as absent; preserve the existing `~/.<APP_NAME>-server` default. In `apps/server/src/index.ts`, replace the module-level path constants with:

```ts
const serverPaths = resolveServerPaths({
  appName: process.env.APP_NAME,
  homeDir: os.homedir(),
  rootOverride: process.env.MEDIAGO_SERVER_ROOT,
});
```

Use `serverPaths.data`, `.logs`, `.downloads`, and `.database` everywhere else. Do not change auth, port `9900`, Core arguments, or shutdown behavior.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run apps/server/src/server-paths.test.ts
pnpm exec turbo run type:check -F @mediago/server
pnpm exec oxfmt --check apps/server/src/server-paths.ts apps/server/src/server-paths.test.ts apps/server/src/index.ts
git diff --check
```

Expected: focused tests and Server type check PASS.

Commit:

```bash
git add apps/server/src/server-paths.ts apps/server/src/server-paths.test.ts apps/server/src/index.ts
git commit -m "feat(server): isolate runtime root"
```

### Task 3: Defer EasyList until the built-in browser needs it

**Files:**

- Create: `apps/electron/src/services/ad-blocker-loader.ts`
- Create: `apps/electron/src/services/ad-blocker-loader.test.ts`
- Create: `apps/electron/src/services/webview.service.test.ts`
- Modify: `apps/electron/src/services/webview.service.ts`

- [ ] **Step 1: Write failing lazy-loader tests**

Define a small generic `AdBlockerLoader<T>` contract. Tests must prove the factory is not called by construction, concurrent/repeated `load()` calls use one promise, and rejection is contained and reported once:

```ts
const factory = vi.fn(async () => ({ enabled: true }));
const onError = vi.fn();
const loader = new AdBlockerLoader(factory, onError);
expect(factory).not.toHaveBeenCalled();
await expect(Promise.all([loader.load(), loader.load()])).resolves.toEqual([
  { enabled: true },
  { enabled: true },
]);
await expect(loader.load()).resolves.toEqual({ enabled: true });
expect(factory).toHaveBeenCalledTimes(1);

const failure = new AdBlockerLoader(async () => {
  throw new Error("offline");
}, onError);
await expect(failure.load()).resolves.toBeUndefined();
await expect(failure.load()).resolves.toBeUndefined();
expect(onError).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Write the failing Webview integration test**

Before dynamically importing `WebviewService`, hoist all clean-checkout-safe resolution mocks:

```ts
vi.mock("node:module", () => ({
  createRequire: () =>
    Object.assign(() => undefined, { resolve: () => "/tmp/preload.cjs" }),
}));
vi.mock("../utils", () => ({
  isDeeplink: () => false,
  mobileUA: "mobile-test-agent",
  pcUA: "desktop-test-agent",
  PERSIST_WEBVIEW: "persist:default",
  PRIVACY_WEBVIEW: "persist:privacy",
  pluginUrl: "/tmp/plugin.js",
}));
```

Also mock `electron` session/WebContentsView, `@ghostery/adblocker-electron`, `BrowserWindow`, and `MainWindow`; then dynamically import and instantiate `WebviewService` with minimal fake collaborators. This is required because ignored `@mediago/electron-preload` and `@mediago/browser-extension` build outputs do not exist in a clean checkout. Assert `fromLists` is not called by construction. Set `configCache.get("blockAds")` to `true`, call `await service.loadURL("http://127.0.0.1/page")` twice, and assert:

```ts
expect(fromLists).toHaveBeenCalledTimes(1);
expect(blocker.enableBlockingInSession).toHaveBeenCalledTimes(1);
expect(webContents.loadURL).toHaveBeenLastCalledWith("http://127.0.0.1/page");
```

Add a rejected `fromLists` case proving `loadURL` still proceeds and the logger receives exactly `[AdBlocker] list load failed` once, without the thrown message or an unhandled rejection. Add a deferred-factory race: call `setBlocking(true)`, then `setBlocking(false)` before resolving the factory; after resolution, `enableBlockingInSession` must still be untouched.

- [ ] **Step 3: Run focused RED**

Run:

```bash
pnpm exec vitest run apps/electron/src/services/ad-blocker-loader.test.ts apps/electron/src/services/webview.service.test.ts
```

Expected: FAIL because the loader does not exist and Webview construction still starts `fromLists`.

- [ ] **Step 4: Implement the memoized loader**

Create `AdBlockerLoader<T>` with a single private `Promise<T | undefined> | null`. `load()` memoizes `factory().catch(...)`; the catch calls `onError` and resolves `undefined`, so callers never create unhandled rejections.

In `WebviewService`:

- remove `this.initBlocker()` from the constructor
- replace `initBlocker()` with an `AdBlockerLoader<ElectronBlocker>` field whose factory calls `ElectronBlocker.fromLists(fetch, [EASYLIST_URL])`
- make `loadURL` return `Promise<void>` and, when `configCache.get("blockAds")` is true, await a private `enableBlocking()` before navigating
- make `enableBlocking()` load once, assign `this.blocker`, and enable it only if not already enabled for the current session
- track the latest requested blocking state; after awaiting the loader, re-check that state before enabling so a later `setBlocking(false)` wins
- keep `setBlocking(false)` synchronous; for `true`, call `void this.enableBlocking()` because the loader contains its own rejection
- log exactly `[AdBlocker] list load failed`; do not include the rejected error, response body, headers, or URL

Do not bundle a new EasyList file and do not add an E2E-only environment switch.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run apps/electron/src/services/ad-blocker-loader.test.ts apps/electron/src/services/webview.service.test.ts
pnpm exec turbo run type:check -F @mediago/electron
pnpm exec oxfmt --check apps/electron/src/services/ad-blocker-loader.ts apps/electron/src/services/ad-blocker-loader.test.ts apps/electron/src/services/webview.service.ts apps/electron/src/services/webview.service.test.ts
git diff --check
```

Expected: all focused tests and Electron type check PASS.

Commit:

```bash
git add apps/electron/src/services/ad-blocker-loader.ts apps/electron/src/services/ad-blocker-loader.test.ts apps/electron/src/services/webview.service.ts apps/electron/src/services/webview.service.test.ts
git commit -m "fix(electron): defer ad blocker loading"
```

### Task 4: Give DownloaderServer an idempotent stop lifecycle

**Files:**

- Create: `apps/electron/src/services/downloader.server.test.ts`
- Modify: `apps/electron/src/services/downloader.server.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Before dynamically importing `DownloaderServer`, mock `@mediago/service-runner`, `@mediago/core-sdk`, `../utils/binaryResolver`, and `../vendor/ElectronLogger`. The binary-resolver/logger mocks are mandatory in a clean checkout: they prevent Electron runtime evaluation, `APP_NAME` lookup, and resolution of ignored preload/extension outputs. Then start the server with fake paths and assert the created runner and task event stream are retained. Invoke the registered `download-start` listener on the mocked stream so the real `startPolling()` creates its interval. Then call `stop()` twice concurrently and once after completion. Verify:

```ts
expect(events.close).toHaveBeenCalledTimes(1);
expect(runner.stop).toHaveBeenCalledTimes(1);
expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
expect(() => server.getClient()).toThrow("DownloaderServer not started");
expect(await server.getURL()).toBe("");
```

Add a runner-stop rejection case: both concurrent callers observe the rejection, state is still cleared, and a later `stop()` is a no-op. Do not assert private fields directly.

- [ ] **Step 2: Run focused RED**

Run `pnpm exec vitest run apps/electron/src/services/downloader.server.test.ts`.

Expected: FAIL because `DownloaderServer.stop()` and retained runner/event fields do not exist.

- [ ] **Step 3: Implement minimal ownership and stop**

Add these fields:

```ts
private runner: ServiceRunner | null = null;
private events: TaskEventEmitter | null = null;
private stopping: Promise<void> | null = null;
```

Store the runner during `start()`, store the value returned by `streamEvents()`, and attach existing listeners to that stored emitter. Implement `stop()` so it:

1. returns the in-flight `stopping` promise when present
2. synchronously stops polling, closes/removes the event stream, nulls client/runner/events, and clears `serverUrl`
3. awaits exactly one captured runner `stop()`
4. clears the `stopping` slot in `finally`

If `start()` fails, clear the retained runner before rethrowing; rely on `ServiceRunner.start()`'s existing failed-start cleanup rather than stopping twice.

- [ ] **Step 4: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run apps/electron/src/services/downloader.server.test.ts
pnpm exec turbo run type:check -F @mediago/electron
pnpm exec oxfmt --check apps/electron/src/services/downloader.server.ts apps/electron/src/services/downloader.server.test.ts
git diff --check
```

Commit:

```bash
git add apps/electron/src/services/downloader.server.ts apps/electron/src/services/downloader.server.test.ts
git commit -m "fix(electron): own downloader shutdown"
```

### Task 5: Await Electron cleanup before quitting

**Files:**

- Create: `apps/electron/src/lifecycle.ts`
- Create: `apps/electron/src/lifecycle.test.ts`
- Modify: `apps/electron/src/app.ts`
- Modify: `apps/electron/src/index.ts`

- [ ] **Step 1: Write the failing quit coordinator tests**

Test a pure `registerGracefulQuit` helper with an `on("before-quit")` app double. Capture the listener and assert:

```ts
listener(firstEvent);
listener(secondEvent);
expect(firstEvent.preventDefault).toHaveBeenCalledTimes(1);
expect(secondEvent.preventDefault).toHaveBeenCalledTimes(1);
expect(shutdown).toHaveBeenCalledTimes(1);
expect(app.quit).not.toHaveBeenCalled();

resolveShutdown();
await flushPromises();
expect(app.quit).toHaveBeenCalledTimes(1);

listener(thirdEvent);
expect(thirdEvent.preventDefault).not.toHaveBeenCalled();
```

Add a rejected-shutdown test proving `onError` is called and the second quit still occurs, so a cleanup error cannot strand the application.

- [ ] **Step 2: Run focused RED**

Run `pnpm exec vitest run apps/electron/src/lifecycle.test.ts`.

Expected: FAIL because the lifecycle helper is missing.

- [ ] **Step 3: Implement the coordinator and application hook**

`registerGracefulQuit` owns two booleans/promises only: first `before-quit` prevents default and starts one shutdown; repeated events while stopping also prevent default; completion or failure marks the resumed quit and calls `app.quit()` once; the resumed event is allowed through.

Add to `ElectronApp`:

```ts
async shutdown(): Promise<void> {
  await this.downloaderServer.stop();
}
```

In `apps/electron/src/index.ts`, register the coordinator before `void start()` with a callback that safely reads the current `mediagoApp`:

```ts
registerGracefulQuit(
  app,
  async () => mediagoApp?.shutdown(),
  (error) => console.error("Electron shutdown failed", error),
);
```

Do not add `process.exit()` and do not change tray/window-close semantics.

- [ ] **Step 4: Verify the complete production-prerequisite chunk**

Run:

```bash
pnpm exec vitest run apps/electron/src/lifecycle.test.ts apps/electron/src/services/downloader.server.test.ts apps/electron/src/services/ad-blocker-loader.test.ts apps/electron/src/services/webview.service.test.ts apps/server/src/server-paths.test.ts
pnpm exec turbo run type:check -F @mediago/electron
pnpm exec turbo run type:check -F @mediago/server
pnpm test:ts
git diff --check
```

Expected: focused tests and full Vitest suite PASS; no test performs an external request.

- [ ] **Step 5: Commit**

```bash
git add apps/electron/src/lifecycle.ts apps/electron/src/lifecycle.test.ts apps/electron/src/app.ts apps/electron/src/index.ts
git commit -m "fix(electron): await Core shutdown on quit"
```

## Chunk 2: Local E2E harness and three user-visible scenarios

### Task 6: Build the bounded localhost runtime harness

**Files:**

- Create: `tests/e2e/support/process.ts`
- Create: `tests/e2e/support/process.test.ts`
- Create: `tests/e2e/support/ports.ts`
- Create: `tests/e2e/support/ports.test.ts`
- Create: `tests/e2e/support/media.ts`
- Create: `tests/e2e/support/media.test.ts`
- Create: `tests/e2e/support/network.ts`
- Create: `tests/e2e/support/network.test.ts`
- Create: `tests/e2e/support/core-process.ts`
- Create: `tests/e2e/support/server-process.ts`
- Create: `tests/e2e/support/ui-process.ts`
- Create: `tests/e2e/support/test-page.ts`
- Create: `tests/e2e/support/artifacts.ts`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Expose support-unit tests to Vitest and write RED tests**

Add only `tests/e2e/support/**/*.test.ts` to the Vitest include list. Do not include `tests/e2e/**/*.spec.ts`.

Write focused tests for these contracts:

```ts
expect(redactDiagnostic("Cookie: abc\nhttp://u:p@proxy.invalid/x")).toBe(
  "Cookie: [REDACTED]\nhttp://[REDACTED]@proxy.invalid/x",
);
expect(
  redactDiagnostic(
    'X-API-Key: key-123\n{"apiKey":"key-456"}\nmediago-e2e-password',
  ),
).not.toMatch(/key-123|key-456|mediago-e2e-password/);
await expect(
  assertPortFree("127.0.0.1", occupiedPort, "Web Core"),
).rejects.toThrow(new RegExp(`Web Core.*${occupiedPort}`));
expect(isAllowedBrowserURL("http://127.0.0.1:8501/")).toBe(true);
expect(isAllowedBrowserURL("chrome-extension://abc/popup.html")).toBe(true);
expect(isAllowedBrowserURL("https://example.com/video.mp4")).toBe(false);
```

Start the committed media service and assert `loadMediaFixture()` returns the manifest's `sample.mp4` size/SHA and that `verifyFixtureCopy(tempDir)` accepts a copied sample but rejects a modified file. For `ManagedProcess`, spawn `process.execPath -e "setInterval(() => {}, 1000)"`, stop it, and assert its process group exits within the helper deadline. Add a second child with a never-ready URL and a 100 ms startup deadline; `startManagedProcess` must reject only after that child/process group is gone.

- [ ] **Step 2: Run support tests and verify RED**

Run:

```bash
pnpm exec vitest run tests/e2e/support
```

Expected: FAIL because the support modules do not exist.

- [ ] **Step 3: Implement bounded process and port ownership**

`process.ts` exports:

```ts
export interface ManagedProcess {
  readonly pid: number;
  logTail(): string;
  stop(): Promise<void>;
}

export async function startManagedProcess(options: {
  label: string;
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  readinessURL?: string;
  startupTimeoutMs?: number;
}): Promise<ManagedProcess>;

export function redactDiagnostic(value: string): string;
```

Spawn detached with piped stdout/stderr, keep only the last 16 KiB after redacting Authorization/Cookie/Proxy-Authorization, `X-API-Key`/`apiKey`, proxy userinfo, and the fixed `mediago-e2e-password`. Fail startup immediately if the process exits. Readiness polling uses 100 ms intervals and a deadline, never a fixed sleep. If spawn/readiness fails before a handle can be returned, terminate and await the owned process group before rethrowing the bounded startup error. `stop()` sends SIGTERM to the owned process group, waits three seconds, then SIGKILL and waits two seconds; ESRCH is success.

`ports.ts` exports `assertPortFree(host, port, owner)`, `waitForPortFree(host, port, timeoutMs)`, and `reserveLoopbackPort()`. Errors name both owner and port. Never treat an existing healthy response as reusable.

- [ ] **Step 4: Implement media and network helpers**

`media.ts` wraps `startMediaServer()` from `tests/media-service/server.ts`, reads `tests/media-service/public/v1/manifest.json`, and returns:

```ts
export interface MediaFixture {
  baseURL: string;
  sampleURL: string;
  sample: { size: number; sha256: string };
  close(): Promise<void>;
}
```

`verifyFixtureCopy(directory)` recursively examines regular files, computes SHA-256, and returns the unique file matching both committed size and hash. It throws a bounded directory-summary error for zero or multiple matches; it never assumes an output extension.

`network.ts` exports `isAllowedBrowserURL`, `guardBrowserContext`, and `assertNoBlockedRequests`. Permit `about:`, `blob:`, `data:`, `chrome-extension:`, and HTTP(S) whose hostname is `localhost`, `127.0.0.1`, or `::1`. `guardBrowserContext` registers `context.route("**/*", ...)`, aborts disallowed HTTP(S), and stores only redacted origin/path strings for the final assertion.

- [ ] **Step 5: Implement product launchers**

`core-process.ts` validates Linux x64 plus executable `.deps/linux-x64/aria2c`, creates `config`, `logs`, `downloads`, and SQLite paths under the supplied runtime root, and starts `apps/core/bin/mediago-core` on the requested port with:

```text
--port <requestedPort>
--deps-dir <repo>/.deps/linux-x64
--local-dir <root>/downloads
--config-dir <root>/config
--log-dir <root>/logs
--db-path <root>/data/mediago.db
--max-runner 1
--log-level error
```

Return the `ManagedProcess`, a `MediaGoClient` with Axios `proxy = false`, `baseURL`, and `downloadDirectory`. Pass `HOST=127.0.0.1` and `PORT=<requestedPort>` in the child environment as well as the explicit port argument, so test Core never binds a LAN interface. Do not replace `HOME`; remove inherited proxy variables and set only `NO_PROXY/no_proxy` for localhost/private Core access.

`server-process.ts` asserts `9900` free, starts `node apps/server/build/index.js`, strips inherited proxy variables, sets `MEDIAGO_SERVER_ROOT`, `MEDIAGO_DEPS_DIR`, and local no-proxy variables, then waits for `http://127.0.0.1:9900/healthy`.

`ui-process.ts` asserts the selected fixed port free and starts only one command:

```text
pnpm --filter @mediago/ui exec vite --host 127.0.0.1
```

Set `APP_TARGET=server` for `8501` or `APP_TARGET=electron` for `8500`; readiness URL is the matching loopback origin.

`test-page.ts` starts an OS-assigned loopback HTTP server. Its single HTML page has title `MediaGo E2E Fixture`, performs one `fetch(sampleURL)` on load, consumes the body, and exposes `window.fixtureMediaLoaded = true` or a bounded error string.

- [ ] **Step 6: Implement failure artifacts**

`artifacts.ts` exports helpers to attach bounded process/Core logs and manage manual contexts. Each scenario catches its primary error into `let primaryError: unknown`; finalization receives `failed: primaryError !== undefined` rather than reading `testInfo.status` inside the still-running test. For Electron and persistent Chromium:

1. set `artifactsDir`/`recordVideo.dir` below `testInfo.outputPath()` at launch
2. call `context.tracing.start({ screenshots: true, snapshots: true, sources: true })`
3. before close, capture `failure.png` only when `failed` is true
4. stop trace to `trace.zip` only on failure, otherwise stop without a path
5. retain video handles, close the application/context, then `saveAs` on failure or `delete` on success
6. attach retained trace/video/logs through `testInfo.attach`

Attachments use only the fixed synthetic password and localhost responses; never attach storage dumps, complete environments, or unbounded headers.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```bash
pnpm exec vitest run tests/e2e/support
pnpm type:check:e2e
pnpm test:ts
pnpm exec oxfmt --check tests/e2e/support vitest.config.ts
git diff --check
```

Expected: support tests and full Vitest PASS; Playwright specs are not collected.

Commit:

```bash
git add tests/e2e/support vitest.config.ts
git commit -m "test(e2e): add local runtime harness"
```

### Task 7: Drive the authenticated Web download flow

**Files:**

- Create: `tests/e2e/web/download.spec.ts`
- Modify: `apps/ui/src/pages/home-page/components/download-item.tsx`

- [ ] **Step 1: Write the Web scenario**

Use the normal Playwright `page` fixture so configured trace/screenshot/video retention applies. In a single test with nested `try/finally` ownership:

1. create `mkdtemp(path.join(tmpdir(), "mediago-e2e-web-"))`
2. assert `8501` and `9900` free
3. start media, Web UI, and built Server in that order
4. install the browser-context network guard before navigation
5. open `http://127.0.0.1:8501/` and assert redirect to `/signin`
6. fill `Create an admin password` and `Confirm password` with the fixed synthetic value `mediago-e2e-password`, then click `Set up`
7. wait for `/` and click `New download`
8. click `Download now` while empty and assert the `Enter a video URL` alert is visible
9. open the `Download type` combobox and choose `Direct download (MP4)`
10. fill `Video name` with `web-e2e-sample` and `Video link` with `media.sampleURL`
11. click `Download now`, find `getByRole("article", { name: "web-e2e-sample" })`, and wait within it for `Download complete`
12. call `verifyFixtureCopy(<runtimeRoot>/downloads)` and `assertNoBlockedRequests`

Add `role="article"` and `aria-label={task.name}` to the outer task-card element in `apps/ui/src/pages/home-page/components/download-item.tsx`; this is a semantic accessibility seam shared by Web and Electron, not test-only state. In test cleanup explicitly call `page.close()` first, then stop Server, UI, media, and finally remove the runtime directory. If an assertion fails, attach both managed-process tails before rethrowing; cleanup errors are attached and do not replace the first failure.

- [ ] **Step 2: Provision/build once and run the focused scenario**

Run:

```bash
pnpm test:e2e:setup
pnpm test:e2e:build
pnpm test:e2e:web
```

Expected: 1 Web test PASS, the copied file matches the committed hash, and ports `8501`/`9900` are free afterward. If the first run is RED, fix only selector/readiness mistakes or a demonstrated product defect; do not route/mock Core APIs.

- [ ] **Step 3: Verify and commit**

Run:

```bash
pnpm type:check:e2e
pnpm test:e2e:web
git diff --check
```

Commit:

```bash
git add tests/e2e/web/download.spec.ts apps/ui/src/pages/home-page/components/download-item.tsx
git commit -m "test(e2e): cover Web direct download"
```

### Task 8: Drive Electron main/preload/renderer/Core and prove shutdown

**Files:**

- Create: `tests/e2e/support/electron-network.ts`
- Create: `tests/e2e/support/electron-network.test.ts`
- Create: `tests/e2e/electron/download.spec.ts`

- [ ] **Step 1: Test the owned-Core network policy**

Write pure tests for URL classification before adding Electron evaluation code. The provisional policy permits browser-internal schemes, loopback, and private IPv4 HTTP(S) only on `39719`; it rejects public IPs, hostnames, and other private ports. After `tighten(coreOrigin)`, the only non-loopback HTTP(S) origin accepted is the exact origin returned by preload. Recorded provisional requests must all match that origin.

Run `pnpm exec vitest run tests/e2e/support/electron-network.test.ts` and expect RED because the helper is missing.

- [ ] **Step 2: Implement the Electron session guard**

Export serializable policy functions plus `installElectronNetworkGuard(electronApp)`. Immediately after `_electron.launch()`, use `electronApp.evaluate(({ session }) => ...)` to register `defaultSession.webRequest.onBeforeRequest`. The callback:

- allows loopback/Vite/media URLs
- provisionally allows private IPv4 origin on port `39719` and records it
- cancels and records all other HTTP(S)
- allows browser-internal schemes

After preload returns `coreUrl`, call a second evaluator to set the exact origin and retrieve the provisional/blocked arrays. The Node-side assertion fails if any provisional origin differs from `coreUrl` or any blocked request exists. Store only origin/path, never headers.

- [ ] **Step 3: Write the Electron scenario**

The single test must:

1. create `mkdtemp(path.join(tmpdir(), "mediago-e2e-electron-"))`, create its `downloads` directory, start media and only the Electron UI on `8500`, and preflight `39719`
2. resolve Electron's executable from `apps/electron/package.json` using a package-scoped `createRequire`
3. call `_electron.launch({ executablePath, args: [absoluteMainPath], env, locale: "en-US", artifactsDir, recordVideo: { dir: videoDir } })`; the environment is copied from `process.env` with every inherited proxy variable and `LOAD_DEVTOOLS` removed, then receives temporary `XDG_CONFIG_HOME`, `MEDIAGO_DEPS_DIR`, `PORTABLE_EXECUTABLE_FILE`, and `NO_PROXY/no_proxy`
4. save the Electron PID, install the session guard before calling `firstWindow()`, and start manual tracing
5. assert the first window uses `http://localhost:8500/`, has title `MediaGo`, and that `window.electron.app.getEnvPath` exists
6. call that real preload method, normalize its IPC envelope, obtain `coreUrl`, tighten/validate the guard, and wait until its `/healthy` succeeds
7. create a `MediaGoClient` for `coreUrl`, disable Axios proxying, and call `setConfigKey("local", downloadDirectory)`; read the key back before using the UI
8. in the UI choose New download, explicitly select Direct, fill `electron-e2e-sample` plus `media.sampleURL`, click Download now, and wait for `getByRole("article", { name: "electron-e2e-sample" })` to contain `Download complete`
9. verify the fixture hash and final owned-origin guard state
10. pass `electronApp.close()` as the close callback to the manual-artifact finalizer; it must capture failure screenshot and stop trace first, invoke/await application close second, then save or delete videos; afterward wait for the saved PID to exit and assert `39719` becomes free

Always close Electron before UI/media cleanup, then remove the runtime root. `PORTABLE_EXECUTABLE_FILE` is a fixed synthetic path and is used only through existing production updater behavior.

- [ ] **Step 4: Run focused GREEN**

Run:

```bash
pnpm exec vitest run tests/e2e/support/electron-network.test.ts
pnpm type:check:e2e
xvfb-run -a pnpm test:e2e:electron
```

Expected: policy unit tests and 1 Electron test PASS; Electron PID is gone and `39719` is free.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/support/electron-network.ts tests/e2e/support/electron-network.test.ts tests/e2e/electron/download.spec.ts
git commit -m "test(e2e): cover Electron direct download"
```

### Task 9: Drive the standalone MV3 capture and download flow

**Files:**

- Create: `tests/e2e/extension/capture-and-download.spec.ts`
- Modify: `packages/mediago-extension/src/options/components/ServerCard.tsx`

- [ ] **Step 1: Add one accessible status seam**

Add `role="status"` and `aria-live="polite"` to both success and failure roots returned by `StatusInline`. This is an accessibility semantic, not an E2E backdoor. Do not add test-only messages, API hooks, or source URL rendering.

- [ ] **Step 2: Write the MV3 scenario**

The single test must:

1. create `mkdtemp(path.join(tmpdir(), "mediago-e2e-extension-"))`, start media, and prove `39719` is free; do not start either Vite UI
2. launch `chromium.launchPersistentContext(profileDir)` with `headless: false`, bundled Chromium, `--disable-extensions-except=<dist>`, `--load-extension=<dist>`, `locale: "en-US"`, and manual video/artifact directories
3. install the context network guard, start trace, then obtain the worker race-safely with `context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker")`; derive the extension ID from `worker.url()`
4. open `chrome-extension://<id>/src/options/index.html`, keep/select `Desktop · HTTP local`, and click `Test connection` while Core is absent; assert the real `role=status` is visible and does not say `connected`
5. start the real temporary Core on `39719`, click Test connection again, and assert status text `connected`
6. switch `Start downloading immediately` on through `getByRole("switch", { name: ... })`, wait for Saved, reload Options, and assert both the desktop radio and switch remain selected
7. create and load the Popup page first; then create the localhost fixture page, wait for `window.fixtureMediaLoaded === true`, and call `bringToFront()` on the fixture
8. poll the worker only for `chrome.tabs.query({ active: true, currentWindow: true })` plus `chrome.action.getBadgeText({ tabId })` until it returns `"1"`
9. reload the still-inactive Popup page without bringing it forward; assert the Popup contains `MediaGo E2E Fixture` and a `direct` type badge
10. click the source row's `Import` button and assert `Imported 1 task(s)`; until a 30-second deadline, call `core.client.getDownloadTasks({ current: 1, pageSize: 20 })`, read `response.data.list`, and locate the task named `MediaGo E2E Fixture`; return on `status === "success"`, fail immediately on `"failed"` or `"stopped"`, otherwise poll every 100 ms
11. verify the fixture hash and assert no blocked network requests; pass `context.close()` to the same ordered manual-artifact finalizer so screenshot/trace happen before close and video handling after; then stop Core/media, verify `39719` is free, and finally remove the runtime root

The worker is never asked for `GET_SOURCES`, never handed a fabricated source, and never told to import. The final hash is the URL proof because `SourceItem` intentionally shows title/type rather than raw URL.

- [ ] **Step 3: Run focused GREEN**

Run:

```bash
pnpm type:check:e2e
xvfb-run -a pnpm test:e2e:extension
```

Expected: 1 extension test PASS; no Vite listener starts; Options persistence, Badge, Popup, Core task success, and file hash all pass.

- [ ] **Step 4: Verify Chunk 2 together and commit**

Run:

```bash
pnpm exec vitest run tests/e2e/support
pnpm type:check:e2e
xvfb-run -a pnpm test:e2e
pnpm test:ts
git diff --check
```

Expected: support unit tests, three serial Playwright tests, and full Vitest PASS. The Playwright line reporter shows exactly one test per project and finishes below the three-minute cap.

Commit the extension scenario and accessibility seam:

```bash
git add packages/mediago-extension/src/options/components/ServerCard.tsx tests/e2e/extension/capture-and-download.spec.ts
git commit -m "test(e2e): cover MV3 capture and download"
```

## Chunk 3: CI gate, full verification, and PR delivery

### Task 10: Require the three-surface suite in CI

**Files:**

- Create: `scripts/ci/e2e-workflow.test.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing workflow contract**

Read `.github/workflows/ci.yml` as text and extract two bounded sections before asserting them:

```ts
const e2eJob = workflow.match(
  /^  test-e2e:\n([\s\S]*?)(?=^  [a-z][\w-]*:\n)/m,
)?.[0];
const gateJob = workflow.match(/^  pr-gate:\n([\s\S]*)$/m)?.[0];

expect(e2eJob).toBeDefined();
expect(gateJob).toBeDefined();
```

On `e2eJob`, assert the exact `name: Test three-surface Playwright`, `timeout-minutes: 8`, full `path: .deps`, and a distinct `e2e-deps-...` key containing `runner.os`, `runner.arch`, and `hashFiles('scripts/deps-versions.json')`. Assert the Playwright cache path and key contain `~/.cache/ms-playwright`, OS, arch, and `hashFiles('pnpm-lock.yaml')`. Compare string indices to prove these two unconditional commands both exist and remain ordered:

```text
pnpm exec playwright install-deps chromium
pnpm exec playwright install chromium
```

Also assert the job contains dependency setup, E2E typecheck/build/run, and an `actions/upload-artifact@v4` step with `if: failure()`, both `playwright-report` and `test-results`, plus `retention-days: 3`.

On `gateJob`, assert the complete explicit contract remains intact: `needs` contains `quality`, `test-ts`, `test-go`, `test-media-integration`, and `test-e2e`; its environment contains all five corresponding result expressions; and its shell loop enumerates all five labels. Keep the test intentionally textual and dependency-free, but scope every assertion to the owning job.

- [ ] **Step 2: Run focused RED**

Run:

```bash
pnpm exec vitest run scripts/ci/e2e-workflow.test.ts
```

Expected: FAIL because `test-e2e` and `E2E_RESULT` are absent.

- [ ] **Step 3: Add the eight-minute E2E job**

Add one `test-e2e` job named `Test three-surface Playwright` using the same checkout/pnpm 10.15/Node 24.14/Go 1.25 setup as media integration. Keep `timeout-minutes: 8` and use this order:

1. checkout and runtime setup
2. `pnpm install --frozen-lockfile`
3. cache the entire `.deps` directory with a distinct `e2e-deps-...` key using OS/arch plus `scripts/deps-versions.json`
4. cache `~/.cache/ms-playwright` using OS/arch plus `hashFiles('pnpm-lock.yaml')`
5. `pnpm test:e2e:setup:deps` with read-only `${{ github.token }}`
6. always run `pnpm exec playwright install-deps chromium`
7. run `pnpm exec playwright install chromium` so a cache miss is repaired
8. `pnpm type:check:e2e`
9. `pnpm test:e2e:build`
10. `xvfb-run -a pnpm test:e2e`
11. on `failure()`, upload `playwright-report` and `test-results` with `retention-days: 3`

Do not reuse the media-integration setup command because it provisions HLS tools. Do not upload success artifacts or pass repository/user secrets into Playwright.

- [ ] **Step 4: Make `pr-gate` check the result explicitly**

Add `test-e2e` to `needs`, add:

```yaml
E2E_RESULT: ${{ needs.test-e2e.result }}
```

and add `"test-e2e:$E2E_RESULT"` to the existing enumerated shell loop. Keep every existing gate result.

- [ ] **Step 5: Verify GREEN, YAML syntax, and commit**

Run:

```bash
pnpm exec vitest run scripts/ci/e2e-workflow.test.ts scripts/ci/e2e-toolchain.test.ts
pnpm exec oxfmt --check .github/workflows/ci.yml scripts/ci/e2e-workflow.test.ts
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml", aliases: true); puts "yaml ok"'
git diff --check
```

Expected: contracts PASS, Ruby prints `yaml ok`, formatting/diff checks PASS.

Commit:

```bash
git add .github/workflows/ci.yml scripts/ci/e2e-workflow.test.ts
git commit -m "ci: require three-surface Playwright tests"
```

### Task 11: Run the complete local release-gate matrix

**Skills:**

- REQUIRED: `@superpowers:verification-before-completion`
- REQUIRED: `@superpowers:requesting-code-review`
- REQUIRED on any failure: `@superpowers:systematic-debugging`

- [ ] **Step 1: Verify branch, identity, and scope**

Run:

```bash
test "$(git branch --show-current)" = "codex/automated-testing"
git var GIT_AUTHOR_IDENT
git var GIT_COMMITTER_IDENT
git status --short --branch
git diff --check origin/codex/automated-testing..HEAD
```

Expected: correct branch; author/committer `caorushizi <84996057@qq.com>`; no unrelated changes and no files under `docs/`.

- [ ] **Step 2: Run all focused and full local checks with fresh evidence**

Run each command separately and preserve its exit code/timing:

```bash
pnpm type:check:e2e
pnpm test:ts
pnpm test:go
pnpm test:integration:media
pnpm check
pnpm test:e2e:setup
pnpm test:e2e:build
/usr/bin/time -p xvfb-run -a pnpm test:e2e
git diff --check
```

Expected:

- Vitest includes support-unit tests but no `*.spec.ts`
- Go and existing MP4/HLS integration PASS
- lint/format/all TypeScript checks PASS with no new warnings/errors
- Playwright reports exactly three tests, one per project, with real wall time below 180 seconds
- no owned process remains and ports `8500`, `8501`, `9900`, `39719` are free

If sandbox loopback/Electron restrictions cause EPERM, rerun the exact affected verification outside the sandbox; do not weaken the test.

- [ ] **Step 3: Request independent code review**

Dispatch a fresh reviewer with the approved spec, this plan, and the full implementation diff. Require review of:

- process cleanup on every startup/assertion failure
- redaction and artifact retention
- no external request paths
- Electron shutdown and EasyList races
- Web auth plus explicit Direct selection
- Electron preload/Core ownership and LAN-origin guard
- MV3 active-tab/Badge/Popup flow without internal dispatch
- CI cache, timeout, and explicit gate semantics

Fix every verified Critical/Important issue through focused RED/GREEN steps. Re-run affected focused tests, commit each verified review fix with the required identity, then rerun the complete Step 2 release-gate matrix. Repeat review until the final implementation diff is approved. Record reasoned pushback for suggestions that conflict with the approved V1 scope.

- [ ] **Step 4: Mark the implementation plan complete and commit only the plan update**

After all implementation tasks and review are green, mark Tasks 1–10 and Task 11 Steps 1–3 complete. Leave this plan-commit step and the future push/final-state steps unchecked so the committed record never claims future work is complete. Format this file and verify the staged diff is only the plan:

```bash
pnpm exec oxfmt --write plans/implementation/2026-08-17-three-surface-playwright-v1.md
git add plans/implementation/2026-08-17-three-surface-playwright-v1.md
git diff --cached --check
git commit -m "docs(test): complete Playwright V1 plan"
```

- [ ] **Step 5: Push the existing branch and measure PR checks**

Push without merging or creating another branch. Run this as one Bash process so the bounded discovery state is retained:

```bash
set -euo pipefail
test "$(git branch --show-current)" = "codex/automated-testing"
PUSHED_SHA="$(git rev-parse HEAD)"
git push origin codex/automated-testing

RUN_ID=""
deadline=$((SECONDS + 150))
while ((SECONDS < deadline)); do
  if candidate="$(gh run list --workflow "Validate MediaGo" --commit "$PUSHED_SHA" --event pull_request --limit 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null)"; then
    RUN_ID="$candidate"
  fi
  if [[ -n "$RUN_ID" ]]; then
    break
  fi
  sleep 5
done
if [[ -z "$RUN_ID" ]]; then
  echo "No pull_request workflow run found for $PUSHED_SHA within 150 seconds" >&2
  exit 1
fi

RUN_HEAD="$(gh run view "$RUN_ID" --json headSha --jq .headSha)"
if [[ "$RUN_HEAD" != "$PUSHED_SHA" ]]; then
  echo "Workflow head $RUN_HEAD does not match pushed head $PUSHED_SHA" >&2
  exit 1
fi

gh run watch "$RUN_ID" --exit-status
gh run view "$RUN_ID" --json conclusion,createdAt,updatedAt,jobs --exit-status

RUN_JSON="$(gh run view "$RUN_ID" --json conclusion,createdAt,updatedAt,jobs)"
RUN_JSON="$RUN_JSON" node --input-type=module -e '
  const run = JSON.parse(process.env.RUN_JSON ?? "");
  const e2e = run.jobs.find((job) => job.name === "Test three-surface Playwright");
  if (!e2e) throw new Error("test-e2e job is missing from the completed workflow");
  const e2eSeconds = (Date.parse(e2e.completedAt) - Date.parse(e2e.startedAt)) / 1000;
  const workflowSeconds = (Date.parse(run.updatedAt) - Date.parse(run.createdAt)) / 1000;
  console.log(JSON.stringify({ conclusion: run.conclusion, e2eSeconds, workflowSeconds }));
  if (
    run.conclusion !== "success" ||
    !Number.isFinite(e2eSeconds) ||
    !Number.isFinite(workflowSeconds) ||
    e2eSeconds >= 480 ||
    workflowSeconds >= 600
  ) process.exit(1);
'
```

The Node assertion must exit non-zero unless the E2E job is `<480` seconds, the whole workflow is `<600` seconds, and the conclusion is `success`. If a budget assertion fails, diagnose the measured duplicate setup/build work, add a focused failing contract where applicable, implement and commit the correction, rerun the complete Step 2 local matrix, obtain fresh independent approval under Step 3, push the new SHA, and repeat this entire bounded monitoring block. Do not declare completion from an older run.

- [ ] **Step 6: Final state check**

Run:

```bash
git status --short --branch
PR_BASE_SHA="$(gh pr view 718 --json baseRefOid --jq .baseRefOid)"
PR_MERGE_BASE="$(git merge-base "$PR_BASE_SHA" HEAD)"
test -n "$PR_MERGE_BASE"
git log --format='%h %an <%ae> | %cn <%ce> | %s' "$PR_MERGE_BASE"..HEAD
gh pr view 718 --json state,mergedAt,headRefName,headRefOid,baseRefOid
```

Expected: working tree clean; local branch synchronized after push; every commit in the PR range uses the correct identity; PR #718 is still open with `mergedAt: null`, head `codex/automated-testing`, and `headRefOid` equal to local HEAD; the matching workflow is green; and no merge was performed.
