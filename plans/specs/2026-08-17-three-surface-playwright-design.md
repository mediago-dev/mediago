# Three-Surface Playwright V1 Design

**Date:** 2026-08-17
**Scope:** Web, Electron, and standalone MV3 browser-extension functional tests

## 1. Background

MediaGo now has deterministic unit, Go contract, and localhost media-integration coverage. The remaining high-risk boundary is the real user surface: React UI bootstrapping, Web authentication, Electron main/preload integration, and the standalone extension's Manifest V3 service worker.

This phase adds a complete but intentionally small Playwright V1. Every surface follows a real localhost path and downloads the committed synthetic MP4. The suite never contacts Bilibili, YouTube, or any other external media source.

The third surface is `packages/mediago-extension`, the installable MV3 extension with Popup, Options, and a background service worker. `packages/browser-extension` is an Electron-only Bilibili page-injection library and is not a fourth Playwright surface.

## 2. Goals

1. Exercise one real, user-visible download flow through Web and Electron.
2. Exercise MV3 service-worker capture, Badge, Popup, Options, and Core submission through the standalone extension.
3. Use the existing localhost media fixture and real Core/downloader dependencies.
4. Keep all persistent state in temporary directories and leave no processes behind.
5. Produce useful screenshots, traces, videos, and bounded logs only when a test fails.
6. Add one Linux x64 CI job to the existing PR gate while keeping the complete `Validate MediaGo` workflow below ten minutes.
7. Close the real Electron-owned Core and SSE connection during application shutdown so both production and tests have a deterministic lifecycle.
8. Remove Electron's unconditional startup-time EasyList request; ad-block data loads only when the built-in browser actually needs it.

## 3. Non-goals

- Bilibili or YouTube requests, authentication, cookies, or real videos.
- Playwright coverage of `packages/browser-extension`.
- Exhaustive navigation or every button on every page.
- Cross-browser Web testing; Chromium is sufficient because Electron and MV3 are Chromium surfaces.
- macOS or Windows CI in V1. Cross-platform smoke matrices can be a later release-gate phase.
- HLS download through the UI. The existing Core media integration already verifies local HLS end to end.
- Visual-regression snapshots or pixel-diff baselines.
- Test-only backdoors that bypass Core, Electron IPC, or the MV3 service worker.

## 4. Architecture options

### Option A: One Playwright runner with three projects (selected)

Use one root configuration and three serial projects: `web`, `electron`, and `extension`. Share process, temporary-directory, media, hashing, logging, and artifact helpers. Build all required binaries once.

This minimizes duplicated setup, gives one local command and one CI job, and makes the ten-minute budget measurable.

### Option B: Three independent configurations and CI jobs

This provides stronger job isolation and allows parallel execution, but repeats checkout, pnpm, Go, browser, dependency, and build setup. It also triples maintenance and makes the overall PR wall-clock less predictable. V1 does not use it.

### Option C: Browser-only tests with routed API responses

This is fast but would not verify Core startup, database persistence, downloader execution, Electron preload discovery, MV3 worker capture, or extension-to-Core submission. It conflicts with the agreed real-local-resource requirement and is rejected.

## 5. Test layout

```text
playwright.config.ts
tests/e2e/
├── support/
│   ├── artifacts.ts
│   ├── core-process.ts
│   ├── media.ts
│   ├── ports.ts
│   ├── process.ts
│   ├── server-process.ts
│   ├── test-page.ts
│   └── ui-process.ts
├── web/
│   └── download.spec.ts
├── electron/
│   └── download.spec.ts
└── extension/
    └── capture-and-download.spec.ts
```

The support files are small and responsibility-based:

- `process.ts` starts a bounded child process, records a redacted log tail, waits for readiness, and terminates the process tree.
- `ports.ts` checks the product ports before startup and fails with a clear owner/port message instead of talking to a stray process.
- `core-process.ts` builds launch arguments for a temporary Core with a database, config, log, download, and dependency directory.
- `server-process.ts` starts the real built `apps/server` launcher for the Web project.
- `media.ts` wraps the existing `tests/media-service/server.ts`, loads the committed manifest, and verifies downloaded bytes and SHA-256.
- `test-page.ts` starts a tiny random-port HTML server whose page requests the existing MP4 URL, giving the extension a real tab-bound request to observe.
- `ui-process.ts` starts only the Vite renderer required by the active Web or Electron project and validates that its fixed port belongs to that process.
- `artifacts.ts` writes only bounded, credential-redacted diagnostics into the Playwright test output directory.

No general framework or page-object hierarchy is added. Shared helpers exist only where two or more projects need the behavior.

## 6. Playwright configuration

Pin `@playwright/test` and `playwright` to the same exact stable version. V1 uses `1.61.1` rather than a same-day release so the browser binary and lockfile remain reproducible.

