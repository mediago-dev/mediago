import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config, devConfig } from "./config";
import { replacePlayerAssets } from "./player-assets";
import { getExeExt, mkdir, runCommand } from "./utils";

const appVersion = (
  JSON.parse(
    readFileSync(join("..", "electron", "app", "package.json"), "utf8"),
  ) as { version: string }
).version;

/**
 * Start the development server
 */
export async function dev() {
  console.log("🚀 Starting development server...");
  const args = [
    "run",
    "-tags",
    "dev",
    "-work",
    config.CMD_PATH,
    `-log-level=${devConfig.log_level}`,
    `-log-dir=${devConfig.log_dir}`,
    `-config-dir=${devConfig.config_dir}`,
    `-schema-path=${devConfig.schema_path}`,
    `-max-runner=${devConfig.max_runner.toString()}`,
    `-local-dir=${devConfig.local_dir}`,
    `-delete-segments=${devConfig.delete_segments.toString()}`,
    `-proxy=${devConfig.proxy}`,
    `-use-proxy=${devConfig.use_proxy.toString()}`,
    `-deps-dir=${devConfig.deps_dir}`,
  ];
  await runCommand("go", args, { description: "Start development server" });
}

/**
 * Build player-ui and copy dist to core assets for embedding
 */
export async function buildPlayerUI() {
  console.log("🎬 Building Player UI...");
  const playerUiDist = join(config.PLAYER_UI_DIR, "dist");

  await runCommand("pnpm", ["build"], { cwd: config.PLAYER_UI_DIR });

  if (!existsSync(playerUiDist)) {
    throw new Error(
      `Expected player-ui build output at ${playerUiDist} but it was not found`,
    );
  }

  replacePlayerAssets(playerUiDist, config.PLAYER_ASSETS_DIR);

  console.log(`✅ Player UI copied to ${config.PLAYER_ASSETS_DIR}`);
}

async function buildCurrentPlatformBinary(
  name: string,
  commandPath: string,
  ldflags: string,
) {
  const output = join(config.BIN_DIR, name + getExeExt());
  await runCommand(
    "go",
    [
      "build",
      "-tags",
      "dev",
      "-trimpath",
      "-ldflags",
      ldflags,
      "-o",
      output,
      commandPath,
    ],
    { description: `Compile ${name} for current platform` },
  );
  if (process.platform !== "win32") {
    chmodSync(output, 0o755);
  }
  return output;
}

/**
 * Compile the core service and CLI for the current platform.
 */
export async function devBuild() {
  console.log("🔨 Compiling development build...");

  await buildPlayerUI();
  mkdir(config.BIN_DIR);

  const [serverOutput, cliOutput] = await Promise.all([
    buildCurrentPlatformBinary(
      config.APP_NAME,
      config.CMD_PATH,
      config.GO_LDFLAGS,
    ),
    buildCurrentPlatformBinary(
      config.CLI_APP_NAME,
      config.CLI_CMD_PATH,
      `${config.GO_LDFLAGS} -X main.version=${appVersion}`,
    ),
  ]);

  console.log(`✅ Core service compiled -> ${serverOutput}`);
  console.log(`✅ CLI compiled -> ${cliOutput}`);
}
