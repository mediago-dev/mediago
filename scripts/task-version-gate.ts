import { pathToFileURL } from "node:url";

export const REQUIRED_TASK_VERSION = "3.51.1";

const TASK_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export type TaskVersionGateResult =
  | { exitCode: 0 }
  | { exitCode: 1; message: string };

export function evaluateTaskVersion(
  actualVersion: unknown,
  requiredVersion: unknown,
): TaskVersionGateResult {
  if (requiredVersion !== REQUIRED_TASK_VERSION) {
    return {
      exitCode: 1,
      message: `Task version gate is misconfigured; the repository pin must remain ${REQUIRED_TASK_VERSION}.`,
    };
  }
  if (
    typeof actualVersion !== "string" ||
    !TASK_VERSION_PATTERN.test(actualVersion)
  ) {
    return {
      exitCode: 1,
      message: "Invalid Task version received from the Task runner.",
    };
  }
  if (actualVersion !== REQUIRED_TASK_VERSION) {
    return {
      exitCode: 1,
      message: [
        `Task ${actualVersion} is installed; MediaGo requires ${REQUIRED_TASK_VERSION}.`,
        `Install or switch Task: https://taskfile.dev/installation/ (mise: mise use task@${REQUIRED_TASK_VERSION}).`,
      ].join(" "),
    };
  }
  return { exitCode: 0 };
}

export function runTaskVersionGate(
  environment: NodeJS.ProcessEnv = process.env,
  writeError: (message: string) => void = (message) =>
    process.stderr.write(`${message}\n`),
): number {
  const result = evaluateTaskVersion(
    environment.MEDIAGO_TASK_VERSION,
    environment.MEDIAGO_REQUIRED_TASK_VERSION,
  );
  if (result.exitCode !== 0) writeError(result.message);
  return result.exitCode;
}

function isMainModule(): boolean {
  const entrypoint = process.argv[1];
  return (
    entrypoint !== undefined &&
    import.meta.url === pathToFileURL(entrypoint).href
  );
}

if (isMainModule()) process.exitCode = runTaskVersionGate();
