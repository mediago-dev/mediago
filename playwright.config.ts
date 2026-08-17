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
