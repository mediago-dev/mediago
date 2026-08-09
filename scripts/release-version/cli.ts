import {
  RELEASE_CHANNELS,
  RELEASE_MODES,
  VERSION_INCREMENTS,
  type ExecuteReleaseVersionOptions,
} from "./contracts.ts";
import { executeReleaseVersion, formatOutputs } from "./execute.ts";

function parseChoice<T extends string>(
  name: string,
  value: string | undefined,
  choices: readonly T[],
): T {
  if (value === undefined || !choices.includes(value as T)) {
    throw new Error(`--${name} must be one of: ${choices.join(", ")}`);
  }
  return value as T;
}

function parseCliOptions(args: string[]): ExecuteReleaseVersionOptions {
  const allowed = new Set([
    "mode",
    "channel",
    "increment",
    "resume-current",
    "run-number",
    "workspace-root",
    "github-output",
  ]);
  const values: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--") continue;
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const equalsIndex = argument.indexOf("=");
    const name =
      equalsIndex === -1 ? argument.slice(2) : argument.slice(2, equalsIndex);
    let value =
      equalsIndex === -1 ? undefined : argument.slice(equalsIndex + 1);
    if (!allowed.has(name)) throw new Error(`Unknown option: --${name}`);
    if (values[name] !== undefined) {
      throw new Error(`Duplicate option: --${name}`);
    }
    if (value === undefined) {
      value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Missing value for --${name}`);
      }
      index += 1;
    }
    if (value.length === 0) throw new Error(`Missing value for --${name}`);
    values[name] = value;
  }

  const resumeCurrent = values["resume-current"] ?? "false";
  if (resumeCurrent !== "true" && resumeCurrent !== "false") {
    throw new Error("--resume-current must be true or false");
  }

  return {
    mode: parseChoice("mode", values.mode, RELEASE_MODES),
    channel: parseChoice("channel", values.channel, RELEASE_CHANNELS),
    increment: parseChoice("increment", values.increment, VERSION_INCREMENTS),
    resumeCurrent: resumeCurrent === "true",
    runNumber: values["run-number"],
    workspaceRoot: values["workspace-root"],
    githubOutput: values["github-output"],
  };
}

function printUsage(): void {
  process.stdout.write(`Usage:
  node scripts/release-version.ts --mode <test|release> --channel <alpha|beta|latest> --increment <patch|minor|major>

Options:
  --run-number <number>    Required in test mode outside GitHub Actions
  --resume-current <bool>  Resume the current version after a draft failure
  --workspace-root <path>  Override repository root
  --github-output <path>   Append key=value outputs to this file
  --help                   Show this help
`);
}

export function runReleaseVersionCli(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    return;
  }
  try {
    const result = executeReleaseVersion(parseCliOptions(args));
    process.stderr.write(
      `[release-version] ${result.currentVersion} -> ${result.version}` +
        `${result.pending ? " (pending retry)" : ""}${result.written ? " (written)" : ""}\n`,
    );
    process.stdout.write(`${formatOutputs(result.outputs)}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[release-version] ${message}\n`);
    process.exitCode = 1;
  }
}
