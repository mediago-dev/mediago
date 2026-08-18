import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  expect,
  test as base,
  type BrowserContext,
  type Page,
  type TestInfo,
  type Worker,
} from "@playwright/test";
import { chromium } from "playwright";
import {
  attachBoundedCoreLogs,
  attachBoundedProcessLogs,
  finalizeManualContextArtifacts,
  manualArtifactPaths,
  startManualContextArtifacts,
} from "../support/artifacts.ts";
import {
  startCoreProcess,
  type StartedCoreProcess,
} from "../support/core-process.ts";
import {
  createFakeBilibiliDependencyLeaf,
  type FakeBilibiliDependencyLeaf,
} from "../support/fake-dependencies.ts";
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
import { assertPortFree, waitForPortFree } from "../support/ports.ts";
import { redactDiagnostic } from "../support/process.ts";
import { startTestPage, type StartedTestPage } from "../support/test-page.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const EXTENSION_DIRECTORY = path.join(
  REPOSITORY_ROOT,
  "packages/mediago-extension/dist",
);
const CORE_PORT = 39_719;
const TASK_NAME = "MediaGo E2E Fixture";
const BILIBILI_TASK_NAME = "MediaGo Bilibili Fixture";
const BILIBILI_SOURCE_ID = "bilibili-controlled-source-fixture";
const BILIBILI_SOURCE_URL = "https://www.bilibili.com/video/BV1MediaGoFixture";
const BILIBILI_REFERER = "https://www.bilibili.com/";
const BILIBILI_COOKIE = "SESSDATA=mediago-e2e-fixture; bili_jct=fixture";
const BILIBILI_HEADERS = `Referer:${BILIBILI_REFERER}\nCookie:${BILIBILI_COOKIE}`;
const DOWNLOAD_DEADLINE_MS = 30_000;
const EXTENSION_FIXTURE_TIMEOUT_MS = 60_000;
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000;
const PROCESS_EXIT_TIMEOUT_MS = 5_000;
const TERMINATION_GRACE_MS = 2_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;
const FORCE_TEST_TIMEOUT = process.env.MEDIAGO_E2E_FORCE_TEST_TIMEOUT === "1";
const FORCE_CLOSE_FAILURE = process.env.MEDIAGO_E2E_FORCE_CLOSE_FAILURE === "1";
const FORCE_CLOSE_TIMEOUT = process.env.MEDIAGO_E2E_FORCE_CLOSE_TIMEOUT === "1";
const FORCE_LATE_NETWORK_VIOLATION =
  process.env.MEDIAGO_E2E_FORCE_LATE_NETWORK_VIOLATION === "1";

interface ProcessIdentity {
  pid: number;
  startTime: string;
}

interface ExtensionRuntime {
  bbdownArgumentsPath: string;
  context: BrowserContext;
  coreRequestURLs: string[];
  core: StartedCoreProcess;
  extensionURL(relativePath: string): string;
  media: MediaFixture;
  optionsPage: Page;
  testPage: StartedTestPage;
  trackPage(page: Page): void;
  worker: Worker;
}

interface ExtensionResources {
  browserIdentity?: ProcessIdentity;
  context?: BrowserContext;
  core?: StartedCoreProcess;
  fakeBilibiliDependencies?: FakeBilibiliDependencyLeaf;
  media?: MediaFixture;
  page?: Page;
  testPage?: StartedTestPage;
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

function hasPrimaryTestError(testInfo: TestInfo): boolean {
  return (
    testInfo.errors.length > 0 ||
    testInfo.status === "failed" ||
    testInfo.status === "timedOut" ||
    testInfo.status === "interrupted"
  );
}

async function withDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function readProcessIdentity(
  pid: number,
): Promise<ProcessIdentity | undefined> {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8");
    const commandEnd = stat.lastIndexOf(")");
    if (commandEnd < 0 || Number(stat.slice(0, stat.indexOf(" "))) !== pid) {
      throw new Error(`Malformed /proc stat for PID ${pid}`);
    }
    const fields = stat
      .slice(commandEnd + 2)
      .trim()
      .split(/\s+/);
    const startTime = fields[19];
    if (!startTime)
      throw new Error(`Missing process start time for PID ${pid}`);
    return { pid, startTime };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return undefined;
    throw error;
  }
}

async function identityIsAlive(identity: ProcessIdentity): Promise<boolean> {
  const current = await readProcessIdentity(identity.pid);
  return current?.startTime === identity.startTime;
}

