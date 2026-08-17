import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  expect,
  test as base,
  type BrowserContext,
  type TestInfo,
} from "@playwright/test";
import { attachBoundedProcessLogs } from "../support/artifacts.ts";
import {
  loadMediaFixture,
  type MediaFixture,
  verifyFixtureCopy,
} from "../support/media.ts";
import {
  assertNoBlockedRequests,
  guardBrowserContext,
  type BrowserNetworkGuard,
} from "../support/network.ts";
import { assertPortFree } from "../support/ports.ts";
import { redactDiagnostic, type ManagedProcess } from "../support/process.ts";
import {
  startServerProcess,
  type StartedServerProcess,
} from "../support/server-process.ts";
import {
  startUIProcess,
  type StartedUIProcess,
} from "../support/ui-process.ts";

const PASSWORD = "mediago-e2e-password";
const DIAGNOSTIC_LIMIT = 16 * 1024;
const WEB_FIXTURE_TIMEOUT_MS = 60_000;
const SLOW_SETUP_PROBE_DELAY_MS = 31_000;
const FORCE_SLOW_SETUP = process.env.MEDIAGO_E2E_FORCE_SLOW_SETUP === "1";
const FORCE_TIMEOUT = process.env.MEDIAGO_E2E_FORCE_TIMEOUT === "1";
const FORCE_NETWORK_VIOLATION =
  FORCE_TIMEOUT || process.env.MEDIAGO_E2E_FORCE_NETWORK_VIOLATION === "1";

interface WebRuntime {
  media: MediaFixture;
  runtimeRoot: string;
  ui: StartedUIProcess;
  installNetworkGuard(context: BrowserContext): Promise<BrowserNetworkGuard>;
}

interface RuntimeResources {
  media?: MediaFixture;
  runtimeRoot: string;
  server?: StartedServerProcess;
  ui?: StartedUIProcess;
}

function diagnosticMessage(error: unknown): string {
  return redactDiagnostic(
    error instanceof Error ? error.message : String(error),
  );
}

function boundedDiagnostics(errors: readonly string[]): string {
  const contents = Buffer.from(errors.join("\n"), "utf8");
  return contents
    .subarray(Math.max(0, contents.length - DIAGNOSTIC_LIMIT))
    .toString("utf8");
}

async function attachDiagnostic(
  testInfo: TestInfo,
  name: string,
  message: string,
): Promise<void> {
  await testInfo.attach(name, {
    body: boundedDiagnostics([message]),
    contentType: "text/plain; charset=utf-8",
  });
}

async function cleanupRuntime(resources: RuntimeResources): Promise<string[]> {
  const errors: string[] = [];
  try {
    await resources.server?.process.stop();
  } catch (error) {
    errors.push(`stop Server: ${diagnosticMessage(error)}`);
  }
  try {
    await resources.ui?.process.stop();
  } catch (error) {
    errors.push(`stop UI: ${diagnosticMessage(error)}`);
  }
  try {
    await resources.media?.close();
  } catch (error) {
    errors.push(`stop media: ${diagnosticMessage(error)}`);
  }
  try {
    await rm(resources.runtimeRoot, { recursive: true, force: true });
  } catch (error) {
    errors.push(`remove runtime directory: ${diagnosticMessage(error)}`);
  }
  return errors;
}

function managedProcesses(
  resources: RuntimeResources,
): Readonly<Record<string, ManagedProcess | undefined>> {
  return {
    server: resources.server?.process,
    ui: resources.ui?.process,
  };
}

function hasPrimaryTestError(testInfo: TestInfo): boolean {
  return (
    testInfo.errors.length > 0 ||
    testInfo.status === "failed" ||
    testInfo.status === "timedOut" ||
    testInfo.status === "interrupted"
  );
}

