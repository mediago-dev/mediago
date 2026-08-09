import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runReleaseVersionCli } from "./release-version/cli.ts";

export type {
  ExecuteReleaseVersionOptions,
  ParsedSemVer,
  ReleaseChannel,
  ReleaseMode,
  ReleasePlan,
  ReleasePlanInput,
  ReleaseVersionResult,
  VersionIncrement,
} from "./release-version/contracts.ts";
export {
  executeReleaseVersion,
  readGitTags,
} from "./release-version/execute.ts";
export { planRelease } from "./release-version/planning.ts";
export {
  compareSemVer,
  formatSemVer,
  parseSemVer,
} from "./release-version/semver.ts";
export { assertTagAvailable } from "./release-version/tags.ts";

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) runReleaseVersionCli(process.argv.slice(2));