async function readProcessArguments(pid: number): Promise<string[]> {
  try {
    return (await readFile(`/proc/${pid}/cmdline`, "utf8"))
      .split("\0")
      .filter(Boolean);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH") return [];
    throw error;
  }
}

async function findOwnedChromiumIdentity(
  userDataDirectory: string,
): Promise<ProcessIdentity> {
  const expectedArgument = `--user-data-dir=${path.resolve(userDataDirectory)}`;
  const deadline = Date.now() + 3_000;
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Each ownership poll needs a fresh /proc snapshot.
    const entries = await readdir("/proc", { withFileTypes: true });
    // oxlint-disable-next-line no-await-in-loop -- Candidate reads are parallelized within one polling iteration.
    const candidateIdentities = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map(async (entry) => {
          const pid = Number(entry.name);
          const args = await readProcessArguments(pid);
          const commandLine = args.join("\0");
          if (
            !commandLine.includes(expectedArgument) ||
            args.some((argument) => /(?:^|\s)--type=/.test(argument))
          ) {
            return undefined;
          }
          return readProcessIdentity(pid);
        }),
    );
    const candidates = candidateIdentities.filter(
      (identity): identity is ProcessIdentity => identity !== undefined,
    );
    if (candidates.length === 1) return candidates[0];
    if (candidates.length > 1) {
      throw new Error(
        `Multiple Chromium processes own ${userDataDirectory}: ${candidates
          .map((identity) => identity.pid)
          .join(", ")}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Could not identify the Chromium process for ${userDataDirectory}`,
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- Polling backoff separates process-table snapshots.
    await delay(50);
  }
}

async function collectOwnedProcessTree(
  root: ProcessIdentity,
): Promise<ProcessIdentity[]> {
  const collected: ProcessIdentity[] = [];
  const visited = new Set<number>();

  const visit = async (identity: ProcessIdentity): Promise<void> => {
    if (visited.has(identity.pid) || !(await identityIsAlive(identity))) return;
    visited.add(identity.pid);
    let children = "";
    try {
      children = await readFile(
        `/proc/${identity.pid}/task/${identity.pid}/children`,
        "utf8",
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ESRCH") throw error;
    }
    await Promise.all(
      children
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .map(async (value) => {
          const child = await readProcessIdentity(Number(value));
          if (child) await visit(child);
        }),
    );
    if (await identityIsAlive(identity)) collected.push(identity);
  };

  await visit(root);
  return collected;
}

async function waitForIdentitiesExit(
  identities: readonly ProcessIdentity[],
  timeoutMs: number,
): Promise<ProcessIdentity[]> {
  const deadline = Date.now() + timeoutMs;
  let candidates = [...identities];
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Liveness reads are parallelized within one polling iteration.
    const liveness = await Promise.all(
      candidates.map(async (identity) => ({
        identity,
        alive: await identityIsAlive(identity),
      })),
    );
    const alive = liveness.flatMap((result) =>
      result.alive ? [result.identity] : [],
    );
    if (alive.length === 0 || Date.now() >= deadline) return alive;
    candidates = alive;
    // oxlint-disable-next-line no-await-in-loop -- Backoff separates survivor-set liveness checks.
    await delay(50);
  }
}

