import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import {
  _electron,
  expect,
  test as base,
  type BrowserContext,
  type ElectronApplication,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { MediaGoClient } from "../../../packages/core-sdk/src/index.ts";
import {
  attachBoundedProcessLogs,
  finalizeManualContextArtifacts,
  manualArtifactPaths,
  startManualContextArtifacts,
} from "../support/artifacts.ts";
import {
  installElectronNetworkGuard,
  scrubElectronEnvironment,
  type ElectronNetworkGuard,
} from "../support/electron-network.ts";
import {
  loadMediaFixture,
  type MediaFixture,
  verifyFixtureCopy,
} from "../support/media.ts";
import { assertPortFree, waitForPortFree } from "../support/ports.ts";
import { redactDiagnostic } from "../support/process.ts";
import {
  startUIProcess,
  type StartedUIProcess,
} from "../support/ui-process.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ELECTRON_MAIN_PATH = path.join(
  REPOSITORY_ROOT,
  "apps/electron/build/index.js",
);
const ELECTRON_PACKAGE_PATH = path.join(
  REPOSITORY_ROOT,
  "apps/electron/package.json",
);
const DEPS_DIRECTORY = path.join(REPOSITORY_ROOT, ".deps/linux-x64");
const PORTABLE_EXECUTABLE_FILE = path.join(
  tmpdir(),
  "mediago-e2e-portable.AppImage",
);
const LOCAL_NO_PROXY =
  "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";
const ELECTRON_CORE_PORT = 39_719;
const ELECTRON_FIXTURE_TIMEOUT_MS = 60_000;
const PROCESS_EXIT_TIMEOUT_MS = 10_000;
const GRACEFUL_CLOSE_TIMEOUT_MS = 3_000;
const TERMINATION_GRACE_MS = 3_000;
const DIAGNOSTIC_LIMIT = 16 * 1024;
const FORCE_CLOSE_FAILURE = process.env.MEDIAGO_E2E_FORCE_CLOSE_FAILURE === "1";
const FORCE_CLOSE_TIMEOUT = process.env.MEDIAGO_E2E_FORCE_CLOSE_TIMEOUT === "1";
const FORCE_TEST_TIMEOUT = process.env.MEDIAGO_E2E_FORCE_TIMEOUT === "1";
const FORCE_NETWORK_VIOLATION =
  process.env.MEDIAGO_E2E_FORCE_NETWORK_VIOLATION === "1";

interface EnvPathResult {
  coreUrl: string;
  workspace: string;
}

interface ProcessIdentity {
  pid: number;
  startTime: string;
}

interface ElectronRuntime {
  downloadDirectory: string;
  media: MediaFixture;
  page: Page;
}

interface ElectronResources {
  application?: ElectronApplication;
  context?: BrowserContext;
  electronIdentity?: ProcessIdentity;
  media?: MediaFixture;
  page?: Page;
  ui?: StartedUIProcess;
}

function electronExecutablePath(): string {
  const electronRequire = createRequire(ELECTRON_PACKAGE_PATH);
  const executablePath: unknown = electronRequire("electron");
  if (typeof executablePath !== "string" || executablePath.length === 0) {
    throw new Error("Electron package did not resolve to an executable path");
  }
  return executablePath;
}

function electronEnvironment(runtimeRoot: string): Record<string, string> {
  return {
    ...scrubElectronEnvironment(process.env),
    XDG_CONFIG_HOME: path.join(runtimeRoot, "xdg-config"),
    MEDIAGO_DEPS_DIR: DEPS_DIRECTORY,
    PORTABLE_EXECUTABLE_FILE,
    NO_PROXY: LOCAL_NO_PROXY,
    no_proxy: LOCAL_NO_PROXY,
  };
}

function normalizeEnvPath(value: unknown): EnvPathResult {
  let payload = value;
  if (typeof value === "object" && value !== null && "code" in value) {
    const envelope = value as {
      code?: unknown;
      data?: unknown;
      message?: unknown;
    };
    if (envelope.code !== 0) {
      throw new Error(
        `Electron getEnvPath IPC failed: ${String(envelope.message ?? "unknown")}`,
      );
    }
    payload = envelope.data;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("coreUrl" in payload) ||
    typeof payload.coreUrl !== "string" ||
    !("workspace" in payload) ||
    typeof payload.workspace !== "string"
  ) {
    throw new Error("Electron getEnvPath IPC returned an invalid payload");
  }
  return { coreUrl: payload.coreUrl, workspace: payload.workspace };
}

