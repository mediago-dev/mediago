export const RELEASE_MODES = ["test", "release"] as const;
export const RELEASE_CHANNELS = ["alpha", "beta", "latest"] as const;
export const VERSION_INCREMENTS = ["patch", "minor", "major"] as const;

export type ReleaseMode = (typeof RELEASE_MODES)[number];
export type ReleaseChannel = (typeof RELEASE_CHANNELS)[number];
export type VersionIncrement = (typeof VERSION_INCREMENTS)[number];

export interface ParsedSemVer {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
  build: string[];
}

export interface ReleasePlanInput {
  currentVersion: string;
  tags: readonly string[];
  channel: ReleaseChannel;
  increment: VersionIncrement;
}

export interface ReleasePlan {
  currentVersion: string;
  version: string;
  tag: string;
  baseVersion: string | null;
  changed: boolean;
  pending: boolean;
}

export interface ExecuteReleaseVersionOptions {
  mode: ReleaseMode;
  channel: ReleaseChannel;
  increment: VersionIncrement;
  resumeCurrent?: boolean;
  runNumber?: string;
  workspaceRoot?: string;
  githubOutput?: string;
  tags?: readonly string[];
}

export interface ReleaseVersionResult extends ReleasePlan {
  mode: ReleaseMode;
  channel: ReleaseChannel;
  increment: VersionIncrement;
  written: boolean;
  outputs: Record<string, string>;
}