async function signalIdentities(
  identities: readonly ProcessIdentity[],
  signal: NodeJS.Signals,
): Promise<void> {
  await Promise.all(
    identities.map(async (identity) => {
      if (!(await identityIsAlive(identity))) return;
      if (identity.pid <= 1 || identity.pid === process.pid) {
        throw new Error(`Refusing to signal unsafe PID ${identity.pid}`);
      }
      try {
        process.kill(identity.pid, signal);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }),
  );
}

async function terminateOwnedProcessTree(
  root: ProcessIdentity,
  knownProcesses: readonly ProcessIdentity[] = [],
): Promise<void> {
  const currentTree = await collectOwnedProcessTree(root);
  const identitiesByPid = new Map(
    [...knownProcesses, ...currentTree].map((identity) => [
      identity.pid,
      identity,
    ]),
  );
  const tree = [...identitiesByPid.values()];
  if (tree.length === 0) return;
  await signalIdentities(tree, "SIGTERM");
  const survivors = await waitForIdentitiesExit(tree, TERMINATION_GRACE_MS);
  if (survivors.length === 0) return;
  await signalIdentities(survivors, "SIGKILL");
  const stubborn = await waitForIdentitiesExit(survivors, TERMINATION_GRACE_MS);
  if (stubborn.length > 0) {
    throw new Error(
      `Owned Chromium process(es) did not exit: ${stubborn
        .map((identity) => identity.pid)
        .join(", ")}`,
    );
  }
}

async function waitForProcessExit(
  identity: ProcessIdentity,
  timeoutMs: number,
): Promise<void> {
  const survivors = await waitForIdentitiesExit([identity], timeoutMs);
  if (survivors.length > 0) {
    throw new Error(`Chromium PID ${identity.pid} did not exit`);
  }
}

async function waitForWorker(context: BrowserContext): Promise<Worker> {
  return context.serviceWorkers()[0] ?? context.waitForEvent("serviceworker");
}

async function badgeTextForActiveTab(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & {
        chrome: {
          action: {
            getBadgeText(options: { tabId: number }): Promise<string>;
          };
          tabs: {
            query(options: {
              active: boolean;
              currentWindow: boolean;
            }): Promise<Array<{ id?: number }>>;
          };
        };
      }
    ).chrome;
    const [tab] = await extensionChrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) return "";
    return extensionChrome.action.getBadgeText({ tabId: tab.id });
  });
}

async function waitForSuccessfulDownload(
  core: StartedCoreProcess,
  taskName = TASK_NAME,
): Promise<void> {
  const deadline = Date.now() + DOWNLOAD_DEADLINE_MS;
  while (true) {
    // oxlint-disable-next-line no-await-in-loop -- Each task poll must finish before status is evaluated.
    const response = await core.client.getDownloadTasks({
      current: 1,
      pageSize: 20,
    });
    const task = response.data.list.find(
      (candidate) => candidate.name === taskName,
    );
    if (task?.status === "success") return;
    if (task?.status === "failed" || task?.status === "stopped") {
      throw new Error(
        `Extension download entered terminal status ${task.status}`,
      );
    }

    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `Extension download did not succeed within ${DOWNLOAD_DEADLINE_MS}ms`,
      );
    }
    // oxlint-disable-next-line no-await-in-loop -- Backoff respects the shared download deadline.
    await delay(Math.min(100, remaining));
  }
}

async function enableImmediateDownload(
  runtime: ExtensionRuntime,
): Promise<void> {
  const downloadNow = runtime.optionsPage.getByRole("switch", {
    name: "Start downloading immediately",
  });
  if ((await downloadNow.getAttribute("aria-checked")) !== "true") {
    await downloadNow.click();
    await expect(
      runtime.optionsPage.getByText("Saved", { exact: true }),
    ).toBeVisible();
  }
  await expect(downloadNow).toHaveAttribute("aria-checked", "true");
}

async function injectControlledBilibiliSource(worker: Worker): Promise<void> {
  await worker.evaluate(
    async ({ sourceId, sourceURL, sourceName, headers }) => {
      const extensionChrome = (
        globalThis as typeof globalThis & {
          chrome: {
            action: {
              setBadgeBackgroundColor(options: {
                tabId: number;
                color: string;
              }): Promise<void>;
              setBadgeText(options: {
                tabId: number;
                text: string;
              }): Promise<void>;
            };
            storage: {
              session: {
                set(items: Record<string, unknown>): Promise<void>;
              };
            };
            tabs: {
              query(options: {
                active: boolean;
                currentWindow: boolean;
              }): Promise<Array<{ id?: number; url?: string }>>;
            };
          };
        }
      ).chrome;
      const [tab] = await extensionChrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined || !tab.url?.startsWith("http://127.0.0.1:")) {
        throw new Error(
          "Controlled Bilibili source requires a local active tab",
        );
      }
      await extensionChrome.storage.session.set({
        [`mediago.tab.${tab.id}`]: [
          {
            id: sourceId,
            url: sourceURL,
            documentURL: tab.url,
            name: sourceName,
            type: "bilibili",
            headers,
            detectedAt: 1_700_000_000_000,
          },
        ],
      });
      await extensionChrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: "#ef4444",
      });
      await extensionChrome.action.setBadgeText({ tabId: tab.id, text: "1" });
    },
    {
      sourceId: BILIBILI_SOURCE_ID,
      sourceURL: BILIBILI_SOURCE_URL,
      sourceName: BILIBILI_TASK_NAME,
      headers: BILIBILI_HEADERS,
    },
  );
}