const test = base.extend<{ webRuntime: WebRuntime }>({
  webRuntime: [
    async ({ browserName: _browserName }, use, testInfo) => {
      // Avoid page/context dependencies so their teardown completes before ours.
      const resources: RuntimeResources = {
        runtimeRoot: await mkdtemp(path.join(tmpdir(), "mediago-e2e-web-")),
      };
      let guardedContext: BrowserContext | undefined;
      let networkGuard: BrowserNetworkGuard | undefined;
      let setupError: unknown;

      try {
        await assertPortFree("127.0.0.1", 8501, "MediaGo Web UI");
        await assertPortFree("127.0.0.1", 9900, "MediaGo Web Core");
        resources.media = await loadMediaFixture();
        resources.ui = await startUIProcess("server");
        if (FORCE_SLOW_SETUP) {
          await delay(SLOW_SETUP_PROBE_DELAY_MS);
          throw new Error("Controlled slow Web fixture setup failure");
        }
        resources.server = await startServerProcess(resources.runtimeRoot);
      } catch (error) {
        setupError = error;
      }

      if (
        setupError === undefined &&
        resources.media &&
        resources.ui &&
        resources.server
      ) {
        await use({
          media: resources.media,
          runtimeRoot: resources.runtimeRoot,
          ui: resources.ui,
          installNetworkGuard: async (context) => {
            if (networkGuard) {
              throw new Error(
                "Browser context network guard already installed",
              );
            }
            guardedContext = context;
            networkGuard = await guardBrowserContext(context);
            return networkGuard;
          },
        });
      }

      const secondaryErrors: Array<{ name: string; error: Error }> = [];
      if (guardedContext && guardedContext.pages().length > 0) {
        secondaryErrors.push({
          name: "web-page-ownership-error.log",
          error: new Error(
            "Playwright page fixture was still open during Web runtime teardown",
          ),
        });
      }
      if (networkGuard) {
        try {
          assertNoBlockedRequests(networkGuard);
        } catch (error) {
          secondaryErrors.push({
            name: "web-network-violation.log",
            error:
              error instanceof Error
                ? error
                : new Error(diagnosticMessage(error)),
          });
        }
      }

      const primaryExists =
        setupError !== undefined || hasPrimaryTestError(testInfo);
      const diagnosticErrors: string[] = [];
      await Promise.all(
        secondaryErrors.map(async (secondary) => {
          try {
            await attachDiagnostic(
              testInfo,
              secondary.name,
              diagnosticMessage(secondary.error),
            );
          } catch (error) {
            diagnosticErrors.push(
              `attach ${secondary.name}: ${diagnosticMessage(error)}`,
            );
          }
        }),
      );

      let processLogsAttached = false;
      const attachProcessLogs = async (): Promise<void> => {
        if (processLogsAttached) return;
        processLogsAttached = true;
        try {
          await attachBoundedProcessLogs(testInfo, managedProcesses(resources));
        } catch (error) {
          diagnosticErrors.push(
            `attach managed process logs: ${diagnosticMessage(error)}`,
          );
        }
      };

      if (primaryExists || secondaryErrors.length > 0) {
        await attachProcessLogs();
      }

      const cleanupErrors = await cleanupRuntime(resources);
      diagnosticErrors.push(...cleanupErrors);
      if (cleanupErrors.length > 0 && !processLogsAttached) {
        await attachProcessLogs();
      }
      if (diagnosticErrors.length > 0) {
        try {
          await attachDiagnostic(
            testInfo,
            "web-cleanup-errors.log",
            boundedDiagnostics(diagnosticErrors),
          );
        } catch (error) {
          diagnosticErrors.push(
            `attach cleanup diagnostics: ${diagnosticMessage(error)}`,
          );
        }
      }

      if (setupError !== undefined) throw setupError;
      if (primaryExists) return;
      if (secondaryErrors.length > 0) throw secondaryErrors[0].error;
      if (diagnosticErrors.length > 0) {
        throw new Error(boundedDiagnostics(diagnosticErrors));
      }
    },
    { auto: true, timeout: WEB_FIXTURE_TIMEOUT_MS },
  ],
});

test("downloads a direct MP4 after first-run authentication", async ({
  page,
  webRuntime,
}, testInfo) => {
  const networkGuard = await webRuntime.installNetworkGuard(page.context());
  await page.goto(webRuntime.ui.baseURL);

  if (FORCE_NETWORK_VIOLATION) {
    await page.evaluate(async () => {
      try {
        await fetch("https://guard-probe.invalid/network");
      } catch {
        // The network guard must reject this intentional teardown probe.
      }
    });
    await expect.poll(() => networkGuard.blockedRequestCount).toBe(1);
  }
  if (FORCE_TIMEOUT) {
    testInfo.setTimeout(1);
    await new Promise<never>(() => {});
  }

  await expect(page).toHaveURL(/\/signin$/);
  await page.getByLabel("Create an admin password").fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Set up" }).click();

  await expect(page).toHaveURL(/\/$/);
  await page.getByRole("button", { name: "New download" }).first().click();
  await page.getByRole("button", { name: "Download now" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Enter a video URL" }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Download type" }).click();
  await page.getByRole("option", { name: "Direct download (MP4)" }).click();
  await page.getByLabel("Video name").fill("web-e2e-sample");
  await page.getByLabel("Video link").fill(webRuntime.media.sampleURL);
  await page.getByRole("button", { name: "Download now" }).click();
  await page.getByRole("link", { name: "Download complete" }).click();
  await expect(page).toHaveURL(/\/done$/);

  const task = page.getByRole("article", { name: "web-e2e-sample" });
  await expect(task.getByText("Download complete")).toBeVisible({
    timeout: 30_000,
  });

  await verifyFixtureCopy(path.join(webRuntime.runtimeRoot, "downloads"));
});
