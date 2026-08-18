import { loadProfileEnv } from "./load-profile-env.ts";

const ALLOWED_METADATA_NAMES = new Set(["APP_NAME", "APP_ID", "APP_COPYRIGHT"]);

const metadataName = process.argv[2];
if (metadataName === undefined || !ALLOWED_METADATA_NAMES.has(metadataName)) {
  process.stderr.write("Unsupported production metadata variable name.\n");
  process.exit(2);
}

process.env.MEDIAGO_PROFILE ??= "production";
loadProfileEnv(process.cwd());
const configured = (process.env[metadataName]?.trim().length ?? 0) > 0;

process.stdout.write(configured ? "present" : "missing");
