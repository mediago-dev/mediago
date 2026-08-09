import type {
  ParsedSemVer,
  ReleaseChannel,
  ReleasePlan,
  ReleasePlanInput,
  VersionIncrement,
} from "./contracts.ts";
import {
  compareSemVer,
  formatSemVer,
  isNumericIdentifier,
  parseSemVer,
} from "./semver.ts";
import {
  assertTagAvailable,
  findHighestTag,
  nextPrereleaseNumber,
  parseVersionTags,
} from "./tags.ts";

function bumpCore(
  base: ParsedSemVer,
  increment: VersionIncrement,
): ParsedSemVer {
  const next = {
    major: base.major,
    minor: base.minor,
    patch: base.patch,
    prerelease: [],
    build: [],
  } satisfies ParsedSemVer;

  if (increment === "major") {
    next.major += 1;
    next.minor = 0;
    next.patch = 0;
  } else if (increment === "minor") {
    next.minor += 1;
    next.patch = 0;
  } else {
    next.patch += 1;
  }
  if (![next.major, next.minor, next.patch].every(Number.isSafeInteger)) {
    throw new Error("Calculated version exceeds the safe integer range");
  }
  return next;
}

export function validateChannelVersion(
  version: ParsedSemVer,
  channel: ReleaseChannel,
): void {
  if (channel === "latest") {
    if (version.prerelease.length !== 0) {
      throw new Error(
        `Pending version ${formatSemVer(version)} does not match channel latest`,
      );
    }
    return;
  }

  if (
    version.prerelease.length !== 2 ||
    version.prerelease[0] !== channel ||
    !isNumericIdentifier(version.prerelease[1])
  ) {
    throw new Error(
      `Pending version ${formatSemVer(version)} must use ${channel}.N`,
    );
  }
  if (!Number.isSafeInteger(Number(version.prerelease[1]))) {
    throw new Error(
      `Prerelease number exceeds the safe integer range: ${formatSemVer(version)}`,
    );
  }
}

export function planRelease(input: ReleasePlanInput): ReleasePlan {
  const current = parseSemVer(input.currentVersion);
  const currentVersion = formatSemVer(current);
  const parsedTags = parseVersionTags(input.tags);
  const highestTag = findHighestTag(parsedTags);
  const latestStableTag = findHighestTag(
    parsedTags,
    (tag) => tag.version.prerelease.length === 0,
  );

  if (highestTag !== null && compareSemVer(current, highestTag.version) < 0) {
    throw new Error(
      `Product version ${currentVersion} is behind highest tag ${highestTag.name}`,
    );
  }

  const currentTag = parsedTags.find(
    (tag) => compareSemVer(current, tag.version) === 0,
  );
  if (currentTag === undefined) {
    if (
      highestTag !== null &&
      compareSemVer(current, highestTag.version) <= 0
    ) {
      throw new Error(
        `Product version ${currentVersion} is not uniquely ahead of existing tags`,
      );
    }
    validateChannelVersion(current, input.channel);
    assertTagAvailable(currentVersion, input.tags);
    return {
      currentVersion,
      version: currentVersion,
      tag: `v${currentVersion}`,
      baseVersion:
        latestStableTag === null ? null : formatSemVer(latestStableTag.version),
      changed: false,
      pending: true,
    };
  }

  if (latestStableTag === null) {
    throw new Error(
      "No stable SemVer tag found; set the initial product version before releasing",
    );
  }

  let candidate: ParsedSemVer;
  if (current.prerelease.length > 0) {
    const [currentChannel, currentNumber] = current.prerelease;
    if (
      current.prerelease.length !== 2 ||
      (currentChannel !== "alpha" && currentChannel !== "beta") ||
      !isNumericIdentifier(currentNumber)
    ) {
      throw new Error(
        `Unsupported current prerelease ${currentVersion}; expected alpha.N or beta.N`,
      );
    }

    const continuesCurrentCore =
      input.channel === "latest" ||
      input.channel === currentChannel ||
      (currentChannel === "alpha" && input.channel === "beta");
    candidate = continuesCurrentCore
      ? { ...current, prerelease: [], build: [] }
      : bumpCore(latestStableTag.version, input.increment);
  } else {
    candidate = bumpCore(latestStableTag.version, input.increment);
  }

  if (input.channel !== "latest") {
    candidate.prerelease = [
      input.channel,
      String(nextPrereleaseNumber(parsedTags, candidate, input.channel)),
    ];
  }
  const version = formatSemVer(candidate);
  assertTagAvailable(version, input.tags);
  if (
    highestTag !== null &&
    compareSemVer(candidate, highestTag.version) <= 0
  ) {
    throw new Error(
      `Calculated version ${version} is not newer than highest tag ${highestTag.name}`,
    );
  }
  return {
    currentVersion,
    version,
    tag: `v${version}`,
    baseVersion: formatSemVer(latestStableTag.version),
    changed: version !== currentVersion,
    pending: false,
  };
}

export function planTestRelease(
  currentVersion: string,
  runNumber: string | undefined,
): ReleasePlan {
  if (!runNumber || !/^[1-9]\d*$/.test(runNumber)) {
    throw new Error(
      "Test mode requires --run-number (or GITHUB_RUN_NUMBER) as a positive integer",
    );
  }
  const current = parseSemVer(currentVersion);
  const core = `${current.major}.${current.minor}.${current.patch}`;
  const version = `${core}-test.${runNumber}`;
  return {
    currentVersion,
    version,
    tag: `v${version}`,
    baseVersion: core,
    changed: false,
    pending: false,
  };
}

export function planResumedRelease(
  currentVersion: string,
  channel: ReleaseChannel,
): ReleasePlan {
  const current = parseSemVer(currentVersion);
  validateChannelVersion(current, channel);
  return {
    currentVersion,
    version: currentVersion,
    tag: `v${currentVersion}`,
    baseVersion: `${current.major}.${current.minor}.${current.patch}`,
    changed: false,
    pending: true,
  };
}
