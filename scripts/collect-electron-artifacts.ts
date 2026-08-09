import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectElectronArtifacts } from "./electron-artifacts/collect.ts";
import { isElectronUpdateChannel } from "./electron-artifacts/contracts.ts";

export { collectElectronArtifacts } from "./electron-artifacts/collect.ts";
export type {
  ElectronArtifactValidation,
  ElectronUpdateChannel,
} from "./electron-artifacts/contracts.ts";

async function main(): Promise<void> {
  const [inputDirectory, outputDirectory, version, channel] =
    process.argv.slice(2);
  if (!inputDirectory || !outputDirectory || !version || !channel) {
    throw new Error(
      "Usage: node scripts/collect-electron-artifacts.ts <input-directory> <output-directory> <version> <alpha|beta|latest|test>",
    );
  }
  if (!isElectronUpdateChannel(channel)) {
    throw new Error(`Unsupported updater channel: ${channel}`);
  }

  const collected = await collectElectronArtifacts(
    inputDirectory,
    outputDirectory,
    { version, channel },
  );
  process.stdout.write(`${collected.join("\n")}\n`);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) await main();
