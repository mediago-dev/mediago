import fs from "node:fs";
import path from "node:path";
import dotenvFlow from "dotenv-flow";

export type MediaGoProfile = "development" | "test" | "production";

export function loadProfileEnv(projectRoot: string): MediaGoProfile {
  const rawProfile =
    process.env.MEDIAGO_PROFILE ?? process.env.NODE_ENV ?? "development";

  if (
    rawProfile !== "development" &&
    rawProfile !== "test" &&
    rawProfile !== "production"
  ) {
    throw new Error(`Unsupported MediaGo profile "${rawProfile}"`);
  }

  const files = [
    ".env",
    `.env.${rawProfile}`,
    ".env.local",
    `.env.${rawProfile}.local`,
  ]
    .map((filename) => path.resolve(projectRoot, filename))
    .filter((filename) => fs.existsSync(filename));

  const result = dotenvFlow.load(files, { silent: true });
  if (result.error) {
    throw result.error;
  }

  return rawProfile;
}