async function importControlledBilibiliSource(page: Page): Promise<unknown> {
  return page.evaluate(
    async (source) => {
      const extensionChrome = (
        globalThis as typeof globalThis & {
          chrome: {
            runtime: {
              sendMessage(message: unknown): Promise<unknown>;
            };
          };
        }
      ).chrome;
      return extensionChrome.runtime.sendMessage({
        type: "IMPORT_SOURCES",
        sources: [source],
      });
    },
    {
      id: BILIBILI_SOURCE_ID,
      url: BILIBILI_SOURCE_URL,
      documentURL: "http://127.0.0.1/controlled-fixture",
      name: BILIBILI_TASK_NAME,
      type: "bilibili",
      headers: BILIBILI_HEADERS,
      detectedAt: 1_700_000_000_000,
    },
  );
}

async function openControlledBilibiliPopup(
  runtime: ExtensionRuntime,
): Promise<{ popupPage: Page; sourceRow: ReturnType<Page["getByRole"]> }> {
  const popupPage = await runtime.context.newPage();
  await popupPage.goto(runtime.extensionURL("src/popup/index.html"));

  const fixturePage = await runtime.context.newPage();
  runtime.trackPage(fixturePage);
  await fixturePage.goto(runtime.testPage.url);
  await fixturePage.bringToFront();
  await injectControlledBilibiliSource(runtime.worker);
  await expect
    .poll(() => badgeTextForActiveTab(runtime.worker), {
      timeout: 10_000,
      intervals: [100],
    })
    .toBe("1");

  await popupPage.reload();
  runtime.trackPage(popupPage);
  const sourceRow = popupPage
    .getByRole("listitem")
    .filter({ hasText: BILIBILI_TASK_NAME });
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow.getByText("bilibili", { exact: true })).toBeVisible();
  return { popupPage, sourceRow };
}

