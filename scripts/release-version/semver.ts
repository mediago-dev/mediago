import type { ParsedSemVer } from "./contracts.ts";

const CORE_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const IDENTIFIER_PATTERN = /^[0-9A-Za-z-]+$/;
const NUMERIC_IDENTIFIER_PATTERN = /^\d+$/;

export function parseSemVer(value: string): ParsedSemVer {
  if (value.trim() !== value || value.length === 0) {
    throw new Error(`Invalid SemVer: ${JSON.stringify(value)}`);
  }

  const plusIndex = value.indexOf("+");
  if (plusIndex !== -1 && value.indexOf("+", plusIndex + 1) !== -1) {
    throw new Error(`Invalid SemVer: ${value}`);
  }

  const withoutBuild = plusIndex === -1 ? value : value.slice(0, plusIndex);
  const buildPart = plusIndex === -1 ? "" : value.slice(plusIndex + 1);
  if (plusIndex !== -1 && buildPart === "") {
    throw new Error(`Invalid SemVer: ${value}`);
  }

  const dashIndex = withoutBuild.indexOf("-");
  const corePart =
    dashIndex === -1 ? withoutBuild : withoutBuild.slice(0, dashIndex);
  const prereleasePart =
    dashIndex === -1 ? "" : withoutBuild.slice(dashIndex + 1);
  if (dashIndex !== -1 && prereleasePart === "") {
    throw new Error(`Invalid SemVer: ${value}`);
  }

  const coreMatch = CORE_PATTERN.exec(corePart);
  if (!coreMatch) throw new Error(`Invalid SemVer: ${value}`);

  const major = Number(coreMatch[1]);
  const minor = Number(coreMatch[2]);
  const patch = Number(coreMatch[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) {
    throw new Error(`SemVer core exceeds the safe integer range: ${value}`);
  }

  return {
    major,
    minor,
    patch,
    prerelease: parseIdentifiers(prereleasePart, true, value),
    build: parseIdentifiers(buildPart, false, value),
  };
}

function parseIdentifiers(
  value: string,
  rejectNumericLeadingZero: boolean,
  fullVersion: string,
): string[] {
  if (value === "") return [];

  const identifiers = value.split(".");
  for (const identifier of identifiers) {
    if (!IDENTIFIER_PATTERN.test(identifier)) {
      throw new Error(`Invalid SemVer identifier in ${fullVersion}`);
    }
    if (
      rejectNumericLeadingZero &&
      NUMERIC_IDENTIFIER_PATTERN.test(identifier) &&
      identifier.length > 1 &&
      identifier.startsWith("0")
    ) {
      throw new Error(
        `Numeric prerelease identifiers cannot have leading zeroes: ${fullVersion}`,
      );
    }
  }
  return identifiers;
}

export function formatSemVer(version: ParsedSemVer): string {
  let result = `${version.major}.${version.minor}.${version.patch}`;
  if (version.prerelease.length > 0) {
    result += `-${version.prerelease.join(".")}`;
  }
  if (version.build.length > 0) result += `+${version.build.join(".")}`;
  return result;
}

export function compareSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  const coreResult = compareSemVerCore(left, right);
  if (coreResult !== 0) return coreResult;
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;

  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;
    if (leftIdentifier === rightIdentifier) continue;

    const leftNumeric = NUMERIC_IDENTIFIER_PATTERN.test(leftIdentifier);
    const rightNumeric = NUMERIC_IDENTIFIER_PATTERN.test(rightIdentifier);
    if (leftNumeric && rightNumeric) {
      return BigInt(leftIdentifier) < BigInt(rightIdentifier) ? -1 : 1;
    }
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return leftIdentifier < rightIdentifier ? -1 : 1;
  }
  return 0;
}

export function compareSemVerCore(
  left: ParsedSemVer,
  right: ParsedSemVer,
): number {
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  return 0;
}

export function hasSameSemVerCore(
  left: ParsedSemVer,
  right: ParsedSemVer,
): boolean {
  return compareSemVerCore(left, right) === 0;
}

export function isNumericIdentifier(value: string): boolean {
  return NUMERIC_IDENTIFIER_PATTERN.test(value);
}