The root configuration uses:

- `testDir: "tests/e2e"`
- projects selected by `testMatch`: `web`, `electron`, `extension`
- `workers: 1` and `fullyParallel: false`
- no automatic retries; deterministic localhost failures must remain visible
- a per-test timeout large enough for Core startup and one small download, with a stricter total job timeout in CI
- HTML plus line reporters
- screenshots, trace, and video retained on failure
- `forbidOnly` in CI
- output below a gitignored `test-results/` directory
- a CI `globalTimeout` of three minutes for the three serial scenarios; together with the cold pre-test budget, this leaves at least 75 seconds of the eight-minute job for teardown and artifact upload

The root config does not use top-level `webServer` entries. Project fixtures start only the renderer they own:

- `APP_TARGET=server` at `http://127.0.0.1:8501`
- `APP_TARGET=electron` at `http://127.0.0.1:8500`

Both use strict ports. V1 never blindly reuses an existing listener: an occupied product port fails with a clear owner/port message. The extension project starts no Vite process. This also keeps focused commands truly focused.

Playwright officially supports multiple local `webServer` processes, Electron through `_electron.launch()`, and extensions through a persistent Chromium context. The extension uses Playwright's bundled Chromium, not installed Chrome or Edge, because branded browsers no longer accept the required side-load flags.

## 7. Shared setup and isolation

Before the Playwright runner starts, one build script produces:

1. `apps/core/bin/mediago-core` with `cd apps/core && go build -o bin/mediago-core ./cmd/server`, avoiding the broader player/CLI release build
2. the real `apps/server/build` launcher, including its `@mediago/service-runner` dependency through Turbo's dependency graph
3. Electron preload output
4. Electron main-process output
5. `packages/mediago-extension/dist`

The E2E setup calls the existing selective downloader with `--tools aria2`; it does not provision `N_m3u8DL-RE` or `ffmpeg`. Those remain owned by the HLS media-integration job.

Each project owns a unique `mkdtemp` runtime root. It contains database, Core config, logs, downloads, and browser profile. Playwright artifacts use the separate gitignored `test-results/` tree through `testInfo.outputPath()`. Cleanup order is always browser/application first, then child processes, then local servers, then the temporary runtime directory. Cleanup runs from `finally`/fixture teardown even after assertion failure.

Web and extension contexts install a test-side request guard before navigation. It permits loopback HTTP(S) plus browser-internal schemes, cancels any other HTTP(S) request, and records the blocked URL for a final zero-request assertion. Electron applies the owned-Core-origin policy described below to its default session.

Fixed product ports are preserved because the applications discover them as part of production behavior:

- Web Core: `9900`
- Electron/desktop Core: `39719`
- Electron renderer: `8500`
- Web renderer: `8501`

The suite runs serially, so Electron and extension can reuse `39719` after teardown. The media and extension test-page servers use OS-assigned loopback ports.

The Web launcher currently writes below the user's home directory. Add one production-safe override, `MEDIAGO_SERVER_ROOT`, whose default remains the existing `~/.<APP_NAME>-server` path. Tests set it to their temporary root. Electron receives a temporary `XDG_CONFIG_HOME` on Linux and the existing `MEDIAGO_DEPS_DIR` override; the directly built Core remains at its normal development path, so no config-path override is needed. No test replaces `$HOME`.

`DownloaderServer` gains an idempotent `stop()` which clears polling, closes the stored SDK event stream, stops the stored `ServiceRunner`, and clears client/runtime state. `ElectronApp.shutdown()` delegates to it. The main-process `before-quit` flow prevents the first quit, awaits shutdown once, then resumes quitting without re-entering cleanup. Focused unit tests cover start/stop ownership, repeated stop, event-stream closure, and runner failure handling.

`WebviewService` no longer starts `ElectronBlocker.fromLists()` in its constructor. A memoized loader runs only when ad blocking is enabled for an actual built-in-browser navigation (or the user turns blocking on), is awaited before that navigation, and converts fetch failure into one bounded logger error instead of an unhandled rejection. Tests prove ordinary desktop construction/startup performs no fetch, activation loads at most once, and a rejected load is contained. This is production behavior, not an E2E-only switch.

## 8. Web scenario

The Web project starts the real built `apps/server`, which starts the real authenticated Core and temporary SQLite database. The browser opens the real Web renderer.

Steps:

1. Open `/` and wait for the boot screen to disappear.
2. Confirm first-run authentication redirects to `/signin`.
3. Set a synthetic test password through the real UI and return to `/`.
4. Open New Download.
5. Attempt submission with an empty URL and verify the visible form error.
6. Explicitly select Direct, because the product default is HLS.
7. Enter the localhost `sample.mp4` URL and a unique test name.
8. Click Download Now.
9. Wait for the real task card to report completion.
10. Verify the downloaded file is present in the temporary directory and matches the committed fixture size and SHA-256.

