import { fileURLToPath } from "node:url";
import { assertPortFree } from "./ports.ts";
import { startManagedProcess, type ManagedProcess } from "./process.ts";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

export type UITarget = "server" | "electron";

export interface StartedUIProcess {
  process: ManagedProcess;
  baseURL: string;
  target: UITarget;
}

function targetPort(target: UITarget): number {
  return target === "server" ? 8501 : 8500;
}

export async function startUIProcess(
  target: UITarget,
): Promise<StartedUIProcess> {
  const port = targetPort(target);
  await assertPortFree("127.0.0.1", port, `MediaGo ${target} UI`);
  const baseURL = `http://127.0.0.1:${port}`;
  const managedProcess = await startManagedProcess({
    label: `MediaGo ${target} UI`,
    command: "pnpm",
    args: ["--filter", "@mediago/ui", "exec", "vite", "--host", "127.0.0.1"],
    cwd: REPOSITORY_ROOT,
    env: { ...process.env, APP_TARGET: target },
    readinessURL: `${baseURL}/`,
  });
  return { process: managedProcess, baseURL, target };
}
