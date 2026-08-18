import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SENTINEL_ENV_KEY = "MEDIAGO_TEST_SENTINEL_SECRET";
const SENTINEL_VALUE = "mediago_bundle_secret_sentinel_6f2e7c9a";
const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const productionLocalEnvPath = path.join(projectRoot, ".env.production.local");
const bundleDirectories = [
  "apps/server/build",
  "apps/electron/build",
  "apps/ui/build",
].map((directory) => path.join(projectRoot, directory));

export function buildVerificationEnvironment(
  input: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...input,
    MEDIAGO_PROFILE: "production",
  };
  delete environment[SENTINEL_ENV_KEY];
  delete environment.NODE_OPTIONS;
  return environment;
}

export function definesSentinelEnvironmentKey(
  contents: Buffer | string,
): boolean {
  return /^\s*(?:export\s+)?MEDIAGO_TEST_SENTINEL_SECRET\s*(?:=|:)/m.test(
    contents.toString(),
  );
}

async function readOptionalFile(
  filename: string,
): Promise<{ bytes: Buffer; exists: boolean }> {
  try {
    return { bytes: await fs.readFile(filename), exists: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { bytes: Buffer.alloc(0), exists: false };
    }
    throw error;
  }
}

function runPnpm(
  args: string[],
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  const executable = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `${executable} ${args.join(" ")} failed with ${
            signal ? `signal ${signal}` : `exit code ${String(code)}`
          }`,
        ),
      );
    });
  });
}

async function filesContainingSentinel(directory: string): Promise<string[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map(async (entry): Promise<string[]> => {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return filesContainingSentinel(filename);
        }
        if (entry.isFile()) {
          const contents = await fs.readFile(filename);
          if (contents.includes(Buffer.from(SENTINEL_VALUE))) {
            return [filename];
          }
        }
        return [];
      }),
    )
  ).flat();
}

async function main(): Promise<void> {
  const original = await readOptionalFile(productionLocalEnvPath);
  if (definesSentinelEnvironmentKey(original.bytes)) {
    throw new Error(
      `${productionLocalEnvPath} already defines ${SENTINEL_ENV_KEY}; refusing to overwrite it`,
    );
  }

  const separator =
    original.bytes.length === 0 || original.bytes.at(-1) === 0x0a ? "" : "\n";
  const sentinelLine = Buffer.from(
    `${separator}${SENTINEL_ENV_KEY}=${SENTINEL_VALUE}\n`,
  );

  try {
    await fs.writeFile(
      productionLocalEnvPath,
      Buffer.concat([original.bytes, sentinelLine]),
    );

    const environment = buildVerificationEnvironment(process.env);

    await runPnpm(["--filter", "@mediago/server", "run", "build"], environment);
    await runPnpm(["run", "build:electron", "--force"], environment);

    const matches = (
      await Promise.all(
        bundleDirectories.map((directory) =>
          filesContainingSentinel(directory),
        ),
      )
    ).flat();
    if (matches.length > 0) {
      throw new Error(
        `Secret sentinel was bundled into:\n${matches
          .map((filename) => path.relative(projectRoot, filename))
          .join("\n")}`,
      );
    }
  } finally {
    if (original.exists) {
      await fs.writeFile(productionLocalEnvPath, original.bytes);
    } else {
      await fs.rm(productionLocalEnvPath, { force: true });
    }
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  fileURLToPath(import.meta.url) === path.resolve(entryPath)
) {
  await main();
  process.stdout.write("Bundle environment sentinel verification passed.\n");
}
