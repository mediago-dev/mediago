# Taskfile Orchestration Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Task `v3.51.1` the canonical local and CI/release entrypoint, provision pinned runtime tools before startup, preserve safe environment precedence, and cover the Bilibili/BBDown failure path end to end.

**Architecture:** A root `Taskfile.yml` provides guarded public commands and delegates to explicit pnpm/Turbo/Go/Docker leaf commands. Dependency layout and profile loading live in small testable TypeScript modules; Go exposes typed dependency failures over backward-compatible HTTP/SSE payloads; extension and UI consumers validate the correct ID domain.

**Tech Stack:** Go Task 3.51.1, pnpm 10, Turborepo, TypeScript 7, Vitest 4, Go 1.25, Gin, SSE, React, Playwright, GitHub Actions, Docker Buildx.

**Design spec:** `docs/superpowers/specs/2026-08-18-taskfile-orchestration-design.md`

---

## File Structure Map

### New focused files

- `Taskfile.yml` — guarded public task API plus private dependency graph.
- `scripts/dependency-layout.ts` — canonical tool groups, supported platform keys, deps root/leaf resolution, and manifest asset validation.
- `scripts/dependency-layout.test.ts` — path, tool-group, and platform support contracts.
- `scripts/print-platform-key.ts` — tiny Task-facing CLI over the shared Node platform mapper.
- `scripts/download-deps-provisioner.ts` — testable cache/state/atomic-replacement orchestration with an injected candidate preparer.
- `scripts/download-deps-provisioner.test.ts` — isolated-root missing/stale/valid/non-executable/rejected-candidate cases.
- `scripts/load-profile-env.ts` — dotenv-flow profile selection that preserves process/CI values.
- `scripts/load-profile-env.test.ts` — precedence and missing-file behavior.
- `scripts/build-env-contract.test.ts` — exact Turbo classification and bundler allowlist contracts.
- `scripts/verify-bundle-env.ts` — safely injects/restores a dotenv sentinel and scans Server/Electron output.
- `scripts/taskfile-contract.test.ts` — public task/version/leaf-command/no-cycle/document contracts.
- `scripts/ci/task-workflow-contract.test.ts` — workflow-to-Task mapping and fixed Task version contracts.
- `apps/core/internal/core/dependency_error.go` — typed external dependency failure.
- `apps/core/internal/core/dependency_error_test.go` — `errors.As` and downloader mapping tests.
- `apps/core/internal/api/server/task_failure.go` — maps queue errors to stable SSE payloads.
- `apps/core/internal/api/server/task_failure_test.go` — generic and dependency failure payload tests.
- `apps/core/internal/api/server/download_identity_test.go` — real POST/queue/start/success/failure ID continuity.
- `apps/core/internal/api/handler/error_response.go` — stable HTTP error-code helpers for download/task endpoints.
- `apps/core/internal/api/handler/error_response_test.go` — numeric Download ID and string Queue Task ID contracts.
- `apps/ui/src/api/download-event-payload.ts` — strict persisted-download SSE parser.
- `apps/ui/src/api/download-event-payload.test.ts` — valid numeric-string and invalid ID cases.
- `apps/ui/src/api/events.test.ts` — fake EventSource dispatch/polling regression.
- `apps/ui/src/hooks/download-failure-handler.ts` and `.test.ts` — one-toast/revalidation behavior without rendering the full hook.
- `packages/mediago-extension/src/background/mediago-response.ts` — validates `/api/downloads` success wire payloads.
- `packages/mediago-extension/src/background/mediago-response.test.ts` — response count and positive-integer ID tests.
- `tests/e2e/support/fake-dependencies.ts` — isolated aria2/fake-BBDown leaf and argv recorder.
- `scripts/verify-isolated-runtime-deps.ts` — pinned-version isolated-root verifier with validated cleanup.
- `scripts/smoke-dev-all.ts` — bounded readiness/order/process-group startup smoke test.

### Existing orchestration and dependency files

- `package.json` — split historical high-level scripts into Task wrappers and `*:raw` leaves.
- `scripts/download-deps.ts` — use `MEDIAGO_DEPS_ROOT`, strict asset resolution, and canonical layout helpers.
- `scripts/download-deps-integrity.ts` and `.test.ts` — preserve candidate-before-replace integrity behavior.
- `.gitignore` — retain the existing rule that ignores `.env.local` and `.env.*.local`.
- `turbo.json` — classify build/cache and pass-through environment variables.
- `apps/server/tsdown.config.ts`, `apps/server/src/index.ts`, `apps/electron/tsdown.config.ts`, and `apps/electron/scripts/build.ts` — remove generic dotenv embedding and make every fallback consumer use the shared profile loader.
- `apps/ui/vite.config.ts` — replace broad `APP*` exposure with exact client-visible definitions.
- `apps/server/tsconfig.json`, `apps/electron/tsconfig.json`, and `tsconfig.ci.json` — type-check configs, scripts, and shared orchestration modules.
- `package.json` and `pnpm-lock.yaml` — declare root `dotenv-flow` access used by shared scripts.
- `Dockerfile` — call only documented raw/workspace leaf commands.

### Existing CI and documentation files

- `.github/workflows/ci.yml` — fixed Task setup and `task ci:*` job entrypoints.
- `.github/workflows/build-electron.yml` — Task-wrapped metadata/build commands; remove unused `swag@latest` install.
- `.github/workflows/build-server.yml` — Task-wrapped Docker metadata commands; keep Buildx action.
- `.github/workflows/build-docs.yml` — Task-wrapped install/docs build; keep OSS platform steps.
- `.github/workflows/release.yml` — Task-wrapped release scripts including artifact collection.
- `README.md`, `README.zh.md`, `README.jp.md`, `README.it.md`, `CONTRIBUTING.md`, `apps/core/README.md`, `apps/electron/README.md`, `apps/ui/README.md` — canonical Task startup/build commands.

### Existing Bilibili/error files

- `apps/core/internal/core/downloader.go` and `downloader_contract_test.go` — return/verify `DependencyError` for missing BBDown.
- `apps/core/internal/service/download_task.go` and `_test.go` — explicit Download ID → decimal Queue Task ID conversion.
- `apps/core/internal/api/dto/response.go` — optional HTTP `errorCode`.
- `apps/core/internal/api/dto/task.go` — retain string Queue Task ID wire contract.
- `apps/core/internal/api/server/queue_callbacks.go` — broadcast stable failure payloads.
- `apps/core/internal/api/handler/download.go` and `task.go` — endpoint-specific error codes.
- `packages/core-sdk/src/types.ts` — backward-compatible SSE failure fields.
- `packages/shared/common/src/types/index.ts` — UI failure payload fields.
- `apps/ui/src/api/events.ts` and `apps/ui/src/hooks/use-tasks.ts` — strict ID parsing and dependency error display.
- `packages/shared/common/src/i18n/resources/{en,zh,it}.ts` — localized dependency-missing message.
- `packages/mediago-extension/src/background/mediago-client.ts` — validate HTTP import response.
- `tests/e2e/extension/capture-and-download.spec.ts` — Bilibili fixture/import regression.

## Chunk 1: Dependency Layout and Environment Foundation

### Task 1: Define the Dependency Layout Contract

**Files:**

- Create: `scripts/dependency-layout.ts`
- Create: `scripts/dependency-layout.test.ts`
- Create: `scripts/print-platform-key.ts`
- Create: `scripts/download-deps-provisioner.ts`
- Create: `scripts/download-deps-provisioner.test.ts`
- Modify: `scripts/download-deps.ts`
- Modify: `scripts/download-deps-args.test.ts`
- Modify: `scripts/download-deps-integrity.ts`
- Modify: `scripts/download-deps-integrity.test.ts`
- Modify: `tsconfig.ci.json`
- Modify: `package.json`

- [ ] **Step 1: Write failing layout and platform tests**

```ts
import { describe, expect, test } from "vitest";
import {
  E2E_TOOLS,
  MEDIA_INTEGRATION_TOOLS,
  RUNTIME_TOOLS,
  SUPPORTED_RUNTIME_PLATFORMS,
  platformKeyFor,
  platformDepsDir,
  preflightToolAssets,
  resolveDepsRoot,
} from "./dependency-layout.ts";
import manifest from "./deps-versions.json" with { type: "json" };

describe("dependency layout", () => {
  test("keeps downloader root separate from runtime leaf", () => {
    expect(
      resolveDepsRoot("/repo", { MEDIAGO_DEPS_ROOT: "/tmp/mediago-deps" }),
    ).toBe("/tmp/mediago-deps");
    expect(platformDepsDir("/tmp/mediago-deps", "linux-x64")).toBe(
      "/tmp/mediago-deps/linux-x64",
    );
  });

  test("defines the complete pinned runtime tool group", () => {
    expect(RUNTIME_TOOLS).toEqual([
      "ffmpeg",
      "N_m3u8DL-RE",
      "BBDown",
      "aria2",
      "yt-dlp",
      "mediago",
    ]);
  });

  test("keeps BBDown in media integration and aria2-only E2E groups", () => {
    expect(MEDIA_INTEGRATION_TOOLS).toEqual([
      "aria2",
      "N_m3u8DL-RE",
      "ffmpeg",
      "BBDown",
    ]);
    expect(E2E_TOOLS).toEqual(["aria2"]);
  });

  test.each([
    ["darwin", "x64", "darwin-x64"],
    ["darwin", "arm64", "darwin-arm64"],
    ["linux", "x64", "linux-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["win32", "x64", "win32-x64"],
    ["win32", "arm64", "win32-arm64"],
  ])("maps Node %s/%s to %s", (platform, arch, expected) => {
    expect(platformKeyFor(platform, arch)).toBe(expected);
  });

  test("supports only complete runtime platform sets", () => {
    expect(SUPPORTED_RUNTIME_PLATFORMS).toEqual([
      "darwin-x64",
      "darwin-arm64",
      "linux-x64",
      "linux-arm64",
      "win32-x64",
    ]);
    expect(() =>
      preflightToolAssets(
        RUNTIME_TOOLS,
        manifest,
        SUPPORTED_RUNTIME_PLATFORMS,
        "/tmp/mediago-deps",
      ),
    ).not.toThrow();
  });

  test("preflights a complete platform before downloading anything", () => {
    expect(() =>
      preflightToolAssets(
        RUNTIME_TOOLS,
        manifest,
        ["win32-arm64"],
        "/tmp/mediago-deps",
      ),
    ).toThrow(
      /ffmpeg.*b6\.0.*win32-arm64.*ffmpeg\.exe.*pnpm deps:download:raw.*--tools ffmpeg.*--platform win32-arm64/i,
    );
  });

  test("permits selective win32-arm64 BBDown provisioning", () => {
    expect(() =>
      preflightToolAssets(
        ["BBDown"],
        manifest,
        ["win32-arm64"],
        "/tmp/mediago-deps",
      ),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests and verify the new module is missing**

Run: `pnpm exec vitest run scripts/dependency-layout.test.ts`

Expected: FAIL because `scripts/dependency-layout.ts` does not exist.

- [ ] **Step 3: Implement the minimal canonical layout module**

```ts
import path from "node:path";

