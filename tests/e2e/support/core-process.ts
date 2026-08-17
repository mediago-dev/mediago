import { constants } from "node:fs";
import { access, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MediaGoClient } from "../../../packages/core-sdk/src/index.ts";
import { assertPortFree } from "./ports.ts";
import { startManagedProcess, type ManagedProcess } from "./process.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const LOCAL_NO_PROXY =
  "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

export interface StartCoreProcessOptions {
  runtimeRoot: string;
  port: number;
}

export interface StartedCoreProcess {
  process: ManagedProcess;
  client: MediaGoClient;
  baseURL: string;
  downloadDirectory: string;
}

function withoutInheritedProxies(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:http|https|all|ftp)_proxy$/i.test(key) ||
      /^no_proxy$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  return environment;
}

async function assertExecutable(
  filePath: string,
  label: string,
): Promise<void> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0)
      throw new Error("not a regular file");
    await access(filePath, constants.X_OK);
  } catch (error) {
    throw new Error(`${label} is missing or not executable: ${filePath}`, {
      cause: error,
    });
  }
}

export async function startCoreProcess(
  options: StartCoreProcessOptions,
): Promise<StartedCoreProcess> {
  if (process.platform !== "linux" || process.arch !== "x64") {
    throw new Error(
      `E2E Core supports only linux-x64; received ${process.platform}-${process.arch}`,
    );
  }

  const runtimeRoot = path.resolve(options.runtimeRoot);
  const depsDirectory = path.join(REPOSITORY_ROOT, ".deps/linux-x64");
  await assertExecutable(path.join(depsDirectory, "aria2c"), "E2E aria2c");
  await assertPortFree("127.0.0.1", options.port, "MediaGo Core");

  const configDirectory = path.join(runtimeRoot, "config");
  const logDirectory = path.join(runtimeRoot, "logs");
  const downloadDirectory = path.join(runtimeRoot, "downloads");
  const dataDirectory = path.join(runtimeRoot, "data");
  const databasePath = path.join(dataDirectory, "mediago.db");
  await Promise.all(
    [configDirectory, logDirectory, downloadDirectory, dataDirectory].map(
      (directory) => mkdir(directory, { recursive: true }),
    ),
  );

  const baseURL = `http://127.0.0.1:${options.port}`;
  const environment = withoutInheritedProxies();
  const managedProcess = await startManagedProcess({
    label: "MediaGo Core",
    command: path.join(REPOSITORY_ROOT, "apps/core/bin/mediago-core"),
    args: [
      "--port",
      String(options.port),
      "--deps-dir",
      depsDirectory,
      "--local-dir",
      downloadDirectory,
      "--config-dir",
      configDirectory,
      "--log-dir",
      logDirectory,
      "--db-path",
      databasePath,
      "--max-runner",
      "1",
      "--log-level",
      "error",
    ],
    cwd: REPOSITORY_ROOT,
    env: {
      ...environment,
      HOST: "127.0.0.1",
      PORT: String(options.port),
      NO_PROXY: LOCAL_NO_PROXY,
      no_proxy: LOCAL_NO_PROXY,
    },
    readinessURL: `${baseURL}/healthy`,
  });
  const client = new MediaGoClient({ baseURL });
  client.api.defaults.proxy = false;

  return {
    process: managedProcess,
    client,
    baseURL,
    downloadDirectory,
  };
}
