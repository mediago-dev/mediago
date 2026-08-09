import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  isElectronUpdateChannel,
  type ElectronArtifactValidation,
} from "./contracts.ts";
import { fileDigest } from "./files.ts";
import {
  parseUpdaterManifestEntry,
  parseYamlScalar,
  parseUpdaterManifest,
  releaseAssetName,
  type UpdaterManifestEntry,
} from "./manifest.ts";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
}

function requireSingleAsset(
  names: readonly string[],
  description: string,
  suffix: string,
): string {
  const pattern = new RegExp(`^.+-${escapeRegExp(suffix)}$`, "i");
  const matches = names.filter((name) => pattern.test(name));
  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one ${description}, found ${matches.length}: ${matches.join(", ") || "none"}`,
    );
  }
  return matches[0];
}

function parseOptionalSize(
  raw: string | undefined,
  key: "blockMapSize" | "size",
  source: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const value = parseYamlScalar(raw, source);
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${source} contains an invalid ${key}: ${value}`);
  }
  const size = Number(value);
  if (!Number.isSafeInteger(size)) {
    throw new Error(`${source} contains an unsafe ${key}: ${value}`);
  }
  return size;
}

async function validateManifestEntry(
  entry: UpdaterManifestEntry,
  source: string,
  fileByName: ReadonlyMap<string, string>,
): Promise<string> {
  const assetName = releaseAssetName(entry.url, source);
  const assetPath = fileByName.get(assetName);
  if (!assetPath) {
    throw new Error(`${source} references missing release asset ${assetName}`);
  }

  const expectedSha512 = parseYamlScalar(entry.sha512Value, source);
  const actualSha512 = await fileDigest(assetPath, "sha512", "base64");
  if (actualSha512 !== expectedSha512) {
    throw new Error(`${source} contains the wrong sha512 for ${assetName}`);
  }

  const assetSize = (await stat(assetPath)).size;
  const declaredSize = parseOptionalSize(entry.sizeValue, "size", source);
  if (declaredSize !== undefined && declaredSize !== assetSize) {
    throw new Error(`${source} contains the wrong size for ${assetName}`);
  }

  const blockMapSize = parseOptionalSize(
    entry.blockMapSizeValue,
    "blockMapSize",
    source,
  );
  if (blockMapSize !== undefined) {
    const blockmapPath = fileByName.get(`${assetName}.blockmap`);
    if (!blockmapPath) {
      throw new Error(
        `${source} references a blockmap for ${assetName}, but it is missing`,
      );
    }
    if ((await stat(blockmapPath)).size !== blockMapSize) {
      throw new Error(
        `${source} contains the wrong blockMapSize for ${assetName}`,
      );
    }
  }
  return assetName;
}

function assertExactInventory(
  names: readonly string[],
  expectedNames: ReadonlySet<string>,
): void {
  const unexpected = names.filter((name) => !expectedNames.has(name));
  const missing = [...expectedNames].filter((name) => !names.includes(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `Electron release inventory mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

async function validateManifest(
  manifestName: string,
  expectedAssets: readonly string[],
  expectedVersion: string,
  fileByName: ReadonlyMap<string, string>,
): Promise<void> {
  const manifestPath = fileByName.get(manifestName);
  if (!manifestPath) {
    throw new Error(`Missing required updater manifest: ${manifestName}`);
  }

  const manifest = parseUpdaterManifest(
    await readFile(manifestPath, "utf8"),
    manifestName,
  );
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `${manifestName} contains version ${manifest.version}, expected ${expectedVersion}`,
    );
  }

  const references = await Promise.all(
    manifest.entries.map((entry) =>
      validateManifestEntry(
        parseUpdaterManifestEntry(entry, manifestName),
        manifestName,
        fileByName,
      ),
    ),
  );
  if (new Set(references).size !== references.length) {
    throw new Error(`${manifestName} contains duplicate updater URLs`);
  }

  const expectedSet = new Set(expectedAssets);
  const unexpected = references.filter((name) => !expectedSet.has(name));
  const missing = expectedAssets.filter((name) => !references.includes(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw new Error(
      `${manifestName} updater inventory mismatch; missing: ${missing.join(", ") || "none"}; unexpected: ${unexpected.join(", ") || "none"}`,
    );
  }
}

export async function validateCompleteRelease(
  files: readonly string[],
  validation: ElectronArtifactValidation,
): Promise<void> {
  if (!isElectronUpdateChannel(validation.channel)) {
    throw new Error(`Unsupported updater channel: ${validation.channel}`);
  }

  const names = files.map((file) => path.basename(file));
  const fileByName = new Map(
    files.map((file) => [path.basename(file), file] as const),
  );
  const asset = (description: string, suffix: string) =>
    requireSingleAsset(names, description, suffix);
  const version = validation.version;

  const windowsInstaller = asset(
    "Windows installer",
    `setup-win32-x64-${version}.exe`,
  );
  const windowsPortable = asset(
    "Windows portable executable",
    `portable-win32-x64-${version}.exe`,
  );
  const macArmDmg = asset(
    "macOS arm64 DMG",
    `setup-darwin-arm64-${version}.dmg`,
  );
  const macArmZip = asset(
    "macOS arm64 ZIP",
    `setup-darwin-arm64-${version}.zip`,
  );
  const macIntelDmg = asset("macOS x64 DMG", `setup-darwin-x64-${version}.dmg`);
  const macIntelZip = asset("macOS x64 ZIP", `setup-darwin-x64-${version}.zip`);
  const linuxDeb = asset("Linux x64 DEB", `setup-linux-x64-${version}.deb`);

  const manifestAssets = new Map<string, string[]>([
    [`${validation.channel}.yml`, [windowsInstaller]],
    [
      `${validation.channel}-mac.yml`,
      [macArmDmg, macArmZip, macIntelDmg, macIntelZip],
    ],
    [`${validation.channel}-linux.yml`, [linuxDeb]],
  ]);
  const blockmaps = [
    windowsInstaller,
    macArmDmg,
    macArmZip,
    macIntelDmg,
    macIntelZip,
  ].map((name) => `${name}.blockmap`);
  const releaseAssets = [
    windowsInstaller,
    windowsPortable,
    macArmDmg,
    macArmZip,
    macIntelDmg,
    macIntelZip,
    linuxDeb,
  ];

  assertExactInventory(
    names,
    new Set([...releaseAssets, ...blockmaps, ...manifestAssets.keys()]),
  );
  await Promise.all(
    [...manifestAssets].map(([manifestName, expectedAssets]) =>
      validateManifest(
        manifestName,
        expectedAssets,
        validation.version,
        fileByName,
      ),
    ),
  );
}
