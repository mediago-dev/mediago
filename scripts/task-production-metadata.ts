import fs from "node:fs";
import path from "node:path";

const ALLOWED_METADATA_NAMES = new Set(["APP_NAME", "APP_ID", "APP_COPYRIGHT"]);
const DOTENV_FILES = [
  ".env.production.local",
  ".env.local",
  ".env.production",
  ".env",
];

const metadataName = process.argv[2];
if (metadataName === undefined || !ALLOWED_METADATA_NAMES.has(metadataName)) {
  process.stderr.write("Unsupported production metadata variable name.\n");
  process.exit(2);
}

const assignment = new RegExp(`^\\s*(?:export\\s+)?${metadataName}\\s*=`, "m");
const configured =
  process.env[metadataName] !== undefined ||
  DOTENV_FILES.some((filename) => {
    const absolutePath = path.resolve(process.cwd(), filename);
    return (
      fs.existsSync(absolutePath) &&
      assignment.test(fs.readFileSync(absolutePath, "utf8"))
    );
  });

process.stdout.write(configured ? "present" : "missing");
