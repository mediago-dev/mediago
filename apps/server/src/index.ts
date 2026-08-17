import "reflect-metadata";
import os from "node:os";
import path, { dirname } from "node:path";
import fs from "node:fs";
import { ServiceRunner } from "@mediago/service-runner";
import { resolveCoreBinaries, resolveDepsBinaries } from "./binaryResolver";
import { resolveServerPaths } from "./server-paths";
import dotenvFlow from "dotenv-flow";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
dotenvFlow.config({
  path: projectRoot,
});

if (!process.env.APP_NAME) {
  throw new Error("APP_NAME is not defined in environment variables");
}

const serverPaths = resolveServerPaths({
  appName: process.env.APP_NAME,
  homeDir: os.homedir(),
  rootOverride: process.env.MEDIAGO_SERVER_ROOT,
});

// Ensure directories exist
fs.mkdirSync(serverPaths.data, { recursive: true });
fs.mkdirSync(serverPaths.logs, { recursive: true });
fs.mkdirSync(serverPaths.downloads, { recursive: true });

const core = resolveCoreBinaries();
const deps = resolveDepsBinaries();

const runner = new ServiceRunner({
  executableName: "mediago-core",
  executableDir: path.dirname(core.coreBin),
  preferredPort: 9900,
  internal: true,
  extraArgs: [
    `--enable-auth`,
    `--log-level=debug`,
    `--log-dir=${serverPaths.logs}`,
    `--local-dir=${serverPaths.downloads}`,
    `--schema-path=${core.coreConfig}`,
    `--deps-dir=${deps.depsDir}`,
    `--db-path=${serverPaths.database}`,
    `--config-dir=${serverPaths.data}`,
  ],
});

runner.on("stdout", (chunk) => {
  process.stdout.write(chunk);
});

runner.on("stderr", (chunk) => {
  process.stderr.write(chunk);
});

runner.on("exit", (code, signal) => {
  console.log(`Go Core exited with code=${code}, signal=${signal}`);
});

const state = await runner.start();
console.log(`Go Core started at ${state.url} (pid: ${state.pid})`);
console.log(`Player UI available at ${state.url}/player/`);

// Handle graceful shutdown
const shutdown = async () => {
  console.log("Shutting down...");
  await runner.stop();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
