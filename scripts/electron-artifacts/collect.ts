import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ElectronArtifactValidation } from "./contracts.ts";
import { filesHaveSameContents, listFiles } from "./files.ts";
import { mergeMacManifests } from "./manifest.ts";
import { validateCompleteRelease } from "./validation.ts";

const RELEASE_FILE_PATTERN = /\.(?:exe|dmg|zip|deb|blockmap|ya?ml)$/i;
const MAC_MANIFEST_PATTERN = /^(?:latest|alpha|beta|test)-mac\.ya?ml$/i;

function groupByFilename(files: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const name = path.basename(file);
    const matches = groups.get(name) ?? [];
    matches.push(file);
    groups.set(name, matches);
  }
  return groups;
}

async function collectNamedFiles(
  name: string,
  sources: readonly string[],
  outputDirectory: string,
  strict: boolean,
): Promise<string> {
  const destination = path.join(outputDirectory, name);
  if (sources.length === 1) {
    await cp(sources[0], destination);
    return destination;
  }

  if (MAC_MANIFEST_PATTERN.test(name)) {
    if (strict && sources.length !== 2) {
      throw new Error(
        `Expected two macOS updater manifests named ${name}, found ${sources.length}`,
      );
    }
    const manifests = await Promise.all(
      sources.map(async (source) => ({
        source,
        content: await readFile(source, "utf8"),
      })),
    );
    await writeFile(destination, mergeMacManifests(manifests), "utf8");
    return destination;
  }

  const [first, ...duplicates] = sources;
  const allEqual = (
    await Promise.all(
      duplicates.map((file) => filesHaveSameContents(first, file)),
    )
  ).every(Boolean);
  if (!allEqual) {
    throw new Error(`Conflicting Electron release files named ${name}`);
  }
  await cp(first, destination);
  return destination;
}

export async function collectElectronArtifacts(
  inputDirectory: string,
  outputDirectory: string,
  validation?: ElectronArtifactValidation,
): Promise<string[]> {
  const input = path.resolve(inputDirectory);
  const output = path.resolve(outputDirectory);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });

  const candidates = (await listFiles(input)).filter((file) => {
    const name = path.basename(file);
    return RELEASE_FILE_PATTERN.test(name) && !/^builder-/i.test(name);
  });
  if (candidates.length === 0) {
    throw new Error(`No Electron release files found below ${input}`);
  }

  const groups = [...groupByFilename(candidates)];
  // The root editor config targets ES2020; this is a fresh array, so mutation is local.
  // oxlint-disable-next-line unicorn/no-array-sort
  groups.sort(([left], [right]) => left.localeCompare(right));
  const results = await Promise.allSettled(
    groups.map(([name, sources]) =>
      collectNamedFiles(name, sources, output, validation !== undefined),
    ),
  );
  const collected = results.map((result) => {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  });
  if (validation) await validateCompleteRelease(collected, validation);
  return collected;
}
