import type { ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type EnvironmentTransaction,
  verifyBundleEnvironment,
} from "./bundle-env-transaction.ts";
import {
  filesContainingSentinel,
  probePnpmPath,
  resolvePnpmEntrypoint,
  runPnpm,
  terminateChild,
} from "./bundle-env-runtime.ts";

export {
  buildVerificationEnvironment,
  definesSentinelEnvironmentKey,
} from "./bundle-env-values.ts";
export {
  createPnpmLauncher,
  type PnpmProbeResult,
  resolvePnpmEntrypoint,
} from "./bundle-env-runtime.ts";
export {
  type BundleVerificationOptions,
  type EnvironmentTransaction,
  injectBundleVerificationEnvironment,
  verifyBundleEnvironment,
} from "./bundle-env-transaction.ts";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const productionLocalEnvPath = path.join(projectRoot, ".env.production.local");
const bundleDirectories = [
  "apps/server/build",
  "apps/electron/build",
  "apps/ui/build",
].map((directory) => path.join(projectRoot, directory));

export async function handleTermination(options: {
  cleanup: EnvironmentTransaction["cleanup"] | undefined;
  exit: (code: number) => void;
  reportError: (error: unknown) => void;
  signal: "SIGINT" | "SIGTERM";
  terminateActiveChild: () => Promise<void>;
}): Promise<void> {
  try {
    await options.terminateActiveChild();
  } catch (error) {
    options.reportError(error);
  }
  try {
    await options.cleanup?.();
  } catch (error) {
    options.reportError(error);
  }
  options.exit(options.signal === "SIGINT" ? 130 : 143);
}

async function main(): Promise<void> {
  const entrypoint = await resolvePnpmEntrypoint({
    environment: process.env,
    platform: process.platform,
    probe: probePnpmPath,
  });
  let activeChild: ChildProcess | undefined;
  let activeCleanup: EnvironmentTransaction["cleanup"] | undefined;
  let terminating = false;
  const runTermination = (signal: "SIGINT" | "SIGTERM") => {
    if (terminating) return;
    terminating = true;
    void handleTermination({
      cleanup: activeCleanup,
      exit: (code) => process.exit(code),
      reportError: (error) => {
        process.stderr.write(
          `Bundle verification cleanup failed: ${String(error)}\n`,
        );
      },
      signal,
      terminateActiveChild: () => terminateChild(activeChild, signal),
    });
  };
  const onSigint = () => runTermination("SIGINT");
  const onSigterm = () => runTermination("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  try {
    await verifyBundleEnvironment({
      environment: process.env,
      onCleanupReady: (cleanup) => {
        activeCleanup = cleanup;
      },
      runBuilds: async (environment) => {
        await runPnpm({
          args: ["--filter", "@mediago/server", "run", "build"],
          cwd: projectRoot,
          entrypoint,
          environment,
          setActiveChild: (child) => {
            activeChild = child;
          },
        });
        await runPnpm({
          args: ["run", "build:electron", "--force"],
          cwd: projectRoot,
          entrypoint,
          environment,
          setActiveChild: (child) => {
            activeChild = child;
          },
        });
      },
      scanBundles: async () =>
        (
          await Promise.all(
            bundleDirectories.map((directory) =>
              filesContainingSentinel(directory),
            ),
          )
        ).flat(),
      targetPath: productionLocalEnvPath,
    });
  } catch (error) {
    if (!terminating) throw error;
  } finally {
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
}

if (import.meta.main) {
  await main();
  process.stdout.write("Bundle environment sentinel verification passed.\n");
}
