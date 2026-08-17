import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortFree } from "./ports.ts";
import { startManagedProcess, type ManagedProcess } from "./process.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SERVER_PORT = 9900;
const LOCAL_NO_PROXY =
  "localhost,127.0.0.1,::1,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16";

export interface StartedServerProcess {
  process: ManagedProcess;
  baseURL: string;
}

function serverEnvironment(runtimeRoot: string): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      /^(?:http|https|all|ftp)_proxy$/i.test(key) ||
      /^no_proxy$/i.test(key)
    ) {
      delete environment[key];
    }
  }
  return {
    ...environment,
    MEDIAGO_SERVER_ROOT: path.resolve(runtimeRoot),
    MEDIAGO_DEPS_DIR: path.join(REPOSITORY_ROOT, ".deps/linux-x64"),
    NO_PROXY: LOCAL_NO_PROXY,
    no_proxy: LOCAL_NO_PROXY,
  };
}

export async function startServerProcess(
  runtimeRoot: string,
): Promise<StartedServerProcess> {
  await assertPortFree("127.0.0.1", SERVER_PORT, "MediaGo Web Core");
  const baseURL = `http://127.0.0.1:${SERVER_PORT}`;
  const managedProcess = await startManagedProcess({
    label: "MediaGo Server",
    command: process.execPath,
    args: [path.join(REPOSITORY_ROOT, "apps/server/build/index.js")],
    cwd: REPOSITORY_ROOT,
    env: serverEnvironment(runtimeRoot),
    readinessURL: `${baseURL}/healthy`,
  });
  return { process: managedProcess, baseURL };
}