export const RUNTIME_TOOLS = [
  "ffmpeg",
  "N_m3u8DL-RE",
  "BBDown",
  "aria2",
  "yt-dlp",
  "mediago",
] as const;

export const MEDIA_INTEGRATION_TOOLS = [
  "aria2",
  "N_m3u8DL-RE",
  "ffmpeg",
  "BBDown",
] as const;

export const E2E_TOOLS = ["aria2"] as const;

export const SUPPORTED_RUNTIME_PLATFORMS = [
  "darwin-x64",
  "darwin-arm64",
  "linux-x64",
  "linux-arm64",
  "win32-x64",
] as const;

export function platformKeyFor(platform: string, arch: string): string {
  const key = `${platform}-${arch}`;
  const selectablePlatforms: readonly string[] = [
    ...SUPPORTED_RUNTIME_PLATFORMS,
    "win32-arm64",
  ];
  if (!selectablePlatforms.includes(key)) {
    throw new Error(`Unsupported platform/architecture: ${key}`);
  }
  return key;
}

export interface DependencyManifestEntry {
  repo?: string;
  version?: string;
  assets: Partial<Record<string, string>>;
  sha256?: Partial<Record<string, string>>;
  binaryName: { default: string; win32?: string };
}

export type DependencyManifest = Record<string, DependencyManifestEntry>;

export function resolveDepsRoot(
  repositoryRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return path.resolve(
    environment.MEDIAGO_DEPS_ROOT ?? path.join(repositoryRoot, ".deps"),
  );
}

export function platformDepsDir(root: string, platformKey: string): string {
  return path.join(root, platformKey);
}

