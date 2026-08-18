import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PlaywrightTestConfig } from "@playwright/test";
import { expect, test, vi } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};
const gitignore = fs.readFileSync(
  path.join(repositoryRoot, ".gitignore"),
  "utf8",
);
const expectedE2EScripts = {
  "test:e2e:setup:deps": "tsx scripts/download-deps.ts --tools aria2",
  "test:e2e:setup:browser": "playwright install chromium",
  "test:e2e:setup": "pnpm test:e2e:setup:deps && pnpm test:e2e:setup:browser",
  "test:e2e:build:core":
    "cd apps/core && go build -o bin/mediago-core ./cmd/server",
  "test:e2e:build": "pnpm test:e2e:build:core && pnpm test:e2e:build:raw",
  "test:e2e:build:raw":
    "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/server -F @mediago/electron -F @mediago/electron-preload -F @mediago/extension",
  "test:e2e": "task test:e2e",
  "test:e2e:raw": "playwright test",
  "test:e2e:web": "task test:e2e:web",
  "test:e2e:web:raw": "playwright test --project=web",
  "test:e2e:electron": "task test:e2e:electron",
  "test:e2e:electron:raw": "playwright test --project=electron",
  "test:e2e:extension": "task test:e2e:extension",
  "test:e2e:extension:raw": "playwright test --project=extension",
  "test:e2e:ui": "playwright test --ui",
  "type:check:e2e": "tsc -p tsconfig.e2e.json",
} as const;

test("pins the isolated Playwright E2E package and script contract", () => {
  assertPackageContract(packageJson, gitignore);
});

test("configures the non-CI Playwright contract", async () => {
  assertPlaywrightConfigContract(await loadPlaywrightConfig(), 240_000, false);
});

test("configures the CI Playwright contract", async () => {
  assertPlaywrightConfigContract(
    await loadPlaywrightConfig("1"),
    180_000,
    true,
  );
});

test("rejects regressions in the E2E toolchain contract", async () => {
  expect(() =>
    assertPackageContract(
      {
        ...packageJson,
        scripts: {
          ...packageJson.scripts,
          "test:e2e:setup:deps":
            "tsx scripts/download-deps.ts --tools aria2,N_m3u8DL-RE",
        },
      },
      gitignore,
    ),
  ).toThrow();

  const config = await loadPlaywrightConfig();
  expect(() =>
    assertPlaywrightConfigContract({ ...config, workers: 2 }, 240_000, false),
  ).toThrow();
  expect(() =>
    assertPlaywrightConfigContract(
      { ...config, webServer: { command: "echo unexpected" } },
      240_000,
      false,
    ),
  ).toThrow();
});

function assertPackageContract(
  manifest: typeof packageJson,
  gitignoreContents: string,
) {
  expect(manifest.devDependencies["@playwright/test"]).toBe("1.61.1");
  expect(manifest.devDependencies.playwright).toBe("1.61.1");
  for (const [name, command] of Object.entries(expectedE2EScripts)) {
    expect(manifest.scripts[name]).toBe(command);
  }
  expect(gitignoreContents).toContain("playwright-report/");
  expect(gitignoreContents).toContain("test-results/");
}

function assertPlaywrightConfigContract(
  config: PlaywrightTestConfig,
  globalTimeout: number,
  ci: boolean,
) {
  expect(config).toMatchObject({
    testDir: "tests/e2e",
    outputDir: "test-results",
    timeout: 60_000,
    globalTimeout,
    expect: { timeout: 10_000 },
    workers: 1,
    fullyParallel: false,
    retries: 0,
    forbidOnly: ci,
    use: {
      locale: "en-US",
      screenshot: "only-on-failure",
      trace: "retain-on-failure",
      video: "retain-on-failure",
    },
  });
  expect(config.reporter).toStrictEqual([
    ["line"],
    ["html", { open: "never", outputFolder: "playwright-report" }],
  ]);
  expect(config.projects).toStrictEqual([
    { name: "web", testMatch: /web\/.*\.spec\.ts/ },
    { name: "electron", testMatch: /electron\/.*\.spec\.ts/ },
    { name: "extension", testMatch: /extension\/.*\.spec\.ts/ },
  ]);
  expect(config).not.toHaveProperty("webServer");
}

async function loadPlaywrightConfig(ci?: string) {
  const originalCi = process.env.CI;

  try {
    if (ci === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = ci;
    }
    vi.resetModules();
    return (await import("../../playwright.config.ts")).default;
  } finally {
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
  }
}
