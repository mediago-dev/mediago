import path from "node:path";

export interface RawUpdaterManifestEntry {
  lines: string[];
}

export interface UpdaterManifestEntry extends RawUpdaterManifestEntry {
  url: string;
  sha512Value: string;
  sizeValue?: string;
  blockMapSizeValue?: string;
}

export interface UpdaterManifest {
  source: string;
  version: string;
  beforeFiles: string[];
  entries: RawUpdaterManifestEntry[];
  afterFiles: string[];
}

export function parseYamlScalar(value: string, source: string): string {
  const scalar = value.trim();
  if (scalar.startsWith("'")) {
    if (!scalar.endsWith("'")) {
      throw new Error(`${source} contains an invalid quoted YAML value`);
    }
    return scalar.slice(1, -1).replaceAll("''", "'");
  }
  if (scalar.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(scalar);
      if (typeof parsed !== "string") throw new Error();
      return parsed;
    } catch {
      throw new Error(`${source} contains an invalid quoted YAML value`);
    }
  }
  return scalar;
}

function entryValue(
  lines: readonly string[],
  key: "blockMapSize" | "sha512" | "size" | "url",
): string | undefined {
  const prefix =
    key === "url"
      ? new RegExp(`^\\s+-\\s+${key}:\\s*`)
      : new RegExp(`^\\s+${key}:\\s*`);
  return lines.find((line) => prefix.test(line))?.replace(prefix, "");
}

export function parseUpdaterManifestEntry(
  entry: RawUpdaterManifestEntry,
  source: string,
): UpdaterManifestEntry {
  const url = entryValue(entry.lines, "url");
  const sha512Value = entryValue(entry.lines, "sha512");
  if (!url || !sha512Value) {
    throw new Error(`${source} updater entries require url and sha512`);
  }

  return {
    ...entry,
    url: parseYamlScalar(url, source),
    sha512Value,
    sizeValue: entryValue(entry.lines, "size"),
    blockMapSizeValue: entryValue(entry.lines, "blockMapSize"),
  };
}

function manifestVersion(lines: readonly string[], source: string): string {
  const versionLine = lines.find((line) => /^version:\s*/.test(line));
  const versionValue = versionLine?.replace(/^version:\s*/, "");
  if (!versionValue) {
    throw new Error(`${source} does not contain a version`);
  }
  return parseYamlScalar(versionValue, source);
}

export function parseUpdaterManifest(
  content: string,
  source: string,
): UpdaterManifest {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const filesIndex = lines.findIndex((line) => /^files:\s*$/.test(line));
  if (filesIndex === -1) {
    throw new Error(`${source} does not contain a top-level files section`);
  }

  let filesEnd = lines.length;
  for (let index = filesIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() !== "" && !/^\s/.test(line)) {
      filesEnd = index;
      break;
    }
  }

  const rawEntries: string[][] = [];
  let currentEntry: string[] | undefined;
  for (const line of lines.slice(filesIndex + 1, filesEnd)) {
    if (/^\s+-\s/.test(line)) {
      currentEntry = [line];
      rawEntries.push(currentEntry);
    } else if (currentEntry) {
      currentEntry.push(line);
    } else if (line.trim() !== "") {
      throw new Error(`${source} has an unsupported files section`);
    }
  }
  if (rawEntries.length === 0) {
    throw new Error(`${source} has no updater file entries`);
  }

  const beforeFiles = lines.slice(0, filesIndex + 1);
  return {
    source,
    version: manifestVersion(beforeFiles, source),
    beforeFiles,
    entries: rawEntries.map((entryLines) => ({ lines: entryLines })),
    afterFiles: lines.slice(filesEnd),
  };
}

export function mergeMacManifests(
  manifests: Array<{ source: string; content: string }>,
): string {
  const parsed = manifests.map(({ source, content }) =>
    parseUpdaterManifest(content, source),
  );
  const expectedVersion = parsed[0].version;
  for (const manifest of parsed.slice(1)) {
    if (manifest.version !== expectedVersion) {
      throw new Error(
        `Cannot merge macOS updater manifests for ${expectedVersion} and ${manifest.version}`,
      );
    }
  }

  const uniqueEntries = new Map<string, RawUpdaterManifestEntry>();
  for (const manifest of parsed) {
    for (const rawEntry of manifest.entries) {
      const entry = parseUpdaterManifestEntry(rawEntry, manifest.source);
      const existing = uniqueEntries.get(entry.url);
      if (existing && existing.lines.join("\n") !== entry.lines.join("\n")) {
        throw new Error(`Conflicting macOS updater entries for ${entry.url}`);
      }
      uniqueEntries.set(entry.url, rawEntry);
    }
  }

  const base = parsed[0];
  return [
    ...base.beforeFiles,
    ...[...uniqueEntries.values()].flatMap((entry) => entry.lines),
    ...base.afterFiles,
  ].join("\n");
}

export function releaseAssetName(url: string, source: string): string {
  const pathPart = url.split(/[?#]/, 1)[0];
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathPart);
  } catch {
    throw new Error(`${source} contains an invalid encoded URL: ${url}`);
  }
  if (
    decoded.length === 0 ||
    decoded.includes("\\") ||
    path.posix.basename(decoded) !== decoded
  ) {
    throw new Error(
      `${source} updater URL must be a release asset filename: ${url}`,
    );
  }
  return decoded;
}