async function ownedWorkspace(
  runtimeRoot: string,
  workspace: string,
): Promise<string> {
  const [ownedRoot, reportedWorkspace] = await Promise.all([
    realpath(runtimeRoot),
    realpath(workspace),
  ]);
  const relative = path.relative(ownedRoot, reportedWorkspace);
  if (
    relative.length === 0 ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Electron preload workspace is outside the owned runtime root: ${reportedWorkspace}`,
    );
  }
  return reportedWorkspace;
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
  const poll = async (
    candidates: readonly ProcessIdentity[],
  ): Promise<ProcessIdentity[]> => {
    const alive = (
      await Promise.all(
        candidates.map(async (identity) => ({
          identity,
          alive: await identityIsAlive(identity),
        })),
      )
    ).flatMap((result) => (result.alive ? [result.identity] : []));
    if (alive.length === 0) return [];
    if (Date.now() >= deadline) return alive;
    await delay(50);
    return poll(alive);
  };
  return poll(identities);
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
      `Owned Electron process(es) did not exit: ${stubborn
        .map((identity) => identity.pid)
        .join(", ")}`,
    );
  }
}

async function waitForProcessExit(
  identity: ProcessIdentity,
  timeoutMs: number,
): Promise<void> {
  await expect
    .poll(() => identityIsAlive(identity), {
      message: `Electron PID ${identity.pid} must exit`,
      timeout: timeoutMs,
      intervals: [50],
    })
    .toBe(false);
}

async function attachCleanupDiagnostics(
  testInfo: TestInfo,
  resources: ElectronResources,
  errors: readonly string[],
): Promise<void> {
  try {
    await attachBoundedProcessLogs(testInfo, { ui: resources.ui?.process });
  } catch {
    // Preserve the primary test or cleanup error.
  }
  try {
    await attachDiagnostic(
      testInfo,
      "electron-cleanup-errors.log",
      boundedDiagnostics(errors),
    );
  } catch {
    // Preserve the primary test or cleanup error.
  }
}

const test = base.extend<{ electronRuntime: ElectronRuntime }>({
  electronRuntime: [
    async ({ browserName: _browserName }, use, testInfo) => {
      // This fixture deliberately has no page/context dependency so its timeout
      // and teardown ownership remain independent from the test body.
      const runtimeRoot = await mkdtemp(
        path.join(tmpdir(), "mediago-e2e-electron-"),
      );
      const downloadDirectory = path.join(runtimeRoot, "downloads");
      const resources: ElectronResources = {};
      let setupError: unknown;
      let tracingStarted = false;
      let electronClosed = false;
      let networkViolation: Error | undefined;
      let networkGuard: ElectronNetworkGuard | undefined;
      let coreLogDirectory: string | undefined;
      let ownedProcessesBeforeClose: ProcessIdentity[] = [];
      let gracefulCloseError: unknown;

      try {
        await mkdir(downloadDirectory, { recursive: true });
        await assertPortFree(
          "0.0.0.0",
          ELECTRON_CORE_PORT,
          "MediaGo Electron Core",
        );
        resources.media = await loadMediaFixture();
        resources.ui = await startUIProcess("electron");

        const artifactPaths = manualArtifactPaths(testInfo);
        resources.application = await _electron.launch({
          executablePath: electronExecutablePath(),
          args: [ELECTRON_MAIN_PATH],
          env: electronEnvironment(runtimeRoot),
          locale: "en-US",
          artifactsDir: artifactPaths.artifactsDir,
          recordVideo: { dir: artifactPaths.videoDir },
        });
        const electronPid = resources.application.process().pid;
        if (electronPid === undefined) {
          throw new Error(
            "Launched Electron application did not expose its PID",
          );
        }
        resources.electronIdentity = await readProcessIdentity(electronPid);
        if (!resources.electronIdentity) {
          throw new Error(
            `Launched Electron PID ${electronPid} already exited`,
          );
        }

        networkGuard = await installElectronNetworkGuard(resources.application);
        resources.context = resources.application.context();
        await startManualContextArtifacts(resources.context);
        tracingStarted = true;

        await resources.application.firstWindow();
        await expect
          .poll(() =>
            resources.application
              ?.windows()
              .find((page) => page.url() === "http://localhost:8500/")
              ?.url(),
          )
          .toBe("http://localhost:8500/");
        resources.page = resources.application
          .windows()
          .find((page) => page.url() === "http://localhost:8500/");
        if (!resources.page) {
          throw new Error("Electron main window was not available");
        }
        expect(resources.page.url()).toBe("http://localhost:8500/");
        await expect(resources.page).toHaveTitle("MediaGo");
        await expect
          .poll(() =>
            resources.page?.evaluate(
              () =>
                typeof (
                  window as Window & {
                    electron?: { app?: { getEnvPath?: unknown } };
                  }
                ).electron?.app?.getEnvPath,
            ),
          )
          .toBe("function");

        const ipcResult = await resources.page.evaluate(() => {
          const rendererWindow = window as Window & {
            electron?: { app?: { getEnvPath?: () => Promise<unknown> } };
          };
          const getEnvPath = rendererWindow.electron?.app?.getEnvPath;
          if (typeof getEnvPath !== "function") {
            throw new Error("Electron preload getEnvPath is unavailable");
          }
          return getEnvPath();
        });
        const envPath = normalizeEnvPath(ipcResult);
        const workspace = await ownedWorkspace(runtimeRoot, envPath.workspace);
        const coreOrigin = new URL(envPath.coreUrl).origin;
        coreLogDirectory = path.join(workspace, "logs");
        await networkGuard.tighten(coreOrigin);

        const coreClient = new MediaGoClient({ baseURL: coreOrigin });
        coreClient.api.defaults.proxy = false;
        await expect
          .poll(
            async () => {
              try {
                const response = await coreClient.health();
                return response.success && response.data.status === "ok";
              } catch {
                return false;
              }
            },
            { timeout: 15_000 },
          )
          .toBe(true);

        await coreClient.setConfigKey("local", downloadDirectory);
        const localConfig = await coreClient.getConfigKey("local");
        expect(localConfig.data).toBe(downloadDirectory);
      } catch (error) {
        setupError = error;
      }

      if (
        setupError === undefined &&
        resources.media &&
        resources.page &&
        resources.application
      ) {
        await use({
          downloadDirectory,
          media: resources.media,
          page: resources.page,
        });
      }

      const primaryExists =
        setupError !== undefined || hasPrimaryTestError(testInfo);
      const cleanupErrors: string[] = [];
      const application = resources.application;
      const auditNetwork = async (): Promise<void> => {
        if (!networkGuard) return;
        try {
          await networkGuard.assertFinal();
        } catch (error) {
          networkViolation ??=
            error instanceof Error
              ? error
              : new Error(diagnosticMessage(error));
        }
      };

      // Decide artifact retention from a guaranteed teardown audit. A second
      // close-adjacent audit below covers traffic during artifact capture.
      await auditNetwork();

      const auditAndClose = async (): Promise<void> => {
        if (!application) return;
        if (resources.electronIdentity) {
          try {
            ownedProcessesBeforeClose = await collectOwnedProcessTree(
              resources.electronIdentity,
            );
          } catch (error) {
            cleanupErrors.push(
              `snapshot owned Electron tree: ${diagnosticMessage(error)}`,
            );
          }
        }
        await auditNetwork();
        try {
          if (FORCE_CLOSE_FAILURE) {
            throw new Error("Controlled Electron close failure");
          }
          if (FORCE_CLOSE_TIMEOUT) {
            await withDeadline(
              new Promise<never>(() => {}),
              GRACEFUL_CLOSE_TIMEOUT_MS,
              "Controlled Electron close",
            );
          }
          await withDeadline(
            application.close(),
            GRACEFUL_CLOSE_TIMEOUT_MS,
            "Electron graceful close",
          );
          electronClosed = true;
        } catch (error) {
          gracefulCloseError = error;
          if (resources.electronIdentity) {
            try {
              await terminateOwnedProcessTree(
                resources.electronIdentity,
                ownedProcessesBeforeClose,
              );
              await waitForProcessExit(
                resources.electronIdentity,
                PROCESS_EXIT_TIMEOUT_MS,
              );
            } catch (terminationError) {
              cleanupErrors.push(
                `terminate Electron after close failure: ${diagnosticMessage(
                  terminationError,
                )}`,
              );
            }
          }
          throw error;
        }
      };

      if (application) {
        if (resources.context && tracingStarted) {
          try {
            await finalizeManualContextArtifacts({
              testInfo,
              context: resources.context,
              page: resources.page,
              close: auditAndClose,
              failed:
                primaryExists ||
                networkViolation !== undefined ||
                FORCE_CLOSE_FAILURE ||
                FORCE_CLOSE_TIMEOUT,
              name: "electron",
              processes: { ui: resources.ui?.process },
              coreLogDirectory,
            });
          } catch (error) {
            cleanupErrors.push(
              `finalize Electron: ${diagnosticMessage(error)}`,
            );
          }
        } else {
          try {
            await auditAndClose();
          } catch (error) {
            cleanupErrors.push(`close Electron: ${diagnosticMessage(error)}`);
          }
        }
      }

      if (gracefulCloseError !== undefined) {
        cleanupErrors.push(
          `graceful Electron close: ${diagnosticMessage(gracefulCloseError)}`,
        );
      }

      if (resources.electronIdentity) {
        if (!electronClosed) {
          try {
            await terminateOwnedProcessTree(
              resources.electronIdentity,
              ownedProcessesBeforeClose,
            );
          } catch (error) {
            cleanupErrors.push(
              `terminate owned Electron tree: ${diagnosticMessage(error)}`,
            );
          }
        }
        try {
          await waitForProcessExit(
            resources.electronIdentity,
            PROCESS_EXIT_TIMEOUT_MS,
          );
        } catch (error) {
          if (electronClosed) {
            try {
              await terminateOwnedProcessTree(
                resources.electronIdentity,
                ownedProcessesBeforeClose,
              );
              await waitForProcessExit(
                resources.electronIdentity,
                PROCESS_EXIT_TIMEOUT_MS,
              );
            } catch (terminationError) {
              cleanupErrors.push(
                `terminate lingering Electron tree: ${diagnosticMessage(
                  terminationError,
                )}`,
              );
            }
          } else {
            cleanupErrors.push(
              `wait for Electron PID: ${diagnosticMessage(error)}`,
            );
          }
        }
      }

      try {
        await waitForPortFree("0.0.0.0", ELECTRON_CORE_PORT, 10_000);
      } catch (error) {
        cleanupErrors.push(
          `wait for Electron Core port: ${diagnosticMessage(error)}`,
        );
      }

      if (networkViolation) {
        try {
          await attachDiagnostic(
            testInfo,
            "electron-network-violation.log",
            diagnosticMessage(networkViolation),
          );
        } catch (error) {
          cleanupErrors.push(
            `attach Electron network violation: ${diagnosticMessage(error)}`,
          );
        }
      }
      try {
        await resources.ui?.process.stop();
      } catch (error) {
        cleanupErrors.push(`stop UI: ${diagnosticMessage(error)}`);
      }
      try {
        await resources.media?.close();
      } catch (error) {
        cleanupErrors.push(`stop media: ${diagnosticMessage(error)}`);
      }
      try {
        await rm(runtimeRoot, { recursive: true, force: true });
      } catch (error) {
        cleanupErrors.push(
          `remove runtime directory: ${diagnosticMessage(error)}`,
        );
      }

      if (cleanupErrors.length > 0) {
        await attachCleanupDiagnostics(testInfo, resources, cleanupErrors);
      } else if (
        (primaryExists || networkViolation) &&
        (!resources.context || !tracingStarted)
      ) {
        try {
          await attachBoundedProcessLogs(testInfo, {
            ui: resources.ui?.process,
          });
        } catch {
          // Preserve the primary or network error.
        }
      }

      if (setupError !== undefined) throw setupError;
      if (primaryExists) return;
      if (networkViolation) throw networkViolation;
      if (cleanupErrors.length > 0) {
        throw new Error(boundedDiagnostics(cleanupErrors));
      }
    },
    { auto: true, timeout: ELECTRON_FIXTURE_TIMEOUT_MS },
  ],
});

test("downloads a direct MP4 through Electron and shuts down Core", async ({
  electronRuntime,
}, testInfo) => {
  if (FORCE_NETWORK_VIOLATION) {
    await electronRuntime.page.evaluate(async () => {
      try {
        await fetch("https://guard-probe.invalid/network");
      } catch {
        // The teardown audit must report this intentional policy violation.
      }
    });
  }
  if (FORCE_TEST_TIMEOUT) {
    testInfo.setTimeout(1);
    await new Promise<never>(() => {});
  }

  await electronRuntime.page
    .getByRole("button", { name: "New download" })
    .first()
    .click();
  await electronRuntime.page
    .getByRole("combobox", { name: "Download type" })
    .click();
  await electronRuntime.page
    .getByRole("option", { name: "Direct download (MP4)" })
    .click();
  await electronRuntime.page
    .getByLabel("Video name")
    .fill("electron-e2e-sample");
  await electronRuntime.page
    .getByLabel("Video link")
    .fill(electronRuntime.media.sampleURL);
  await electronRuntime.page
    .getByRole("button", { name: "Download now" })
    .click();
  await electronRuntime.page
    .getByRole("link", { name: "Download complete" })
    .click();

  const task = electronRuntime.page.getByRole("article", {
    name: "electron-e2e-sample",
  });
  await expect(task).toContainText("Download complete", { timeout: 30_000 });
  await verifyFixtureCopy(electronRuntime.downloadDirectory);
});