export function preflightToolAssets(
  selectedTools: readonly string[],
  manifest: DependencyManifest,
  platformKeys: readonly string[],
  depsRoot: string,
): void {
  const failures: string[] = [];
  for (const toolName of selectedTools) {
    const entry = manifest[toolName];
    for (const platformKey of platformKeys) {
      const version = entry?.version ?? "<missing-version>";
      if (!entry?.assets[platformKey] || !entry.repo || !entry.version) {
        const binaryName = platformKey.startsWith("win32")
          ? (entry?.binaryName.win32 ?? entry?.binaryName.default ?? toolName)
          : (entry?.binaryName.default ?? toolName);
        failures.push(
          [
            `${toolName} ${version} has no complete pinned asset for ${platformKey}`,
            `expected ${path.join(platformDepsDir(depsRoot, platformKey), binaryName)}`,
            `retry: pnpm deps:download:raw --tools ${toolName} --platform ${platformKey}`,
          ].join("; "),
        );
      }
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}
```

- [ ] **Step 4: Route downloader paths and asset selection through the module**

In `scripts/download-deps.ts`:

- replace the constant `DEPS_DIR` with `resolveDepsRoot(path.resolve(__dirname, ".."))`;
- build platform destinations with `platformDepsDir`;
- replace the downloader's private mapping with `platformKeyFor(process.platform, process.arch)`;
- make `--all` iterate `SUPPORTED_RUNTIME_PLATFORMS`;
- call `preflightToolAssets(selectedToolNames, manifest, platformKeys, depsRoot)` once before constructing the existing `[name, definition]` tuples and before the first download loop, then treat asset lookup as already proven;
- keep `MEDIAGO_DEPS_DIR` untouched because it remains a runtime leaf variable;
- keep candidate integrity verification before `rename` and state writes.

Create `scripts/print-platform-key.ts` as a no-argument CLI that prints only `platformKeyFor(process.platform, process.arch)`. Task uses this CLI for `MEDIAGO_DEPS_DIR`, so Task and the downloader cannot drift. Wrap later download/extraction errors with the same tool, pinned version, platform, expected destination, and `pnpm deps:download:raw --tools <tool> --platform <platform>` retry context.

Add `"deps:download:raw": "tsx scripts/download-deps.ts"` to `package.json` in this task while leaving the historical `deps:download` body unchanged until Chunk 2. This makes every emitted retry command executable at the Task 1 commit boundary.

- [ ] **Step 5: Reject non-executable Unix cache entries**

First extend `scripts/download-deps-integrity.test.ts` with mode `0o644` and `0o755` fixtures and assert the first is invalid/repaired for a Unix target while the second is reusable; assert a simulated Windows target does not apply POSIX execute-bit validation. Run that test and require it to fail on the missing executable-mode contract.

Then extend `dependencyFileMatchesIntegrity` and `assertDependencyFileIntegrity` with `{ requireExecutable?: boolean }`. After the nonempty-file and optional final-file SHA-256 checks, require `(stat.mode & 0o111) !== 0` when true. The provisioner passes true for every non-Windows target and false for `win32-*`; it chmods a downloaded Unix candidate before its final integrity check and atomic rename.

- [ ] **Step 6: Extract and test the isolated-root provisioner**

Before extracting production code, create `scripts/download-deps-provisioner.test.ts` with `mkdtemp` fixtures plus `onTestFinished`, retarget the existing static ordering test in `download-deps-integrity.test.ts` to the planned `download-deps-provisioner.ts`, and keep a separate assertion that the CLI passes the real candidate preparer into the provisioner. Run both tests and require a red result because the provisioner module/wiring is absent. Cover without network:

- missing binary/state calls the fake preparer once, writes `<root>/linux-x64/tool`, and writes `<root>/.state/linux-x64.json`;
- matching binary, executable mode, asset/version/name state, and optional hash skips the preparer;
- stale version state and matching non-executable Unix state each call the preparer and replace only that tool;
- declared-hash candidate mismatch rejects the candidate, keeps the prior binary bytes and prior state bytes unchanged, and removes temporary download directories;
- `MEDIAGO_DEPS_DIR` is never read or used as the root.

Use a tiny injected manifest/tool with a direct candidate file so the test exercises the real path/state/replacement code rather than GitHub or archive utilities.

Then move cache-state loading, target-path construction, reuse/refresh decisions, candidate verification, atomic rename, chmod, and atomic state saving into `scripts/download-deps-provisioner.ts`. Its `provisionDependencies` accepts `depsRoot`, manifest, selected tool names, platform keys, and an injected `prepareCandidate(target, workDir)`; `scripts/download-deps.ts` remains the CLI/network/archive adapter. Make the static order and CLI-wiring contracts green.

- [ ] **Step 7: Preserve manifest-order argument selection**

Extend `scripts/download-deps-args.test.ts` with `--tools BBDown` and assert `['BBDown']`. Keep the existing manifest-order behavior for multi-tool selection; win32-arm64 asset availability is tested through `preflightToolAssets` above.

- [ ] **Step 8: Run focused dependency tests**

Run: `pnpm exec vitest run scripts/dependency-layout.test.ts scripts/download-deps-args.test.ts scripts/download-deps-integrity.test.ts scripts/download-deps-provisioner.test.ts`

Expected: PASS; layout proves the complete supported matrix and selective BBDown behavior, integrity proves final-file/hash/execute rules, and isolated provisioner tests prove root/state/cache/atomic replacement wiring.

- [ ] **Step 9: Run type checking for CI scripts**

Add the dependency layout, provisioner, their tests, and `scripts/print-platform-key.ts` to the explicit `tsconfig.ci.json` include list.

Run: `pnpm type:check:ci`

Expected: PASS.

- [ ] **Step 10: Commit the dependency layout**

```bash
git add scripts/dependency-layout.ts scripts/dependency-layout.test.ts scripts/print-platform-key.ts scripts/download-deps.ts scripts/download-deps-provisioner.ts scripts/download-deps-provisioner.test.ts scripts/download-deps-args.test.ts scripts/download-deps-integrity.ts scripts/download-deps-integrity.test.ts tsconfig.ci.json package.json
git commit -m "feat(deps): define pinned runtime dependency layout"
```

### Task 2: Preserve Environment Precedence Without Bundling Secrets

**Files:**

- Create: `scripts/load-profile-env.ts`
- Create: `scripts/load-profile-env.test.ts`
- Create: `scripts/build-env-contract.test.ts`
- Create: `scripts/verify-bundle-env.ts`
- Modify: `apps/server/tsdown.config.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/tsconfig.json`
- Modify: `apps/electron/tsdown.config.ts`
- Modify: `apps/electron/scripts/build.ts`
- Modify: `apps/electron/tsconfig.json`
- Modify: `apps/ui/vite.config.ts`
- Modify: `apps/ui/tsconfig.node.json`
- Modify: `turbo.json`
- Modify: `tsconfig.ci.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write failing profile precedence tests**

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { loadProfileEnv } from "./load-profile-env.ts";

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe("loadProfileEnv", () => {
  test("loads profile-local above local above profile above base", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mediago-env-"));
    try {
      await writeFile(path.join(root, ".env"), "VALUE=base\nBASE_ONLY=yes\n");
      await writeFile(
        path.join(root, ".env.test"),
        "VALUE=profile\nPROFILE_ONLY=profile\n",
      );
      await writeFile(path.join(root, ".env.local"), "VALUE=local\n");
      process.env.MEDIAGO_PROFILE = "test";

      loadProfileEnv(root);

      expect(process.env.VALUE).toBe("local");
      expect(process.env.BASE_ONLY).toBe("yes");
      expect(process.env.PROFILE_ONLY).toBe("profile");

      delete process.env.VALUE;
      await writeFile(
        path.join(root, ".env.test.local"),
        "VALUE=profile-local\n",
      );
      loadProfileEnv(root);
      expect(process.env.VALUE).toBe("profile-local");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("keeps an existing process value above every dotenv file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mediago-env-"));
    try {
      await writeFile(path.join(root, ".env.test.local"), "VALUE=file\n");
      process.env.MEDIAGO_PROFILE = "test";
      process.env.VALUE = "process";
      loadProfileEnv(root);
      expect(process.env.VALUE).toBe("process");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses MEDIAGO_PROFILE before NODE_ENV and tolerates absent files", () => {
    process.env.MEDIAGO_PROFILE = "test";
    process.env.NODE_ENV = "production";
    expect(loadProfileEnv("/path/that/does/not/exist")).toBe("test");
  });

  test("rejects unsupported profiles", () => {
    process.env.MEDIAGO_PROFILE = "staging";
    expect(() => loadProfileEnv("/tmp")).toThrow(/unsupported.*staging/i);
  });
});
```

- [ ] **Step 2: Run the tests and verify the loader is missing**

Run: `pnpm exec vitest run scripts/load-profile-env.test.ts`

Expected: FAIL because `scripts/load-profile-env.ts` does not exist.

- [ ] **Step 3: Implement the profile loader**

First declare the shared runtime dependency at the repository root without changing its existing resolved version:

Run: `pnpm add -Dw -E dotenv-flow@4.1.0`

Expected: root `package.json` and `pnpm-lock.yaml` record exact `4.1.0`.

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import dotenvFlow from "dotenv-flow";

export type MediaGoProfile = "development" | "test" | "production";

export function loadProfileEnv(projectRoot: string): MediaGoProfile {
  const raw =
    process.env.MEDIAGO_PROFILE ?? process.env.NODE_ENV ?? "development";
  if (raw !== "development" && raw !== "test" && raw !== "production") {
    throw new Error(`Unsupported MEDIAGO_PROFILE: ${raw}`);
  }
  const files = [".env", `.env.${raw}`, ".env.local", `.env.${raw}.local`]
    .map((name) => path.join(projectRoot, name))
    .filter(existsSync);
  const result = dotenvFlow.load(files, { silent: true });
  if (result.error) throw result.error;
  return raw;
}
```

Using the explicit file list is required: `dotenvFlow.config()` gives `.env.<profile>` higher priority than `.env.local` and skips `.env.local` for `test`, which does not match the approved contract. `dotenvFlow.load()` merges later files first while refusing to overwrite pre-existing process/CI variables.

- [ ] **Step 4: Write and run the failing build-environment contract**

In `scripts/build-env-contract.test.ts`, assert this exact `turbo.json` classification:

- `globalEnv`: `APP_TARGET`, `NODE_ENV`, `MEDIAGO_PROFILE`, `APP_VERSION`, `APP_NAME`, `APP_TD_APPID`;
- `globalPassThroughEnv`: `MEDIAGO_DEPS_ROOT`, `MEDIAGO_DEPS_DIR`, `MEDIAGO_CORE_BIN`;
- `tasks.dev.passThroughEnv`: `OPEN_DEVTOOLS`.

Also parse the exported configuration objects from both tsdown configs and the Vite config, require the exact per-bundler sets in Step 5, reject a generic top-level tsdown `env:` property and broad Vite `envPrefix: "APP"`, and reject token/signing/OSS definitions. Scope the assertion to bundler configuration so legitimate child-process options such as `spawn(command, args, { env: process.env })` are not rejected.

Run: `pnpm exec vitest run scripts/build-env-contract.test.ts`

Expected: FAIL against the existing generic environment embedding before any bundler/Turbo configuration is modified.

- [ ] **Step 5: Replace every direct dotenv consumer and make the contract green**

In both tsdown configs:

```ts
import { loadProfileEnv } from "../../scripts/load-profile-env.js";

loadProfileEnv(projectRoot);
```

Use the NodeNext-compatible `.js` source specifier in every Node-side consumer, including `apps/ui/vite.config.ts`; TypeScript/tsx resolve it to `load-profile-env.ts` during checking/execution without requiring `allowImportingTsExtensions`. Apply the loader in both tsdown configs, `apps/server/src/index.ts`, `apps/electron/scripts/build.ts`, and `apps/ui/vite.config.ts`. Delete each direct `dotenvFlow.config(...)`; in tsdown configs also delete `env: { ...env.parsed }`. Use these per-bundler definitions:

- Server tsdown: compile only `NODE_ENV` and fixed `APP_TARGET=server`; keep `APP_NAME` as runtime `process.env`.
- Electron tsdown: compile only `NODE_ENV`, `APP_TARGET`, `APP_VERSION`, and `APP_NAME`.
- UI Vite: remove broad `envPrefix: "APP"`; expose only `APP_VERSION`, `APP_TARGET`, and `APP_TD_APPID` through explicit `import.meta.env.*` definitions.

Do not expose `GH_TOKEN`, `GITHUB_TOKEN`, signing/OSS values, `APP_ID`, or `APP_COPYRIGHT`; Electron packaging may continue reading the last two at runtime.

Update `turbo.json` to the exact Step 4 classification and run `pnpm exec vitest run scripts/build-env-contract.test.ts` again. Expected: PASS.

- [ ] **Step 6: Verify local overrides are already ignored**

Run:

```bash
git check-ignore .env.local .env.test.local .env.production.local
for file in .env .env.test .env.production; do
  if git check-ignore -q "$file"; then exit 1; fi
done
```

Expected: the existing `*.local` rule ignores all local overrides, while base/profile files remain trackable. Do not add redundant ignore patterns.

- [ ] **Step 7: Run focused tests and builds with a sentinel secret**

Implement `scripts/verify-bundle-env.ts` so it:

1. snapshots the exact bytes/existence of `.env.production.local`;
2. refuses to continue if that file already defines `MEDIAGO_TEST_SENTINEL_SECRET`;
3. writes the snapshot, adding a newline first when necessary, plus `MEDIAGO_TEST_SENTINEL_SECRET=mediago-sentinel-must-not-ship`;
4. runs the Server workspace build and the existing Electron production build with `MEDIAGO_PROFILE=production`;
5. recursively scans `apps/server/build`, `apps/electron/build`, and `apps/ui/build` for that value and fails if found;
6. restores the original file bytes or removes only the newly created file in `finally`, even when build/scan fails.

Run:

```bash
pnpm exec vitest run scripts/load-profile-env.test.ts scripts/build-env-contract.test.ts
pnpm exec tsx scripts/verify-bundle-env.ts
```

Expected: tests and both builds PASS; the verifier prints that the sentinel was absent and exits zero. Before config migration, the static bundler contract fails even if tree-shaking removes an unused sentinel.

- [ ] **Step 8: Extend and run type checks over the changed files**

Add the dependency/profile/verifier scripts and their tests to `tsconfig.ci.json`. Extend `apps/server/tsconfig.json` to include `tsdown.config.ts`, and `apps/electron/tsconfig.json` to include `tsdown.config.ts` plus `scripts/**/*.ts`. Update `apps/ui/tsconfig.node.json` with repository rootDir/include entries for both `vite.config.ts` and `../../scripts/load-profile-env.ts`, so its composite project accepts the shared import and checks the config.

Run:

```bash
pnpm type:check:ci
pnpm -F @mediago/server type:check
pnpm -F @mediago/electron type:check
pnpm exec tsc -p apps/ui/tsconfig.node.json --noEmit
```

Expected: PASS.

- [ ] **Step 9: Commit environment handling**

```bash
git add scripts/load-profile-env.ts scripts/load-profile-env.test.ts scripts/build-env-contract.test.ts scripts/verify-bundle-env.ts apps/server/tsdown.config.ts apps/server/src/index.ts apps/server/tsconfig.json apps/electron/tsdown.config.ts apps/electron/scripts/build.ts apps/electron/tsconfig.json apps/ui/vite.config.ts apps/ui/tsconfig.node.json turbo.json tsconfig.ci.json package.json pnpm-lock.yaml
git commit -m "fix(build): preserve environment precedence"
```

## Chunk 2: Canonical Taskfile, CI, Docker, and Documentation

### Task 3: Lock the Public Task API Before Implementing It

**Files:**

- Create: `scripts/taskfile-contract.test.ts`
- Create: `Taskfile.yml`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Write a failing local public API and version contract**

Add exact `yaml@2.8.3` as a root dev dependency (`pnpm add -Dw -E yaml@2.8.3`). Create a table-driven test that parses `Taskfile.yml` into a normalized object and reads `package.json`, then requires this exact local public API (Task 5 extends the same array with the exact `ci:*` API before adding those tasks):

```ts
const publicTasks = [
  "doctor",
  "setup",
  "deps:node",
  "deps:runtime",
  "deps:media-integration",
  "deps:e2e",
  "dev:all",
  "dev:web",
  "dev:server",
  "dev:electron",
  "dev:extension",
  "docs:dev",
  "check",
  "test",
  "test:ts",
  "test:go",
  "test:integration",
  "test:e2e",
  "test:e2e:web",
  "test:e2e:electron",
  "test:e2e:extension",
  "build:web",
  "build:server",
  "build:electron",
  "build:extension",
  "build:docs",
  "build:docker",
  "pack:extension",
  "pack:electron",
  "release:electron",
] as const;
```

The same test must assert:

- `Taskfile.yml` contains one exact `3.51.1` version gate using `{{.TASK_VERSION}}` and an explicit non-zero exit;
- every public task except `doctor` is a sequential wrapper whose first command invokes `internal:require-task-version` and whose second invokes one private implementation task;
- public tasks have `desc`, private tasks have `internal: true`, and `dev:server` aliases `dev:web`;
- profile-loading implementation tasks—not the Taskfile root—contain the Go Task priority order `.env.<profile>.local`, `.env.local`, `.env.<profile>`, `.env` because Task keeps the first file's value; pre-existing process values still win;
- the Taskfile root, `doctor`, and the version gate contain no `dotenv` key;
- Task commands call only the design's exact leaf allowlist (`*:raw`, workspace commands, `pnpm install`, `pnpm exec`, `pnpm start:electron`, Go, Docker, or internal tasks)—never a package script that wraps back into Task;
- every package script called from Task is a non-Task leaf.
- every profile default is exactly `development`, `test`, or `production`, and profile-loading implementations reject any other caller-provided value before their own commands run.

- [ ] **Step 2: Run the contract and verify the root Taskfile is absent**

Run: `pnpm exec vitest run scripts/taskfile-contract.test.ts`

Expected: FAIL because `Taskfile.yml` does not exist.

- [ ] **Step 3: Add the minimal root Taskfile skeleton and raw script names**

Create `Taskfile.yml` with:

```yaml
version: "3"

vars:
  REQUIRED_TASK_VERSION: 3.51.1
  MEDIAGO_DEPS_ROOT: '{{default (printf "%s/.deps" .ROOT_DIR) .MEDIAGO_DEPS_ROOT}}'
```

Add `internal:require-task-version` and working public/private wrappers. The version check must compare `{{.TASK_VERSION}}` to `{{.REQUIRED_TASK_VERSION}}`; `doctor` records a mismatch, continues checking Node/pnpm/Go/Docker and the current-platform runtime tools, then exits non-zero once after all diagnostics. At this checkpoint, implementations may match current behavior without Task 4's additional prerequisites, but every public command must resolve to an existing raw/workspace leaf and remain executable.

In `package.json`, introduce the raw leaf names needed by the skeleton before redirecting any historical entrypoint. At this step raw leaves retain their existing bodies and historical high-level commands remain unchanged, so both entrypoint families work.

- [ ] **Step 4: Parse the Taskfile with the pinned local Task**

Run:

```bash
task --version
task --list-all
pnpm exec vitest run scripts/taskfile-contract.test.ts
```

Expected: Task reports `3.51.1`; list parsing and the complete Task 3 contract PASS. Dependency-edge assertions do not enter the contract until Task 4 Step 1, where they provide the next red state.

- [ ] **Step 5: Commit the API contract and skeleton**

```bash
git add Taskfile.yml package.json pnpm-lock.yaml scripts/taskfile-contract.test.ts
git commit -m "test(task): lock orchestration contracts"
```

### Task 4: Implement Local Development, Test, and Build Dependencies

**Files:**

- Modify: `Taskfile.yml`
- Modify: `package.json`
- Modify: `scripts/taskfile-contract.test.ts`
- Modify: `scripts/ci/e2e-toolchain.test.ts`

- [ ] **Step 1: Add failing exact dependency-edge assertions**

Extend the contract test with a normalized Task graph and assert that historical high-level package scripts wrap matching public Task commands without cycles. Transcribe and assert the complete local matrix—not a subset:

| Implementation                               | Profile     | Exact prerequisites                               | Exact terminal leaf/leaves                                                      |
| -------------------------------------------- | ----------- | ------------------------------------------------- | ------------------------------------------------------------------------------- |
| `internal:setup`                             | development | node, runtime-current                             | none                                                                            |
| `internal:deps:node`                         | no dotenv   | none                                              | `pnpm install --frozen-lockfile`                                                |
| `internal:deps:runtime`                      | no dotenv   | node                                              | `pnpm deps:download:raw --tools ffmpeg,N_m3u8DL-RE,BBDown,aria2,yt-dlp,mediago` |
| `internal:deps:media-integration`            | test        | node                                              | `pnpm deps:download:raw --tools aria2,N_m3u8DL-RE,ffmpeg,BBDown`                |
| `internal:deps:e2e`                          | test        | node                                              | `pnpm deps:download:raw --tools aria2`                                          |
| `internal:dev:all`                           | development | node, runtime-current, core-build, build-electron | `pnpm dev:all:raw`                                                              |
| `internal:dev:web`                           | development | node, runtime-current, core-build                 | `pnpm dev:web:raw`                                                              |
| `internal:dev:electron`                      | development | node, runtime-current, core-build, build-electron | `pnpm start:electron`                                                           |
| `internal:dev:extension`                     | development | node                                              | `pnpm -F @mediago/extension run dev`                                            |
| `internal:docs:dev`                          | development | node                                              | `pnpm -F @mediago/docs run docs:dev`                                            |
| `internal:check`                             | test        | node                                              | `pnpm lint`, `pnpm format:check`, `pnpm type:check`                             |
| `internal:test`                              | test        | node, test-ts, test-go                            | none                                                                            |
| `internal:test:ts`                           | test        | node                                              | `pnpm exec vitest run`                                                          |
| `internal:test:go`                           | test        | none                                              | `go test ./...` in `apps/core`                                                  |
| `internal:test:integration`                  | test        | media-integration                                 | `pnpm test:integration:media:run:raw`                                           |
| `internal:test:e2e`                          | test        | e2e, core-build, e2e-build, Chromium              | `pnpm test:e2e:raw`                                                             |
| `internal:test:e2e:{web,electron,extension}` | test        | e2e, core-build, e2e-build, Chromium              | matching `pnpm test:e2e:<project>:raw`                                          |
| `internal:build:web`                         | production  | node                                              | `pnpm build:web:raw`                                                            |
| `internal:build:server`                      | production  | node, core-build                                  | `pnpm build:server:raw`                                                         |
| `internal:build:electron`                    | production  | node, core-build                                  | `pnpm build:electron:raw`                                                       |
| `internal:build:extension`                   | production  | node                                              | `pnpm -F @mediago/extension run build`                                          |
| `internal:build:docs`                        | production  | node                                              | `pnpm -F @mediago/docs run docs:build`                                          |
| `internal:build:docker`                      | production  | Docker daemon check                               | `docker build -t mediago:local .`                                               |
| `internal:pack:extension`                    | production  | build-extension                                   | `pnpm exec tsx scripts/pack-extension.ts`                                       |
| `internal:pack:electron`                     | production  | runtime-current, core-build, build-electron       | `pnpm -F @mediago/electron run pack`                                            |
| `internal:release:electron`                  | production  | runtime-current, core-build, build-electron       | `pnpm -F @mediago/electron run release`                                         |

Assert `dev:server` points to `internal:dev:web`. Assert `deps:node` sources cover every workspace manifest currently selected by `pnpm-workspace.yaml`: root, `docs/package.json`, `apps/*/package.json`, `apps/*/app/package.json`, `packages/*/package.json`, and `packages/*/*/package.json`, plus the workspace/lock files; use `node_modules/.pnpm/lock.yaml` as its generated marker.

In the same initially failing contract, assert the top-level `MEDIAGO_DEPS_ROOT` default is exactly `{{.ROOT_DIR}}/.deps` while caller-provided environment takes precedence; every runtime-consuming implementation receives that root plus `MEDIAGO_DEPS_DIR={{.MEDIAGO_DEPS_ROOT}}/<platform-key>` where `<platform-key>` comes from `scripts/print-platform-key.ts`; and no task treats a leaf as the root. Assert the exact production `requires` sets: `build:electron` requires only `APP_NAME`, while `pack:electron` and `release:electron` require `APP_NAME`, `APP_ID`, and `APP_COPYRIGHT`.

Exercise the actual parsed `requires` blocks safely: for each production task, generate a temporary minimal Taskfile fixture containing that task's real normalized `requires` metadata, no `dotenv`, no dependencies, and a no-op command. Spawn pinned `task --dry --taskfile <fixture>` from the temp directory with all three packaging variables first removed from the child environment, then with non-missing variables set to distinct sentinel secret values. Require the missing-variable diagnostic to name only the absent variables and never contain any sentinel value or other environment content. Because the fixture has no dotenv/dependencies and runs dry, the red-contract check cannot read repository `.env` files or start a build/pack/release side effect.

- [ ] **Step 2: Run the focused contract and verify missing graph edges**

Run: `pnpm exec vitest run scripts/taskfile-contract.test.ts`

Expected: FAIL with named missing prerequisites/leaves.

- [ ] **Step 3: Split high-level package scripts from raw leaves**

Keep low-level scripts such as `lint`, `format:check`, `type:check`, `test:ts`, `core:build`, and workspace invocations as leaves. Add or rename these orchestration leaves:

```json
{
  "dev:all:raw": "concurrently --kill-others-on-fail --names backend,electron-ui,server-ui \"cross-env APP_TARGET=electron turbo run dev -F @mediago/server -F @mediago/electron\" \"cross-env APP_TARGET=electron pnpm -F @mediago/ui run dev\" \"cross-env APP_TARGET=server pnpm -F @mediago/ui run dev\"",
  "dev:web:raw": "cross-env APP_TARGET=server NODE_ENV=development turbo run dev -F @mediago/server -F @mediago/ui",
  "build:web:raw": "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/ui",
  "build:server:raw": "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/server -F @mediago/ui",
  "build:electron:raw": "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/electron -F @mediago/ui -F @mediago/extension",
  "deps:download:raw": "tsx scripts/download-deps.ts",
  "test:integration:media:run:raw": "vitest run --config vitest.integration.config.ts",
  "test:e2e:build:raw": "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/server -F @mediago/electron -F @mediago/electron-preload -F @mediago/extension",
  "test:e2e:raw": "playwright test",
  "test:e2e:web:raw": "playwright test --project=web",
  "test:e2e:electron:raw": "playwright test --project=electron",
  "test:e2e:extension:raw": "playwright test --project=extension"
}
```

Change historical high-level entries (`dev:*`, `build:*`, `docs:*`, `check`, aggregate test/integration/E2E orchestration, pack/release, and dependency download) to `task <matching-public-name>`. Keep low-level `test:ts`, `lint`, `format:check`, `type:check`, `core:build`, and `prepare: husky` as leaves. Update `scripts/ci/e2e-toolchain.test.ts` to assert the new wrappers and exact raw Playwright leaves instead of the pre-migration command bodies.

- [ ] **Step 4: Fill the Task dependency graph and environment leaf contract**

Implement all public tasks from Task 3. Every private implementation sets its specified profile default without overriding caller-provided `MEDIAGO_PROFILE`. Runtime-consuming leaves receive `MEDIAGO_DEPS_ROOT` plus `MEDIAGO_DEPS_DIR={{.MEDIAGO_DEPS_ROOT}}/<platform-key>`, where the key comes from `scripts/dependency-layout.ts` rather than duplicated shell platform logic.

The top-level root variable defaults exactly to `{{.ROOT_DIR}}/.deps` and loads no dotenv; a caller environment value still wins. Add non-value-printing production preconditions: `build:electron` requires `APP_NAME`; `pack:electron` and `release:electron` require `APP_NAME`, `APP_ID`, and `APP_COPYRIGHT`. Error text lists only missing variable names.

After runtime provisioning/validation, print `MEDIAGO_RUNTIME_READY <runtime-leaf>`; immediately before the persistent `dev:all:raw` leaf, print `MEDIAGO_DEV_PROCESSES_STARTING`. These stable, non-secret readiness boundary markers are consumed by Task 13's bounded ordering smoke test.

Keep Playwright browser/install-deps in `test:e2e`; do not add them to `deps:e2e`. Use `xvfb-run -a` only in `ci:test:e2e`, not the local project-specific variants.

- [ ] **Step 5: Verify every local public task structurally and run safe representatives**

Run:

```bash
pnpm exec vitest run scripts/taskfile-contract.test.ts
task --list-all
task test:ts
task test:go
task build:server
task doctor || [ "$?" -eq 1 ]
```

Expected: contract/list/test/build PASS. `doctor` must print every diagnostic; it returns zero only when all detected prerequisites are ready, otherwise its accurately named nonzero result is acceptable for this representative run and does not prevent the structural/tests/build checks.

- [ ] **Step 6: Commit local orchestration**

```bash
git add Taskfile.yml package.json scripts/taskfile-contract.test.ts scripts/ci/e2e-toolchain.test.ts
git commit -m "feat(task): orchestrate local workflows"
```

### Task 5: Migrate PR CI and Documentation CI

**Files:**

- Create: `scripts/ci/task-workflow-contract.test.ts`
- Modify: `scripts/ci/e2e-workflow.test.ts`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/build-docs.yml`
- Modify: `Taskfile.yml`
- Modify: `scripts/taskfile-contract.test.ts`

- [ ] **Step 1: Write failing workflow-to-Task contract tests**

For `ci.yml` and `build-docs.yml`, assert that each job executing repository commands first installs. Put each workflow's assertions in a test/describe title containing the exact basename (`ci.yml` or `build-docs.yml`) so the focused `-t` runs below are contractual:

```yaml
- uses: go-task/setup-task@v1
  with:
    version: 3.51.1
```

Assert exact entrypoint mappings: `task ci:quality`, `task ci:test:ts`, `task ci:test:go`, `task ci:test:media`, `task ci:test:e2e`, and `task ci:docs:build`. Permit the `pr-gate` shell because it only aggregates job results and OSS CLI setup/upload because those are platform actions. Reject direct high-level pnpm repository orchestration or a missing/variable Task version.

- [ ] **Step 2: Run workflow contracts and verify direct commands are detected**

Run:

```bash
pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts scripts/ci/e2e-workflow.test.ts
```

Expected: FAIL and name the existing direct workflow commands.

- [ ] **Step 3: Add the exact CI public/private Task contracts**

Extend the exact public-task array and description/version-wrapper checks with the six names above. Implement:

| CI implementation        | Profile              | Prerequisites               | Ordered leaves                                                                                                      |
| ------------------------ | -------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `internal:ci:quality`    | inherited from local | `internal:check`            | none                                                                                                                |
| `internal:ci:test:ts`    | inherited from local | `internal:test:ts`          | none                                                                                                                |
| `internal:ci:test:go`    | inherited from local | `internal:test:go`          | none                                                                                                                |
| `internal:ci:test:media` | inherited from local | `internal:test:integration` | none                                                                                                                |
| `internal:ci:test:e2e`   | test                 | e2e, core-build, e2e-build  | Playwright `install-deps chromium`, `install chromium`, `pnpm type:check:e2e`, then `xvfb-run -a pnpm test:e2e:raw` |
| `internal:ci:docs:build` | inherited from local | `internal:build:docs`       | none                                                                                                                |

Use the Task dotenv ordering from Task 3 for test/production profiles. `ci:test:go` must not install Node or media tools; Docs must not download runtime tools.

- [ ] **Step 4: Migrate and verify `.github/workflows/ci.yml`**

Install pinned Task after checkout in the five repository-command jobs, replace their command sequences with the matching Task entry, and preserve setup actions, caches, token env, failure artifacts, `pr-gate`, permissions, and timeouts.

Run: `pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts -t 'ci.yml' && pnpm exec vitest run scripts/ci/e2e-workflow.test.ts scripts/ci/e2e-toolchain.test.ts`

Expected: CI workflow mappings PASS.

- [ ] **Step 5: Migrate and verify `.github/workflows/build-docs.yml`**

Install pinned Task in the build job and replace install/build repository commands with `task ci:docs:build`; preserve Java/OSS installation, cache behavior, upload, permissions, and triggers.

Run: `pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts`

Expected: Docs mapping PASS and platform steps remain allowlisted.

- [ ] **Step 6: Verify PR/docs migration and type coverage**

Run:

```bash
pnpm exec vitest run scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts scripts/ci/e2e-workflow.test.ts scripts/ci/e2e-toolchain.test.ts
pnpm type:check:ci
```

Expected: PASS; no test reports a direct repository orchestration command.

- [ ] **Step 7: Commit PR/docs workflow migration**

```bash
git add Taskfile.yml .github/workflows/ci.yml .github/workflows/build-docs.yml scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts scripts/ci/e2e-workflow.test.ts
git commit -m "ci: route validation workflows through Task"
```

### Task 6: Migrate Desktop, Docker, and Release Workflow Commands

**Files:**

- Modify: `Taskfile.yml`
- Modify: `scripts/taskfile-contract.test.ts`
- Modify: `scripts/ci/task-workflow-contract.test.ts`
- Modify: `.github/workflows/build-electron.yml`
- Modify: `.github/workflows/build-server.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Add failing exact metadata/release Task contracts**

Extend the exact public API, description/version-wrapper checks, and workflow mappings with. Put each workflow's assertions in a test/describe title containing the exact basename (`build-electron.yml`, `build-server.yml`, or `release.yml`) so each focused `-t` invocation below selects a nonempty contract:

- Desktop: `ci:desktop:validate-request`, `verify-source`, `artifact-prefix`, `apply-version`, and `release`.
- Docker: `ci:docker:validate-inputs`, `resolve-parameters`, `verify-preview-private`, `detect-dockerhub`, `resolve-targets`, and `write-summary`.
- Release: `ci:release:validate-request`, `detect-release-state`, `calculate-version`, `commit-version`, `resolve-source`, `write-prepare-summary`, `collect-electron-artifacts`, `publish-desktop`, `write-desktop-summary`, and `tag-docker-release`.

Every metadata/publish implementation has `internal: true`, no profile/dotenv, and one exact `node scripts/ci/<workflow>.ts <same-command>` leaf. Artifact collection uses exactly `node scripts/collect-electron-artifacts.ts electron-artifacts release-files "$VERSION" "$UPDATER_CHANNEL"`. `ci:desktop:release` uses production profile and depends on node, runtime-current, and `internal:release:electron`.

Run: `pnpm exec vitest run scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts`

Expected: FAIL listing the absent tasks/direct commands.

- [ ] **Step 2: Implement metadata wrappers without copying environment validation**

Add the public/private tasks exactly as listed. Metadata/publish tasks forward the workflow step environment unchanged and leave required-variable/type validation solely in the existing TypeScript scripts. Do not install Node/media tools for metadata-only tasks and do not load project dotenv.

- [ ] **Step 3: Migrate and verify the desktop workflow**

Install pinned Task in both `prepare` and matrix `build` jobs. Replace four metadata commands and the install/download/build sequence with their Task entries; preserve step IDs/outputs, source checkout, matrix, setup actions, secrets, signing, and artifact upload. Remove the unused `swag@latest` install and nothing else.

Run: `pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts -t 'build-electron.yml' && pnpm exec vitest run scripts/ci/desktop-workflow.test.ts`

Expected: PASS for desktop mappings and metadata behavior.

- [ ] **Step 4: Migrate and verify the Server/Docker workflow**

Install pinned Task in every job that invokes a repository script and replace the six commands one-for-one. Keep Buildx, login, build-push, matrices, caches, secrets, outputs, summaries, conditions, and permissions in Actions.

Run: `pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts -t 'build-server.yml' && pnpm exec vitest run scripts/ci/docker-workflow.test.ts`

Expected: PASS for Docker metadata mappings; Buildx remains untouched.

- [ ] **Step 5: Migrate and verify the release workflow**

Install pinned Task in every job with a repository command and replace all ten release/artifact commands one-for-one. Keep reusable workflows, job outputs/conditions, checkout credentials, GitHub Release, artifact download/upload, Docker invocation, and permissions in YAML.

Run: `pnpm exec vitest run scripts/ci/task-workflow-contract.test.ts -t 'release.yml' && pnpm exec vitest run scripts/ci/release-workflow.test.ts scripts/collect-electron-artifacts.test.ts`

Expected: PASS for all release mappings and artifact behavior.

- [ ] **Step 6: Verify and commit workflow command migration**

Run:

```bash
pnpm exec vitest run scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts scripts/ci/desktop-workflow.test.ts scripts/ci/docker-workflow.test.ts scripts/ci/release-workflow.test.ts scripts/collect-electron-artifacts.test.ts
pnpm type:check:ci
```

Expected: PASS; no workflow contains a forbidden direct repository command, and every new public task is guarded/described.

```bash
git add Taskfile.yml .github/workflows/build-electron.yml .github/workflows/build-server.yml .github/workflows/release.yml scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts
git commit -m "ci: route build and release workflows through Task"
```

### Task 7: Keep Docker Leaves Explicit and Update Startup Documentation

**Files:**

- Modify: `Dockerfile`
- Modify: `README.md`
- Modify: `README.zh.md`
- Modify: `README.jp.md`
- Modify: `README.it.md`
- Modify: `CONTRIBUTING.md`
- Modify: `apps/core/README.md`
- Modify: `apps/electron/README.md`
- Modify: `apps/ui/README.md`
- Modify: `scripts/taskfile-contract.test.ts`
- Modify: `scripts/ci/task-workflow-contract.test.ts`

- [ ] **Step 1: Add failing Docker and documentation allowlist tests**

Extend `scripts/taskfile-contract.test.ts` to require Dockerfile repository commands to be limited to:

```text
pnpm install --frozen-lockfile
pnpm --filter @mediago/player-ui run build
pnpm build:web:raw
pnpm deps:download:raw --platform <resolved build platform>
```

Scan the eight normative documentation files. Require Task `3.51.1` installation/version guidance and canonical `task setup`, `task dev:all`, `task dev:web`, `task dev:electron`, `task check`, and `task test` where the document covers that concern. Reject startup/build code blocks that recommend migrated high-level `pnpm` commands; permit component API, package-install, and workspace-only examples.

- [ ] **Step 2: Run the contract and verify old Docker/docs commands are found**

Run: `pnpm exec vitest run scripts/taskfile-contract.test.ts`

Expected: FAIL listing `pnpm build:web`, `pnpm deps:download`, and outdated startup/build blocks.

- [ ] **Step 3: Switch only Docker's repository leaves**

Keep Task out of the image. Preserve multi-stage/build-platform behavior and replace only the two high-level invocations with `pnpm build:web:raw` and `pnpm deps:download:raw --platform "$(cat /tmp/deps-platform)"`.

- [ ] **Step 4: Update the normative documentation set**

Document fixed Task `v3.51.1` setup for macOS, Linux, and Windows without adding an auto-download wrapper. Make `task setup` then `task dev:all` the primary clone/start flow; explain that dependency versions come only from `scripts/deps-versions.json`, `pnpm install` alone does not install BBDown, and `dev:server` is an alias for `dev:web`. Replace repository orchestration commands while leaving unrelated package-manager/component examples intact.

- [ ] **Step 5: Format and verify orchestration migration**

Run:

```bash
pnpm exec oxfmt README.md README.zh.md README.jp.md README.it.md CONTRIBUTING.md apps/core/README.md apps/electron/README.md apps/ui/README.md scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts
pnpm exec vitest run scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts
task check
```

Expected: formatting and all contracts/checks PASS.

- [ ] **Step 6: Commit Docker and documentation migration**

```bash
git add Dockerfile README.md README.zh.md README.jp.md README.it.md CONTRIBUTING.md apps/core/README.md apps/electron/README.md apps/ui/README.md scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts
git commit -m "docs: make Task the canonical repository entrypoint"
```

## Chunk 3: Bilibili ID, BBDown Failure, and End-to-End Regression

### Task 8: Make Missing Runtime Binaries Typed Core Errors

**Files:**

- Create: `apps/core/internal/core/dependency_error.go`
- Create: `apps/core/internal/core/dependency_error_test.go`
- Modify: `apps/core/internal/core/downloader.go`
- Modify: `apps/core/internal/core/downloader_contract_test.go`

- [ ] **Step 1: Write a failing typed BBDown-missing test**

Create a downloader with a valid Bilibili schema, a `TypeBilibili` binary path inside `t.TempDir()` that does not exist, and a runner spy. Assert:

```go
var dependencyErr *DependencyError
if !errors.As(err, &dependencyErr) {
    t.Fatalf("Download error = %v, want *DependencyError", err)
}
if dependencyErr.Tool != "BBDown" || dependencyErr.ExpectedPath != missingPath {
    t.Fatalf("DependencyError = %#v", dependencyErr)
}
if runner.called {
    t.Fatal("runner called for a missing dependency")
}
```

Also assert `errors.Is(err, os.ErrNotExist)` so the wrapped filesystem cause remains available.

- [ ] **Step 2: Run the focused Go test and verify the type is missing**

Run: `cd apps/core && go test ./internal/core -run 'TestDependencyError|TestDownloaderMissingBBDown'`

Expected: FAIL because `DependencyError` is undefined.

- [ ] **Step 3: Implement the single-responsibility error type**

```go
type DependencyError struct {
    Tool         string
    ExpectedPath string
    Err          error
}

func (e *DependencyError) Error() string {
    return fmt.Sprintf("required dependency %s is missing at %s: %v", e.Tool, e.ExpectedPath, e.Err)
}

func (e *DependencyError) Unwrap() error { return e.Err }
```

When the configured downloader path fails `os.Stat`, return this type using `filepath.Base(bin)` with `.exe` removed for a stable cross-platform tool name. Keep “download type has no configured binary” as a separate configuration error.

- [ ] **Step 4: Run core downloader contracts**

Run:

```bash
gofmt -w apps/core/internal/core/dependency_error.go apps/core/internal/core/dependency_error_test.go apps/core/internal/core/downloader.go apps/core/internal/core/downloader_contract_test.go
cd apps/core && go test ./internal/core -run 'TestDependencyError|TestDownloaderMissingBBDown|TestDownloader.*Contract'
cd apps/core && go test ./internal/core
```

Expected: PASS; the existing fake BBDown argv/progress contracts remain green.

- [ ] **Step 5: Commit the typed dependency boundary**

```bash
git add apps/core/internal/core/dependency_error.go apps/core/internal/core/dependency_error_test.go apps/core/internal/core/downloader.go apps/core/internal/core/downloader_contract_test.go
git commit -m "fix(core): type missing downloader dependencies"
```

### Task 9: Keep Download IDs and Queue Task IDs as Separate HTTP Contracts

**Files:**

- Create: `apps/core/internal/api/handler/error_response.go`
- Create: `apps/core/internal/api/handler/error_response_test.go`
- Modify: `apps/core/internal/api/dto/response.go`
- Modify: `apps/core/internal/api/handler/download.go`
- Modify: `apps/core/internal/api/handler/task.go`
- Modify: `apps/core/internal/service/download_task.go`
- Modify: `apps/core/internal/service/download_task_test.go`

- [ ] **Step 1: Write failing handler wire-contract tests**

Using `httptest` and Gin test mode, assert:

- `/api/downloads/not-a-number` produces HTTP 400, integer `code: 400`, and string `errorCode: "invalid_id"`;
- a valid numeric but absent Download ID produces HTTP 404 and `errorCode: "download_not_found"`;
- `/api/tasks/custom-queue-id` and `/api/tasks/550e8400-e29b-41d4-a716-446655440000` reach string queue lookup without numeric parsing, and absence yields `task_not_found`.

Add a JSON marshal regression proving `errorCode` is omitted when empty, so existing clients remain compatible.

Make the fixtures constructible inside package `handler`: open `db.New(filepath.Join(t.TempDir(), "mediago.db"))`, register `t.Cleanup(database.Close)`, build `repo.NewVideoRepository`, `service.NewDownloadTaskService(videoRepo, nil, nil)`, the existing-style `recordingConfigStore`, and `sse.New()` for `DownloadHandler`. Build `TaskHandler` with `core.NewTaskQueue(nil, 1)`; Get/absence tests do not enqueue, so no downloader runs. Register only the tested routes on `gin.New()`.

- [ ] **Step 2: Add a failing service conversion test**

Extract `downloadParamsForVideo(video *db.Video, downloadID int64)` and test that Download ID `42` becomes `core.TaskID("42")`, while Bilibili `type`, source URL, stored Cookie/Referer headers, name, and folder are preserved. Keeping the boundary parameter typed as `int64` makes a UUID/source string impossible to pass without an explicit, review-visible conversion.

- [ ] **Step 3: Run focused Go tests and verify error codes/helper are absent**

Run:

```bash
cd apps/core && go test ./internal/api/handler -run 'Test.*ID|TestErrorResponse'
cd apps/core && go test ./internal/service -run 'TestDownloadParamsForVideo'
```

Expected: FAIL on missing `errorCode` and conversion helper.

- [ ] **Step 4: Implement stable HTTP errors and explicit conversion**

Add this backward-compatible field to `dto.ErrorResponse`:

```go
ErrorCode string `json:"errorCode,omitempty"`
```

Centralize the three stable codes in small handler helpers so download endpoints consistently parse positive decimal IDs and task endpoints never call `strconv.ParseInt`. Preserve the current HTTP integer `code` and localized `message`.

Call `downloadParamsForVideo(video, taskID)` from `StartDownload`; the helper performs the single `strconv.FormatInt(downloadID, 10)` at the persisted Download ID → Queue Task ID boundary.

- [ ] **Step 5: Run handler/service packages and format Go**

Run:

```bash
gofmt -w apps/core/internal/api/dto/response.go apps/core/internal/api/handler/error_response.go apps/core/internal/api/handler/error_response_test.go apps/core/internal/api/handler/download.go apps/core/internal/api/handler/task.go apps/core/internal/service/download_task.go apps/core/internal/service/download_task_test.go
cd apps/core && go test ./internal/api/handler ./internal/service
```

Expected: PASS; UUID/custom Queue Task IDs remain valid strings.

- [ ] **Step 6: Commit the ID/error wire contracts**

```bash
git add apps/core/internal/api/dto/response.go apps/core/internal/api/handler/error_response.go apps/core/internal/api/handler/error_response_test.go apps/core/internal/api/handler/download.go apps/core/internal/api/handler/task.go apps/core/internal/service/download_task.go apps/core/internal/service/download_task_test.go
git commit -m "fix(api): distinguish download and queue task IDs"
```

### Task 10: Map Dependency Failures to Stable SSE Payloads

**Files:**

- Create: `apps/core/internal/api/server/task_failure.go`
- Create: `apps/core/internal/api/server/task_failure_test.go`
- Create: `apps/core/internal/api/server/download_identity_test.go`
- Modify: `apps/core/internal/api/server/queue_callbacks.go`
- Modify: `packages/core-sdk/src/types.ts`
- Modify: `packages/shared/common/src/types/index.ts`

- [ ] **Step 1: Write failing pure failure-mapping tests**

Test `taskFailurePayload(core.TaskID("42"), err)` for:

```json
{
  "id": "42",
  "errorCode": "dependency_missing",
  "error": "Required dependency BBDown is missing",
  "dependency": "BBDown"
}
```

when `err` wraps `*core.DependencyError`, and require `errorCode: "download_failed"`, the same string ID, the existing error text, and no dependency field for a generic error. Include a wrapped dependency error to prove `errors.As`, not a direct type assertion, is used.

- [ ] **Step 2: Run the server test and verify the mapper is missing**

Run: `cd apps/core && go test ./internal/api/server -run TestTaskFailurePayload`

Expected: FAIL because `taskFailurePayload` is undefined.

- [ ] **Step 3: Implement and wire the pure mapper**

Return a typed struct with `json` tags rather than `map[string]interface{}`. Keep complete `err.Error()` in task logs, but broadcast only the stable dependency message/fields for `DependencyError`. Replace the existing `download-failed` map in `queue_callbacks.go` with the mapper result.

- [ ] **Step 4: Extend TypeScript wire types backward-compatibly**

Add `errorCode?: "dependency_missing" | "download_failed"` and `dependency?: string` to core-sdk and shared failure payloads. Keep `id: string` in core-sdk and `id: number` only after the UI parser boundary.

- [ ] **Step 5: Add a real POST → queue → SSE identity integration test**

In package `server`, build `Server.New` with a temp SQLite database, a minimal ConfigStore, and a controllable fake `core.Downloader`. Subscribe to `srv.hub` before sending `POST /api/downloads` with one `startDownload: true` Bilibili task. For success and failure subtests:

1. decode the real `SuccessResponse.data[0].id` as a positive JSON number;
2. capture the fake downloader's `DownloadParams.ID` and require the exact decimal string;
3. read `download-start`, then release the fake downloader;
4. read `download-success` or `download-failed` and require every event ID to equal `strconv.FormatInt(responseID, 10)`;
5. in the failure subtest, return a wrapped `DependencyError` and assert the real event payload contains `dependency_missing`/`BBDown`.

Use bounded channel receives with `time.After`. Register cleanup immediately after constructing the fake: idempotently close/release its gate, wait on a bounded completion signal for any started download, then unsubscribe and close the database. This cleanup must run even when an assertion or event receive fails before the normal release point, so no downloader goroutine can retain the queue/database.

- [ ] **Step 6: Run Go and TypeScript checks**

Run:

```bash
gofmt -w apps/core/internal/api/server/task_failure.go apps/core/internal/api/server/task_failure_test.go apps/core/internal/api/server/download_identity_test.go apps/core/internal/api/server/queue_callbacks.go
cd apps/core && go test ./internal/api/server
pnpm type:check
```

Expected: PASS.

- [ ] **Step 7: Commit SSE failure mapping**

```bash
git add apps/core/internal/api/server/task_failure.go apps/core/internal/api/server/task_failure_test.go apps/core/internal/api/server/download_identity_test.go apps/core/internal/api/server/queue_callbacks.go packages/core-sdk/src/types.ts packages/shared/common/src/types/index.ts
git commit -m "fix(api): expose dependency failures over SSE"
```

### Task 11: Reject Invalid Download SSE IDs and Show the BBDown Error

**Files:**

- Create: `apps/ui/src/api/download-event-payload.ts`
- Create: `apps/ui/src/api/download-event-payload.test.ts`
- Create: `apps/ui/src/api/events.test.ts`
- Create: `apps/ui/src/hooks/download-failure-handler.ts`
- Create: `apps/ui/src/hooks/download-failure-handler.test.ts`
- Modify: `apps/ui/src/api/events.ts`
- Modify: `apps/ui/src/hooks/use-tasks.ts`
- Modify: `packages/shared/common/src/i18n/resources/en.ts`
- Modify: `packages/shared/common/src/i18n/resources/zh.ts`
- Modify: `packages/shared/common/src/i18n/resources/it.ts`

- [ ] **Step 1: Write failing strict parser tests**

Test a pure parser that accepts only positive safe-integer decimal strings (`"1"`, `"42"`) for persisted download SSE events. Reject `"0"`, negative, whitespace-padded, decimal, exponent, UUID, empty, `null`, `undefined`, and values above `Number.MAX_SAFE_INTEGER`. For failure payloads, preserve validated `error`, `errorCode`, and `dependency` fields.

- [ ] **Step 2: Run the parser suite and verify the module is absent**

Run: `pnpm exec vitest run apps/ui/src/api/download-event-payload.test.ts`

Expected: FAIL because the parser module does not exist.

- [ ] **Step 3: Implement and wire one parser boundary**

Use `/^[1-9]\d*$/`, `Number.isSafeInteger`, and no coercion of non-strings. In every start/success/failure/stop SSE listener, catch malformed JSON or invalid IDs, log one protocol warning without sensitive values, and return without dispatching or starting a follow-up fetch. Remove all blind `Number(payload.id)` conversions on these events.

Extract an internal `registerDownloadSseListeners(eventSource, collaborators)` seam and have the normal initializer call it with the production dispatch/polling functions. In `events.test.ts`, register a fake `EventSource` through that seam with dispatch/start-polling/stop-polling spies; this exercises the real listeners without triggering the initializer's intentional first polling cycle. Emit malformed JSON and every invalid-ID class through each registered listener and assert zero dispatches, zero polling callbacks, and zero HTTP calls. Emit ID `"42"` and assert one correctly typed event. Add one initializer test separately to preserve its initial-poll contract. Also assert no requested URL contains `NaN`, `undefined`, or a UUID/source-media ID.

- [ ] **Step 4: Add a testable dependency-message selector**

Implement `handleDownloadFailure(event, { translate, notify, revalidate })` in the focused helper and call it from `useTasks`. Dependency failures select `translate("dependencyMissing", { dependency })`; generic failures retain the server error or localized fallback. Add the three translations, including a Chinese message that names BBDown.

Unit-test the helper with spies: a `dependency_missing`/BBDown event calls `notify` exactly once with the localized message and `revalidate` exactly once; a generic event does the same with its server text. This keeps toast behavior testable without mounting SWR/Zustand/React.

- [ ] **Step 5: Run focused UI tests and types**

Run:

```bash
pnpm exec vitest run apps/ui/src/api/download-event-payload.test.ts apps/ui/src/api/events.test.ts apps/ui/src/hooks/download-failure-handler.test.ts
pnpm type:check
```

Expected: PASS; invalid ID cases produce no download event.

- [ ] **Step 6: Commit the UI protocol boundary**

```bash
git add apps/ui/src/api/download-event-payload.ts apps/ui/src/api/download-event-payload.test.ts apps/ui/src/api/events.ts apps/ui/src/api/events.test.ts apps/ui/src/hooks/download-failure-handler.ts apps/ui/src/hooks/download-failure-handler.test.ts apps/ui/src/hooks/use-tasks.ts packages/shared/common/src/i18n/resources/en.ts packages/shared/common/src/i18n/resources/zh.ts packages/shared/common/src/i18n/resources/it.ts
git commit -m "fix(ui): validate download events and report missing tools"
```

### Task 12: Validate Extension Import IDs and Cover Bilibili Capture

**Files:**

- Create: `packages/mediago-extension/src/background/mediago-response.ts`
- Create: `packages/mediago-extension/src/background/mediago-response.test.ts`
- Create: `tests/e2e/support/fake-dependencies.ts`
- Modify: `packages/mediago-extension/src/background/mediago-client.ts`
- Modify: `tests/e2e/support/core-process.ts`
- Modify: `tests/e2e/extension/capture-and-download.spec.ts`

- [ ] **Step 1: Write failing HTTP success-response validator tests**

Require the exact response envelope to have `success: true`, `data` as an array with the requested count, and every item containing a positive safe integer numeric `id`. Reject missing/extra rows, string/zero/fractional/unsafe IDs, non-JSON, `success: false`, and malformed data. Return the validated Download IDs rather than fabricating them from source URLs.

- [ ] **Step 2: Run the extension unit suite and verify the module is absent**

Run: `pnpm exec vitest run packages/mediago-extension/src/background/mediago-response.test.ts`

Expected: FAIL because `mediago-response.ts` does not exist.

- [ ] **Step 3: Decode the successful import response before reporting success**

After `res.ok`, parse JSON and call the validator with `sources.length`. On parse/shape/count/ID failure, return `{ ok: false, count: 0, error: errorToText(error) }`; on success, report the validated count. Preserve existing HTTP error-body handling and schema transport behavior.

- [ ] **Step 4: Give the Core fixture an explicit isolated dependency leaf**

Add optional `depsDirectory` to `StartCoreProcessOptions`; resolve it, validate `aria2c`, and pass exactly that value to `--deps-dir`, retaining the repository `.deps/linux-x64` default for other callers.

Implement `createFakeBilibiliDependencyLeaf(runtimeRoot)` to create `<runtimeRoot>/deps`, copy/chmod the already provisioned E2E `aria2c`, and write/chmod a deterministic fake `BBDown` executable. The fake records JSON argv to a returned path and exits zero. The extension fixture creates this leaf before Core startup and passes it explicitly; cleanup is covered by its existing runtime-root `rm` in `finally`.

- [ ] **Step 5: Extend Playwright with a controlled Bilibili capture fixture**

Keep all browser network local. After opening the local active tab, inject a captured-source fixture through the extension worker into `chrome.storage.session` key `mediago.tab.<activeTabId>` and set its badge. The fixture uses URL `https://www.bilibili.com/video/BV1MediaGoFixture`, `type: "bilibili"`, and stored `Referer`/`Cookie` header lines; this is controlled captured state, not a real navigation or a claim that current page-level sniffing synthesizes headers.

In the extension E2E:

- wait for the popup row to show `bilibili`;
- click Import and inspect the intercepted/recorded `/api/downloads` body;
- assert `type: "bilibili"`, the captured page URL, stored Cookie/Referer headers, and `startDownload: true`;
- let the local core return its real success wire shape and assert the response contains one positive numeric Download ID;
- let the explicit fake `BBDown` record argv; assert the captured source URL and `--cookie` value are present (Referer remains asserted in the POST body because the BBDown schema consumes Cookie only);
- add route-level malformed success-response cases for missing ID, string ID, and wrong item count, and assert the popup reports import failure without claiming imported tasks.

Use `BrowserContext.route` on the local Core `/api/downloads`: for the valid case record `request.postDataJSON()`, forward with `route.fetch()`, decode/record the real response, and fulfill it unchanged. For malformed cases fulfill local HTTP 200 JSON directly. Track every Core request URL and assert none contains `NaN`, `undefined`, the Bilibili URL, or the fixture's source ID as a Download ID path segment.

Do not contact bilibili.com, require login/cookies, or parse current upstream markup.

- [ ] **Step 6: Run extension unit and project E2E tests**

Run:

```bash
pnpm exec vitest run packages/mediago-extension/src/background/mediago-response.test.ts
task test:e2e:extension
pnpm type:check:e2e
```

Expected: PASS; the E2E records BBDown execution and never requests `/api/downloads/NaN`, `/undefined`, or a source-media ID.

- [ ] **Step 7: Commit Bilibili import regression coverage**

```bash
git add packages/mediago-extension/src/background/mediago-response.ts packages/mediago-extension/src/background/mediago-response.test.ts packages/mediago-extension/src/background/mediago-client.ts tests/e2e/support/fake-dependencies.ts tests/e2e/support/core-process.ts tests/e2e/extension/capture-and-download.spec.ts
git commit -m "test(extension): cover Bilibili import and BBDown execution"
```

### Task 13: Verify the Complete Migration From an Isolated Dependency Root

**Files:**

- Create: `scripts/verify-isolated-runtime-deps.ts`
- Create: `scripts/smoke-dev-all.ts`
- Modify: `tsconfig.ci.json`

- [ ] **Step 1: Run all static contracts and formatting**

Run:

```bash
pnpm format
pnpm exec vitest run scripts/taskfile-contract.test.ts scripts/ci/task-workflow-contract.test.ts scripts/dependency-layout.test.ts scripts/load-profile-env.test.ts packages/mediago-extension/src/background/mediago-response.test.ts apps/ui/src/api/download-event-payload.test.ts
task check
```

Expected: PASS with no formatting diff.

- [ ] **Step 2: Run full Go, TypeScript, media, and E2E suites**

Run:

```bash
task test
task test:integration
task test:e2e
```

Expected: PASS.

- [ ] **Step 3: Verify pinned isolated dependency provisioning**

Implement `verify-isolated-runtime-deps.ts` with `mkdtemp(path.join(tmpdir(), "mediago-runtime-"))` and a `try/finally` that first verifies `path.dirname(root) === tmpdir()` and `path.basename(root).startsWith("mediago-runtime-")`, then removes only that exact root. Spawn `task deps:runtime` with `MEDIAGO_DEPS_ROOT=root`. On complete runtime-matrix platforms, assert `<root>/<platformKeyFor(process.platform, process.arch)>/BBDown[.exe]` is a nonempty executable file (skip POSIX X_OK only for Windows), then decode `<root>/.state/<platform>.json` and compare its BBDown repo/version/asset/name to `scripts/deps-versions.json`—no copied version constant, latest API, or manifest write. On `win32-arm64`, where the pinned manifest intentionally has no complete FFmpeg asset, instead require `task deps:runtime` to fail before creating a ready state and assert its diagnostic names FFmpeg, the pinned version, `win32-arm64`, the expected executable path, and the selective retry command; this expected unsupported full-runtime branch is a verifier PASS, not a provisioning success.

Run: `pnpm exec tsx scripts/verify-isolated-runtime-deps.ts`

Expected: PASS and report the exact pinned manifest version (currently `1.6.3`) before cleaning the validated temp root, or report the verified pinned-manifest limitation on `win32-arm64`.

This step requires normal network access to the pinned release assets. Always remove the explicitly captured temporary directory afterward, including on failure.

- [ ] **Step 4: Verify representative production paths**

Run:

```bash
task build:server
task build:electron
task build:docs
task build:docker
```

Expected: PASS on a machine with a Docker daemon; if Docker is unavailable, record that environmental limitation while keeping the Dockerfile/static workflow contracts green.

- [ ] **Step 5: Smoke-test startup ordering without leaving processes behind**

Implement `smoke-dev-all.ts` for Linux/macOS with a validated `mediago-dev-smoke-*` temp root and detached process group. Spawn `xvfb-run -a task dev:all` on Linux and `task dev:all` on macOS with `MEDIAGO_DEPS_ROOT` explicitly set to that empty validated temp root, capture bounded stdout/stderr, enforce a 120-second deadline, and wait for all of:

- `MEDIAGO_RUNTIME_READY` followed later by `MEDIAGO_DEV_PROCESSES_STARTING` in that order;
- HTTP readiness on UI ports 8500 and 8501;
- the Core startup log (`Go Core started at`).

In `finally`, send SIGTERM to the negative process-group ID, wait at most five seconds, send SIGKILL only if still alive, wait for the child, verify `process.kill(-pid, 0)` returns `ESRCH`, and remove only the validated temp root. The script fails with its bounded/redacted log tail on timeout or ordering failure and refuses to run if either UI port was occupied before launch.

On Windows, exit zero with an explicit structured skip message because POSIX detached process-group ownership cannot be verified there; dependency provisioning and Taskfile behavior remain covered by the platform/static verifier contracts.

Run: `pnpm exec tsx scripts/smoke-dev-all.ts`

Expected: readiness/order assertions PASS and the script exits with no owned child process.

- [ ] **Step 6: Inspect the final diff and commit only verification fixes**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: no unexpected generated files, no whitespace errors, and only planned paths changed. Add both verifier scripts to `tsconfig.ci.json`, then format and validate the newly created files before committing:

```bash
pnpm exec oxfmt scripts/verify-isolated-runtime-deps.ts scripts/smoke-dev-all.ts tsconfig.ci.json
pnpm lint
pnpm format:check
pnpm type:check:ci
```

Commit the durable verification tooling exactly:

```bash
git add scripts/verify-isolated-runtime-deps.ts scripts/smoke-dev-all.ts tsconfig.ci.json
git commit -m "test: complete Taskfile migration verification"
```

If an earlier implementation needs a verification fix, return to that task's spec/quality review loop and commit the enumerated affected paths there; do not use a catch-all `git add` in this task.
