import type { ParsedSemVer, ReleaseChannel } from "./contracts.ts";
import {
  compareSemVer,
  hasSameSemVerCore,
  isNumericIdentifier,
  parseSemVer,
} from "./semver.ts";

export interface ParsedVersionTag {
  name: string;
  version: ParsedSemVer;
}

function parseVersionTag(tag: string): ParsedVersionTag | null {
  const trimmed = tag.trim();
  const candidate = trimmed.startsWith("v") ? trimmed.slice(1) : trimmed;
  if (!/^\d/.test(candidate)) return null;
  try {
    return { name: trimmed, version: parseSemVer(candidate) };
  } catch {
    return null;
  }
}

export function parseVersionTags(tags: readonly string[]): ParsedVersionTag[] {
  return tags
    .map(parseVersionTag)
    .filter((tag): tag is ParsedVersionTag => tag !== null);
}

export function findHighestTag(
  tags: readonly ParsedVersionTag[],
  predicate: (tag: ParsedVersionTag) => boolean = () => true,
): ParsedVersionTag | null {
  let highest: ParsedVersionTag | null = null;
  for (const tag of tags) {
    if (!predicate(tag)) continue;
    if (highest === null || compareSemVer(tag.version, highest.version) > 0) {
      highest = tag;
    }
  }
  return highest;
}

export function nextPrereleaseNumber(
  tags: readonly ParsedVersionTag[],
  core: ParsedSemVer,
  channel: Exclude<ReleaseChannel, "latest">,
): number {
  let highest = -1;
  for (const tag of tags) {
    const prerelease = tag.version.prerelease;
    if (!hasSameSemVerCore(tag.version, core) || prerelease[0] !== channel) {
      continue;
    }
    if (prerelease.length !== 2 || !isNumericIdentifier(prerelease[1])) {
      throw new Error(
        `Unsupported ${channel} tag format: ${tag.name}; expected ${channel}.N`,
      );
    }
    const value = Number(prerelease[1]);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`Prerelease number is too large in tag ${tag.name}`);
    }
    highest = Math.max(highest, value);
  }
  const next = highest + 1;
  if (!Number.isSafeInteger(next)) {
    throw new Error(
      "Calculated prerelease number exceeds the safe integer range",
    );
  }
  return next;
}

export function assertTagAvailable(
  version: string,
  tags: readonly string[],
): void {
  const candidate = parseSemVer(version);
  for (const tag of parseVersionTags(tags)) {
    if (compareSemVer(candidate, tag.version) === 0) {
      throw new Error(
        `Version ${version} conflicts with existing tag ${tag.name}`,
      );
    }
  }
}