async function readBBDownArguments(filePath: string): Promise<string[][]> {
  try {
    return (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function expectNoInvalidDownloadIDRequests(urls: readonly string[]): void {
  for (const value of urls) {
    expect(value).not.toContain("NaN");
    expect(value).not.toContain("undefined");
    expect(value).not.toContain(BILIBILI_SOURCE_URL);
    expect(value).not.toContain(encodeURIComponent(BILIBILI_SOURCE_URL));
    expect(new URL(value).pathname).not.toContain(BILIBILI_SOURCE_ID);
  }
}

const test = base.extend<{ extensionRuntime: ExtensionRuntime }>({
  extensionRuntime: [
    async ({ browserName: _browserName }, use, testInfo) => {
      // This automatic fixture has no page/context dependency, so its teardown
      // keeps a separate timeout budget after the test body has timed out.
      const runtimeRoot = await mkdtemp(
        path.join(tmpdir(), "mediago-e2e-extension-"),
      );
      const userDataDirectory = path.join(runtimeRoot, "chromium-profile");
      const resources: ExtensionResources = {};
      const coreRequestURLs: string[] = [];
      let setupError: unknown;
      let tracingStarted = false;
      let contextClosed = false;
      let networkGuard: BrowserNetworkGuard | undefined;
      let networkViolation: Error | undefined;
      let gracefulCloseError: unknown;
      let ownedProcessesBeforeClose: ProcessIdentity[] = [];

      try {
        resources.media = await loadMediaFixture();
        resources.fakeBilibiliDependencies =
          await createFakeBilibiliDependencyLeaf(runtimeRoot);
        await assertPortFree("127.0.0.1", CORE_PORT, "MediaGo extension Core");

        const artifactPaths = manualArtifactPaths(testInfo);
        resources.context = await chromium.launchPersistentContext(
          userDataDirectory,
          {
            headless: false,
            args: [
              `--disable-extensions-except=${EXTENSION_DIRECTORY}`,
              `--load-extension=${EXTENSION_DIRECTORY}`,
            ],
            locale: "en-US",
            artifactsDir: artifactPaths.artifactsDir,
            recordVideo: { dir: artifactPaths.videoDir },
          },
        );
        resources.browserIdentity =
          await findOwnedChromiumIdentity(userDataDirectory);
        networkGuard = await guardBrowserContext(resources.context);
        resources.context.on("request", (request) => {
          if (request.url().startsWith(`http://127.0.0.1:${CORE_PORT}/`)) {
            coreRequestURLs.push(request.url());
          }
        });
        await startManualContextArtifacts(resources.context);
        tracingStarted = true;

        const worker = await waitForWorker(resources.context);
        const extensionId = new URL(worker.url()).hostname;
        expect(extensionId).not.toBe("");
        const extensionURL = (relativePath: string): string =>
          `chrome-extension://${extensionId}/${relativePath}`;

        const optionsPage =
          resources.context.pages()[0] ?? (await resources.context.newPage());
        resources.page = optionsPage;
        await optionsPage.goto(extensionURL("src/options/index.html"));

        const desktopRadio = optionsPage.getByRole("radio", {
          name: /^Desktop · HTTP local/,
        });
        const schemaRadio = optionsPage.getByRole("radio", {
          name: /^Desktop · Schema protocol/,
        });
        await expect(desktopRadio).toBeChecked();
        await schemaRadio.check();
        await desktopRadio.check();
        await optionsPage.getByRole("button", { name: "Save" }).click();
        await expect(
          optionsPage.getByText("Saved", { exact: true }),
        ).toBeVisible();
        await optionsPage.reload();
        await expect(desktopRadio).toBeChecked();

        await optionsPage
          .getByRole("button", { name: "Test connection" })
          .click();
        const status = optionsPage.getByRole("status");
        await expect(status).toBeVisible();
        await expect(status).not.toContainText(/connected/i);

        resources.core = await startCoreProcess({
          runtimeRoot,
          port: CORE_PORT,
          depsDirectory: resources.fakeBilibiliDependencies.depsDirectory,
        });
        await optionsPage
          .getByRole("button", { name: "Test connection" })
          .click();
        await expect(status).toHaveText("connected");

        resources.testPage = await startTestPage(resources.media.sampleURL);
        await use({
          bbdownArgumentsPath:
            resources.fakeBilibiliDependencies.bbdownArgumentsPath,
          context: resources.context,
          core: resources.core,
          coreRequestURLs,
          extensionURL,
          media: resources.media,
          optionsPage,
          testPage: resources.testPage,
          trackPage: (page) => {
            resources.page = page;
          },
          worker,
        });
      } catch (error) {
        setupError = error;
      }

      const primaryExists =
        setupError !== undefined || hasPrimaryTestError(testInfo);
      const cleanupErrors: string[] = [];
      const context = resources.context;
      const auditNetwork = async (): Promise<void> => {
        if (!networkGuard) return;
        try {
          assertNoBlockedRequests(networkGuard);
        } catch (error) {
          networkViolation ??=
            error instanceof Error
              ? error
              : new Error(diagnosticMessage(error));
        }
      };

      // This preliminary audit decides whether failure-only artifacts should be
      // retained. The close callback and post-finalizer audit cover later I/O.
      await auditNetwork();

      const auditAndClose = async (): Promise<void> => {
        if (!context) return;
        if (resources.browserIdentity) {
          try {
            ownedProcessesBeforeClose = await collectOwnedProcessTree(
              resources.browserIdentity,
            );
          } catch (error) {
            cleanupErrors.push(
              `snapshot owned Chromium tree: ${diagnosticMessage(error)}`,
            );
          }
        }
        if (FORCE_LATE_NETWORK_VIOLATION && resources.page) {
          try {
            await resources.page.evaluate(async () => {
              try {
                await fetch("https://guard-probe.invalid/extension-close");
              } catch {
                // The guaranteed final teardown audit reports this violation.
              }
            });
          } catch (error) {
            cleanupErrors.push(
              `trigger late network probe: ${diagnosticMessage(error)}`,
            );
          }
        }
        await auditNetwork();
        try {
          if (FORCE_CLOSE_FAILURE) {
            throw new Error("Controlled extension context close failure");
          }
          if (FORCE_CLOSE_TIMEOUT) {
            await withDeadline(
              new Promise<never>(() => {}),
              GRACEFUL_CLOSE_TIMEOUT_MS,
              "Controlled extension context close",
            );
          }
          await withDeadline(
            context.close(),
            GRACEFUL_CLOSE_TIMEOUT_MS,
            "Extension context close",
          );
          contextClosed = true;
        } catch (error) {
          gracefulCloseError = error;
          if (resources.browserIdentity) {
            try {
              await terminateOwnedProcessTree(
                resources.browserIdentity,
                ownedProcessesBeforeClose,
              );
              await waitForProcessExit(
                resources.browserIdentity,
                PROCESS_EXIT_TIMEOUT_MS,
              );
            } catch (terminationError) {
              cleanupErrors.push(
                `terminate Chromium after close failure: ${diagnosticMessage(
                  terminationError,
                )}`,
              );
            }
          }
          throw error;
        } finally {
          // Browser routes can still fire while trace/video/context shutdown is
          // in progress. This audit is guaranteed even if close or termination fails.
          await auditNetwork();
        }
      };

      if (context) {
        if (tracingStarted) {
          try {
            await finalizeManualContextArtifacts({
              testInfo,
              context,
              page: resources.page,
              close: auditAndClose,
              failed:
                primaryExists ||
                networkViolation !== undefined ||
                FORCE_CLOSE_FAILURE ||
                FORCE_CLOSE_TIMEOUT ||
                FORCE_LATE_NETWORK_VIOLATION,
              name: "extension",
              processes: { core: resources.core?.process },
              coreLogDirectory: resources.core
                ? path.join(runtimeRoot, "logs")
                : undefined,
            });
          } catch (error) {
            cleanupErrors.push(
              `finalize extension context: ${diagnosticMessage(error)}`,
            );
          }
        } else {
          try {
            await auditAndClose();
          } catch (error) {
            cleanupErrors.push(
              `close extension context: ${diagnosticMessage(error)}`,
            );
          }
        }
      }

      // Video finalization happens after the close callback; this audit makes
      // the complete trace/video/context interval observable to the guard.
      await auditNetwork();

      if (gracefulCloseError !== undefined) {
        cleanupErrors.push(
          `graceful extension close: ${diagnosticMessage(gracefulCloseError)}`,
        );
      }

      if (resources.browserIdentity) {
        const ownedBrowserProcesses = [
          ...new Map(
            [resources.browserIdentity, ...ownedProcessesBeforeClose].map(
              (identity) => [identity.pid, identity],
            ),
          ).values(),
        ];
        try {
          if (!contextClosed) {
            await terminateOwnedProcessTree(
              resources.browserIdentity,
              ownedProcessesBeforeClose,
            );
          }
          let survivors = await waitForIdentitiesExit(
            ownedBrowserProcesses,
            PROCESS_EXIT_TIMEOUT_MS,
          );
          if (survivors.length > 0) {
            await terminateOwnedProcessTree(
              resources.browserIdentity,
              ownedProcessesBeforeClose,
            );
            survivors = await waitForIdentitiesExit(
              survivors,
              PROCESS_EXIT_TIMEOUT_MS,
            );
          }
          if (survivors.length > 0) {
            throw new Error(
              `Owned Chromium process(es) did not exit: ${survivors
                .map((identity) => identity.pid)
                .join(", ")}`,
            );
          }
        } catch (error) {
          cleanupErrors.push(
            `terminate owned Chromium tree: ${diagnosticMessage(error)}`,
          );
        }
      }

      try {
        await resources.core?.process.stop();
      } catch (error) {
        cleanupErrors.push(`stop Core: ${diagnosticMessage(error)}`);
      }
      try {
        await resources.testPage?.close();
      } catch (error) {
        cleanupErrors.push(`stop fixture page: ${diagnosticMessage(error)}`);
      }
      try {
        await resources.media?.close();
      } catch (error) {
        cleanupErrors.push(`stop media: ${diagnosticMessage(error)}`);
      }
      try {
        await waitForPortFree("127.0.0.1", CORE_PORT, 10_000);
      } catch (error) {
        cleanupErrors.push(`wait for Core port: ${diagnosticMessage(error)}`);
      }

      if (networkViolation) {
        try {
          await attachDiagnostic(
            testInfo,
            "extension-network-violation.log",
            diagnosticMessage(networkViolation),
          );
        } catch (error) {
          cleanupErrors.push(
            `attach browser network violation: ${diagnosticMessage(error)}`,
          );
        }
      }
      if (
        (primaryExists || networkViolation) &&
        (!resources.context || !tracingStarted)
      ) {
        try {
          await attachBoundedProcessLogs(testInfo, {
            core: resources.core?.process,
          });
          if (resources.core) {
            await attachBoundedCoreLogs(
              testInfo,
              path.join(runtimeRoot, "logs"),
            );
          }
        } catch (error) {
          cleanupErrors.push(
            `attach failure logs: ${diagnosticMessage(error)}`,
          );
        }
      }

      try {
        await rm(runtimeRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(
          `remove runtime directory: ${diagnosticMessage(error)}`,
        );
      }
      if (cleanupErrors.length > 0) {
        try {
          await attachDiagnostic(
            testInfo,
            "extension-cleanup-errors.log",
            boundedDiagnostics(cleanupErrors),
          );
        } catch {
          // Preserve the primary test, network, or cleanup error.
        }
      }

      if (setupError !== undefined) throw setupError;
      if (primaryExists) return;
      if (networkViolation) throw networkViolation;
      if (cleanupErrors.length > 0) {
        throw new Error(boundedDiagnostics(cleanupErrors));
      }
    },
    { auto: true, timeout: EXTENSION_FIXTURE_TIMEOUT_MS },
  ],
});

test.use({ screenshot: "off", trace: "off", video: "off" });

test("captures a direct MP4 and downloads it through the MV3 popup", async ({
  extensionRuntime,
}, testInfo) => {
  if (FORCE_TEST_TIMEOUT) {
    testInfo.setTimeout(1);
    await new Promise<never>(() => {});
  }

  const downloadNow = extensionRuntime.optionsPage.getByRole("switch", {
    name: "Start downloading immediately",
  });
  await expect(downloadNow).toHaveAttribute("aria-checked", "false");
  await downloadNow.click();
  await expect(
    extensionRuntime.optionsPage.getByText("Saved", { exact: true }),
  ).toBeVisible();
  await expect(downloadNow).toHaveAttribute("aria-checked", "true");

  await extensionRuntime.optionsPage.reload();
  await expect(
    extensionRuntime.optionsPage.getByRole("radio", {
      name: /^Desktop · HTTP local/,
    }),
  ).toBeChecked();
  await expect(
    extensionRuntime.optionsPage.getByRole("switch", {
      name: "Start downloading immediately",
    }),
  ).toHaveAttribute("aria-checked", "true");

  const popupPage = await extensionRuntime.context.newPage();
  await popupPage.goto(extensionRuntime.extensionURL("src/popup/index.html"));
  await expect(popupPage).toHaveTitle("MediaGo");

  const fixturePage = await extensionRuntime.context.newPage();
  extensionRuntime.trackPage(fixturePage);
  await fixturePage.goto(extensionRuntime.testPage.url);
  await fixturePage.waitForFunction(
    () =>
      (window as Window & { fixtureMediaLoaded?: boolean | string })
        .fixtureMediaLoaded === true,
  );
  await fixturePage.bringToFront();

  await expect
    .poll(() => badgeTextForActiveTab(extensionRuntime.worker), {
      timeout: 10_000,
      intervals: [100],
    })
    .toBe("1");

  await popupPage.reload();
  extensionRuntime.trackPage(popupPage);
  await expect(
    popupPage.getByText(TASK_NAME, { exact: true }).first(),
  ).toBeVisible();
  await expect(popupPage.getByText("direct", { exact: true })).toBeVisible();

  const sourceRow = popupPage
    .getByRole("listitem")
    .filter({ hasText: TASK_NAME });
  await sourceRow.getByRole("button", { name: "Import" }).click();
  await expect(
    popupPage.getByText("Imported 1 task(s)", { exact: true }),
  ).toBeVisible();

  await waitForSuccessfulDownload(extensionRuntime.core);
  await verifyFixtureCopy(extensionRuntime.core.downloadDirectory);
});

test("imports a controlled Bilibili capture with the real Core response and fake BBDown", async ({
  extensionRuntime,
}) => {
  await enableImmediateDownload(extensionRuntime);

  let postedBody: unknown;
  let realResponseBody: unknown;
  await extensionRuntime.context.route(
    `${extensionRuntime.core.baseURL}/api/downloads`,
    async (route) => {
      postedBody = route.request().postDataJSON();
      const response = await route.fetch();
      realResponseBody = await response.json();
      await route.fulfill({ response });
    },
  );

  const { popupPage, sourceRow } =
    await openControlledBilibiliPopup(extensionRuntime);
  await sourceRow.getByRole("button", { name: "Import" }).click();
  await expect(
    popupPage.getByText("Imported 1 task(s)", { exact: true }),
  ).toBeVisible();

  expect(postedBody).toMatchObject({
    tasks: [
      {
        type: "bilibili",
        url: BILIBILI_SOURCE_URL,
        headers: BILIBILI_HEADERS,
      },
    ],
    startDownload: true,
  });
  expect(realResponseBody).toMatchObject({
    success: true,
    data: [{ id: expect.any(Number) }],
  });
  const responseData = (realResponseBody as { data: Array<{ id: number }> })
    .data;
  expect(responseData).toHaveLength(1);
  const responseID = responseData[0]?.id;
  expect(Number.isSafeInteger(responseID)).toBe(true);
  expect(responseID).toBeGreaterThan(0);

  await waitForSuccessfulDownload(extensionRuntime.core, BILIBILI_TASK_NAME);
  await expect
    .poll(() => readBBDownArguments(extensionRuntime.bbdownArgumentsPath), {
      timeout: DOWNLOAD_DEADLINE_MS,
      intervals: [50, 100, 250],
    })
    .toHaveLength(1);
  const [arguments_] = await readBBDownArguments(
    extensionRuntime.bbdownArgumentsPath,
  );
  expect(arguments_).toContain(BILIBILI_SOURCE_URL);
  const cookieIndex = arguments_.indexOf("--cookie");
  expect(cookieIndex).toBeGreaterThanOrEqual(0);
  expect(arguments_[cookieIndex + 1]).toBe(BILIBILI_COOKIE);
  expect(arguments_).not.toContain(BILIBILI_REFERER);
  expectNoInvalidDownloadIDRequests(extensionRuntime.coreRequestURLs);
});

test("rejects malformed successful imports without sending them to Core", async ({
  extensionRuntime,
}) => {
  await enableImmediateDownload(extensionRuntime);
  const malformedResponses = [
    {
      label: "missing ID",
      body: JSON.stringify({ success: true, data: [{}] }),
      error: /Invalid Download ID/,
    },
    {
      label: "string ID",
      body: JSON.stringify({ success: true, data: [{ id: "1" }] }),
      error: /Invalid Download ID/,
    },
    {
      label: "wrong count",
      body: JSON.stringify({ success: true, data: [] }),
      error: /Invalid download import response count/,
    },
    {
      label: "non-JSON",
      body: "not JSON",
      error: /JSON|Unexpected token|parse/i,
    },
  ] as const;
  let currentResponseBody = "";
  let interceptedRequests = 0;
  await extensionRuntime.context.route(
    `${extensionRuntime.core.baseURL}/api/downloads`,
    async (route) => {
      interceptedRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: currentResponseBody,
      });
    },
  );

  const { popupPage, sourceRow } =
    await openControlledBilibiliPopup(extensionRuntime);
  for (const fixture of malformedResponses) {
    currentResponseBody = fixture.body;
    const requestsBefore = interceptedRequests;
    // oxlint-disable-next-line no-await-in-loop -- Each click consumes one ordered response fixture.
    await sourceRow.getByRole("button", { name: "Import" }).click();
    // oxlint-disable-next-line no-await-in-loop -- The toast is the observable popup failure state.
    await expect(
      popupPage.getByText(fixture.error).last(),
      fixture.label,
    ).toBeVisible();
    // oxlint-disable-next-line no-await-in-loop -- Success must remain absent after each ordered response fixture.
    await expect(
      popupPage.getByText("Imported 1 task(s)", { exact: true }),
    ).toHaveCount(0);
    // The direct message exposes the same response object consumed by the
    // popup, so count=0 is asserted without weakening the visible UI check.
    // oxlint-disable-next-line no-await-in-loop -- Each response must be validated before advancing the fixture.
    const result = await importControlledBilibiliSource(popupPage);
    expect(result, fixture.label).toMatchObject({
      type: "IMPORT_RESULT",
      ok: false,
      count: 0,
    });
    // oxlint-disable-next-line no-await-in-loop -- Observe both requests before replacing the shared response body.
    await expect
      .poll(() => interceptedRequests, { intervals: [25, 50, 100] })
      .toBe(requestsBefore + 2);
  }

  expect(interceptedRequests).toBe(malformedResponses.length * 2);
  expect(
    await readBBDownArguments(extensionRuntime.bbdownArgumentsPath),
  ).toEqual([]);
  const tasks = await extensionRuntime.core.client.getDownloadTasks({
    current: 1,
    pageSize: 20,
  });
  expect(
    tasks.data.list.filter((task) => task.name === BILIBILI_TASK_NAME),
  ).toEqual([]);
  expectNoInvalidDownloadIDRequests(extensionRuntime.coreRequestURLs);
});