The test uses accessible roles, labels, headings, and visible state. A `data-testid` is added only if the current accessible structure cannot uniquely identify a stable state.

## 9. Electron scenario

The Electron project launches the real built main process with Playwright `_electron.launch()`. Vite serves the Electron renderer; the application starts Core itself on `39719`.

Steps:

1. Launch with temporary Linux app data, the dependency override, and a synthetic `PORTABLE_EXECUTABLE_FILE` value. Portable mode is existing production behavior and prevents the updater from making a first-run external request.
2. Immediately after `_electron.launch()` and before `firstWindow()`, install a test-side Electron session guard. Port `39719` was free before launch, so the guard provisionally permits loopback plus private-address requests to that owned port and cancels every other non-loopback HTTP(S) request.
3. Wait for the first real window and assert the Electron renderer URL/title.
4. Evaluate only a presence check for the preload bridge, proving preload IPC was installed; do not replace it.
5. Wait for `ServiceRunner` to finish its real health polling. Through the real preload bridge, read the Core URL selected by `DownloaderServer`, then tighten the guard and assert every provisionally allowed private-address request used that exact origin.
6. Set the Core `local` configuration to the project download directory through the real API before creating the task.
7. Use the desktop UI, explicitly select Direct, and immediately download the localhost MP4.
8. Wait for the task to report completion and verify fixture size/SHA-256.
9. Close the Electron application, wait for its PID to exit, and verify port `39719` is free before the extension project starts.

Native file dialogs are not part of the path. The test does not mock Electron application code or bypass renderer-to-Core discovery.

## 10. Standalone extension scenario

The extension project launches Playwright's bundled Chromium with a persistent context and the built MV3 directory. It uses `headless: false` under the existing CI Xvfb wrapper because that is the documented unpacked-extension path; it does not depend on an installed Chrome channel.

Steps:

1. Wait for the real MV3 service worker and derive the extension ID from its URL.
2. Open the real Options page.
3. Keep the production default Desktop HTTP mode. With port `39719` confirmed free, click Test connection and assert the visible failure state. The desktop endpoint is intentionally fixed and is not editable in this mode.
4. Start the temporary Core on the production desktop port, click Test connection again, and assert success.
5. Enable Start downloading immediately through the real Options UI, then reload Options and assert both Desktop HTTP mode and the toggle persisted. This is required because the production default only adds tasks to the list.
6. Create the Popup page first, then open the random-port localhost fixture page. The fixture has a deterministic title and requests `sample.mp4` from the media service.
7. Bring the fixture page to the front, wait for the extension Badge to show one captured resource, then reload the still-inactive Popup page. This preserves the production `active/currentWindow` query instead of calling `GET_SOURCES` from the test.
8. In the Popup, assert the Direct badge and fixture-page title. `SourceItem` intentionally displays the captured name rather than the raw URL; the final file hash proves which URL was submitted.
9. Submit the captured resource through the Popup.
10. Verify the persisted Core task reaches success and the downloaded file matches fixture size/SHA-256.

The test talks to the service worker only to wait for readiness, obtain the extension ID, and observe the Badge for the active tab. Capture, session storage, active-tab lookup, Popup rendering, Options persistence, connection probing, and submission all remain real production behavior.

## 11. Failure handling and artifacts

The ordinary Web project uses Playwright Test's configured trace, screenshot, and video retention. Electron and extension create their own contexts, so their fixtures explicitly:

1. allocate video/artifact directories with `testInfo.outputPath()`
2. start context tracing before the scenario
3. capture an active-page screenshot on failure
4. stop/save trace and video on failure
5. delete successful-run trace/video output

Every project also records:

- scenario and project name
- child-process exit status
- bounded stdout/stderr tails
- Core/task log tail when available
- screenshot of the active surface
- trace and video for browser contexts

Logs redact Authorization, API keys, Cookie, proxy userinfo, and synthetic password values before attachment. Failure messages never include full request headers, settings storage, environment dumps, or unbounded logs. Browser traces can contain the fixed synthetic test password or local API responses, so E2E never receives repository/user secrets and CI uploads failure artifacts with a short three-day retention.

Readiness and polling use explicit deadlines with short intervals. Tests never use fixed sleeps for application state. A failure identifies the stage (`build`, `port`, `startup`, `auth`, `capture`, `submit`, `download`, `cleanup`) and the responsible process.

Cleanup errors are attached to the original failure and do not hide it. On success, the suite asserts no owned Electron, Chromium, Server, or Core process remains.

## 12. Commands

Root scripts provide:

