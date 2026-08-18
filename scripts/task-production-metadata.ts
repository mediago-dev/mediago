import { loadProfileEnv } from "./load-profile-env.ts";

const ALLOWED_METADATA_NAMES = new Set(["APP_NAME", "APP_ID", "APP_COPYRIGHT"]);

const metadataName = process.argv[2];
if (metadataName === undefined || !ALLOWED_METADATA_NAMES.has(metadataName)) {
  process.stderr.write("Unsupported production metadata variable name.\n");
  process.exit(2);
}

process.env.MEDIAGO_PROFILE ??= "production";
try {
  loadProfileEnv(process.cwd());
} catch {
  process.stderr.write(
    "Production metadata validation could not load the selected profile. Set MEDIAGO_PROFILE to development, test, or production and check the matching dotenv files.\n",
  );
  process.exit(2);
}
const configured = (process.env[metadataName]?.trim().length ?? 0) > 0;

process.stdout.write(configured ? "present" : "missing");