- `test:e2e:setup` — install the pinned Chromium and selectively provision media dependencies
- `test:e2e:build` — directly build Core plus Server, Electron preload/main, and the standalone extension once
- `test:e2e` — run all three projects
- `test:e2e:web`, `test:e2e:electron`, `test:e2e:extension` — focused project runs
- `test:e2e:ui` — local Playwright UI mode for Web/extension debugging where supported
- `type:check:e2e` — type-check the config, support fixtures, and all three specs through a dedicated `tsconfig.e2e.json`

The normal Vitest command continues to exclude `tests/e2e/**/*.spec.ts`; Playwright owns those files exclusively.

## 13. CI design

Add one `test-e2e` job to `.github/workflows/ci.yml` on Ubuntu Linux x64:

1. checkout
2. pnpm and Node setup
3. Go setup
4. frozen install
5. restore the complete `.deps` tree, including `.deps/.state/linux-x64.json`
6. restore Playwright browser cache keyed by OS and lockfile
7. provision only `aria2`
8. always run `playwright install-deps chromium`, then install pinned Chromium (the browser download may hit cache, system packages may not)
9. run `type:check:e2e`
10. run the one-time E2E build
11. run all projects under `xvfb-run -a`
12. upload Playwright report/test results only on failure, with three-day retention

The job timeout is eight minutes and the Playwright run has its shorter internal global timeout. Initial operating budgets are:

| Stage                               |  Warm target |  Cold target |
| ----------------------------------- | -----------: | -----------: |
| checkout, runtimes, pnpm install    |         45 s |         75 s |
| browser system packages and binary  |         25 s |         75 s |
| aria2 plus Core/product builds      |         45 s |         75 s |
| three serial scenarios              |         75 s |        120 s |
| teardown and failure upload reserve |         30 s |         30 s |
| **Total**                           | **3 m 40 s** | **6 m 15 s** |

The three-minute Playwright cap plus the 225-second cold pre-test budget totals 405 seconds, leaving 75 seconds before the job timeout even on the capped failure path. The first green GitHub run records actual warm/cold stage durations. If the cold path exceeds seven minutes or the complete workflow exceeds ten, implementation removes duplicated build/setup work before this gate is accepted.

`pr-gate.needs` includes `test-e2e`; its environment includes `E2E_RESULT: ${{ needs.test-e2e.result }}`, and the shell result loop checks `test-e2e:$E2E_RESULT`. Adding only the dependency is insufficient because the existing gate enumerates results explicitly. No existing unit or media-integration job is removed.

## 14. Risks and controls

- **Electron automation is experimental:** keep its fixture narrow, pin Playwright exactly, and test only supported renderer/main APIs.
- **MV3 worker suspension:** register production listeners synchronously as today, wait for the actual worker, and drive capture through a real tab request rather than invoking internal handlers.
- **Port collisions:** fail before startup with the exact port and expected owner; never attach to an unknown process.
- **Browser/dependency downloads:** cache by lockfile and exact tool versions; a cache miss remains a valid setup path.
- **Flaky UI text/localization:** set a deterministic English test locale and use semantic locators. Add test IDs only for status values that lack a stable accessible name.
- **Duplicate media coverage:** Playwright uses only Direct MP4; existing integration remains the sole HLS UI-independent gate.
- **Cleanup failures:** own every process handle and profile directory, terminate process trees, and verify ports are released.
- **Unexpected network access:** all media URLs are loopback. Web/extension guards cancel and report non-loopback HTTP(S). Electron additionally permits only the exact Core origin it owns, which may use the machine's private LAN address because production deliberately exposes the desktop Core on the LAN. Portable mode disables the updater, and lazy ad-block loading removes the remaining ordinary-startup Node fetch without a test-only production flag.

## 15. Acceptance criteria

1. Web authenticates, rejects invalid input, downloads localhost MP4 through real Server/Core, and verifies the file hash.
2. Electron boots the real main/preload/renderer/Core chain, downloads the MP4 through its UI, verifies the hash, and exits cleanly.
3. The standalone MV3 extension persists Options, detects connection failure/success, captures a tab-bound localhost MP4 request, updates Badge/Popup, submits to Core, and verifies the downloaded file hash.
4. No test accesses Bilibili, YouTube, or any external media/API endpoint; Electron may use only its preflight-owned private-address Core origin.
5. All state is temporary; no user configuration or home download directory is changed.
6. Failure output is bounded and credential-safe, with screenshots/traces/videos available.
7. Existing Go, Vitest, media integration, lint, format, and type checks remain green.
8. `test-e2e` is required by `pr-gate`, finishes within its eight-minute timeout, and the complete PR workflow stays below ten minutes.
9. The dedicated E2E TypeScript configuration passes and ordinary Vitest never collects Playwright specs.
10. Electron quit is idempotent, closes SSE/polling/Core, and releases `39719` before the extension starts.
11. Implementation remains small: one config, three specs, focused support helpers, one environment override, two focused Electron lifecycle/network corrections, and no page-object framework.
