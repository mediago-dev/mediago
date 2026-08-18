import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import type {
  DependencyManifest,
  RuntimePlatform,
} from "./dependency-layout.ts";
import {
  provisionDependencies,
  type DependencyProvisionTarget,
} from "./download-deps-provisioner.ts";

const PLATFORM: RuntimePlatform = "win32-x64";
const UNIX_PLATFORM: RuntimePlatform = "linux-x64";
const unixTest = process.platform === "win32" ? test.skip : test;

test("prepares a missing dependency once and writes binary and platform state", async () => {
  const depsRoot = createDepsRoot();
  const manifest = createManifest();
  const preparedTargets: DependencyProvisionTarget[] = [];

  await provisionDependencies({
    depsRoot,
    manifest,
    selectedToolNames: ["tool"],
    platformKeys: [PLATFORM],
    prepareCandidate: async (target, workDir) => {
      preparedTargets.push(target);
      return writeCandidate(workDir, "fresh tool");
    },
  });

  expect(preparedTargets).toHaveLength(1);
  expect(readFileSync(binaryPath(depsRoot, "tool"), "utf8")).toBe("fresh tool");
  expect(readState(depsRoot)).toEqual({
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v1",
        asset: "tool-archive",
        binaryName: "tool.exe",
      },
    },
  });
});

test("reuses a matching executable binary and complete state", async () => {
  const depsRoot = createDepsRoot();
  const contents = "cached tool";
  const manifest = createManifest({
    toolSha256: sha256(contents),
  });
  writeCachedBinary(depsRoot, "tool", contents, 0o755);
  writeState(depsRoot, {
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v1",
        asset: "tool-archive",
        binaryName: "tool.exe",
        sha256: sha256(contents),
      },
    },
  });
  let prepareCount = 0;

  await provisionDependencies({
    depsRoot,
    manifest,
    selectedToolNames: ["tool"],
    platformKeys: [PLATFORM],
    prepareCandidate: async (_target, workDir) => {
      prepareCount += 1;
      return writeCandidate(workDir, "unexpected replacement");
    },
  });

  expect(prepareCount).toBe(0);
  expect(readFileSync(binaryPath(depsRoot, "tool"), "utf8")).toBe(contents);
});

test("refreshes only the tool whose cached version is stale", async () => {
  const depsRoot = createDepsRoot();
  const manifest = createManifest({ includeHelper: true });
  writeCachedBinary(depsRoot, "tool", "stale tool", 0o755);
  writeCachedBinary(depsRoot, "helper", "cached helper", 0o755);
  writeState(depsRoot, {
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v0",
        asset: "tool-archive",
        binaryName: "tool.exe",
      },
      helper: {
        repo: "example/helper",
        version: "v1",
        asset: "helper-archive",
        binaryName: "helper.exe",
      },
    },
  });
  const preparedTools: string[] = [];

  await provisionDependencies({
    depsRoot,
    manifest,
    selectedToolNames: ["tool", "helper"],
    platformKeys: [PLATFORM],
    prepareCandidate: async (target, workDir) => {
      preparedTools.push(target.toolName);
      return writeCandidate(workDir, `fresh ${target.toolName}`);
    },
  });

  expect(preparedTools).toEqual(["tool"]);
  expect(readFileSync(binaryPath(depsRoot, "tool"), "utf8")).toBe("fresh tool");
  expect(readFileSync(binaryPath(depsRoot, "helper"), "utf8")).toBe(
    "cached helper",
  );
});

unixTest("refreshes only a non-executable Unix dependency", async () => {
  const depsRoot = createDepsRoot();
  const manifest = createManifest({ includeHelper: true });
  writeCachedBinary(
    depsRoot,
    "tool",
    "non-executable tool",
    0o644,
    UNIX_PLATFORM,
  );
  writeCachedBinary(depsRoot, "helper", "cached helper", 0o755, UNIX_PLATFORM);
  writeState(depsRoot, matchingState(true, UNIX_PLATFORM), UNIX_PLATFORM);
  const preparedTools: string[] = [];

  await provisionDependencies({
    depsRoot,
    manifest,
    selectedToolNames: ["tool", "helper"],
    platformKeys: [UNIX_PLATFORM],
    prepareCandidate: async (target, workDir) => {
      preparedTools.push(target.toolName);
      return writeCandidate(workDir, `fresh ${target.toolName}`);
    },
  });

  expect(preparedTools).toEqual(["tool"]);
  expect(
    readFileSync(binaryPath(depsRoot, "helper", UNIX_PLATFORM), "utf8"),
  ).toBe("cached helper");
});

test("preserves prior binary and state bytes when a candidate hash mismatches", async () => {
  const depsRoot = createDepsRoot();
  const manifest = createManifest({
    toolSha256: sha256("expected candidate"),
  });
  const binaryPath = writeCachedBinary(depsRoot, "tool", "prior binary", 0o755);
  const stateBytes = `${JSON.stringify(
    {
      schemaVersion: 1,
      tools: {
        tool: {
          repo: "example/tool",
          version: "v0",
          asset: "old-archive",
          binaryName: "tool.exe",
        },
      },
    },
    null,
    4,
  )}\n`;
  const statePath = writeStateBytes(depsRoot, stateBytes);

  await expect(
    provisionDependencies({
      depsRoot,
      manifest,
      selectedToolNames: ["tool"],
      platformKeys: [PLATFORM],
      prepareCandidate: async (_target, workDir) =>
        writeCandidate(workDir, "wrong candidate"),
    }),
  ).rejects.toThrow(/tool.*downloaded candidate.*SHA-256/i);

  expect(readFileSync(binaryPath, "utf8")).toBe("prior binary");
  expect(readFileSync(statePath, "utf8")).toBe(stateBytes);
  expect(
    readdirSync(path.join(depsRoot, PLATFORM)).filter((entry) =>
      entry.startsWith(".download-"),
    ),
  ).toEqual([]);
  expect(
    readdirSync(path.join(depsRoot, ".state")).filter((entry) =>
      entry.startsWith(`.${PLATFORM}-`),
    ),
  ).toEqual([]);
});

test("never reads MEDIAGO_DEPS_DIR as a provisioning root", async () => {
  const depsRoot = createDepsRoot();
  const poisonedLeaf = path.join(createDepsRoot(), "runtime-leaf");
  const previousDepsDir = process.env.MEDIAGO_DEPS_DIR;
  process.env.MEDIAGO_DEPS_DIR = poisonedLeaf;
  onTestFinished(() => {
    if (previousDepsDir === undefined) delete process.env.MEDIAGO_DEPS_DIR;
    else process.env.MEDIAGO_DEPS_DIR = previousDepsDir;
  });

  await provisionDependencies({
    depsRoot,
    manifest: createManifest(),
    selectedToolNames: ["tool"],
    platformKeys: [PLATFORM],
    prepareCandidate: async (_target, workDir) =>
      writeCandidate(workDir, "isolated tool"),
  });

  expect(existsSync(binaryPath(depsRoot, "tool"))).toBe(true);
  expect(existsSync(poisonedLeaf)).toBe(false);
});

test("rejects Unix targets on a Windows host before dependency state or file I/O", async () => {
  const depsRoot = createDepsRoot();
  let prepareCount = 0;

  await expect(
    provisionDependencies({
      depsRoot,
      manifest: createManifest(),
      selectedToolNames: ["tool"],
      platformKeys: [UNIX_PLATFORM],
      hostPlatform: "win32",
      prepareCandidate: async (_target, workDir) => {
        prepareCount += 1;
        return writeCandidate(workDir, "unexpected tool");
      },
    }),
  ).rejects.toThrow(/Windows host.*linux-x64.*native Unix host.*win32 target/i);

  expect(prepareCount).toBe(0);
  expect(readdirSync(depsRoot)).toEqual([]);
});

test("fails closed on version-state read errors before binary mutation", async () => {
  const depsRoot = createDepsRoot();
  const priorBinaryPath = writeCachedBinary(
    depsRoot,
    "tool",
    "prior binary",
    0o644,
  );
  const unreadableStatePath = path.join(depsRoot, ".state", `${PLATFORM}.json`);
  mkdirSync(unreadableStatePath, { recursive: true });
  let prepareCount = 0;

  await expect(
    provisionDependencies({
      depsRoot,
      manifest: createManifest(),
      selectedToolNames: ["tool"],
      platformKeys: [PLATFORM],
      prepareCandidate: async (_target, workDir) => {
        prepareCount += 1;
        return writeCandidate(workDir, "replacement");
      },
    }),
  ).rejects.toThrow(/Failed to read dependency version state.*win32-x64/i);

  expect(prepareCount).toBe(0);
  expect(readFileSync(priorBinaryPath, "utf8")).toBe("prior binary");
  expect(existsSync(unreadableStatePath)).toBe(true);
});

test("treats invalid JSON version state as stale", async () => {
  const depsRoot = createDepsRoot();
  writeStateBytes(depsRoot, "{not-json\n");
  let prepareCount = 0;

  await provisionDependencies({
    depsRoot,
    manifest: createManifest(),
    selectedToolNames: ["tool"],
    platformKeys: [PLATFORM],
    prepareCandidate: async (_target, workDir) => {
      prepareCount += 1;
      return writeCandidate(workDir, "fresh tool");
    },
  });

  expect(prepareCount).toBe(1);
  expect(readState(depsRoot)).toMatchObject({
    schemaVersion: 1,
    tools: { tool: { version: "v1", binaryName: "tool.exe" } },
  });
});

interface ManifestOptions {
  includeHelper?: boolean;
  toolSha256?: string;
}

function createManifest(options: ManifestOptions = {}): DependencyManifest {
  const manifest: Record<string, DependencyManifest[string]> = {
    tool: {
      repo: "example/tool",
      version: "v1",
      assets: {
        [PLATFORM]: "tool-archive",
        [UNIX_PLATFORM]: "tool-archive-unix",
      },
      binaryName: { default: "tool", win32: "tool.exe" },
      ...(options.toolSha256 === undefined
        ? {}
        : {
            sha256: {
              [PLATFORM]: options.toolSha256,
              [UNIX_PLATFORM]: options.toolSha256,
            },
          }),
    },
  };
  if (options.includeHelper) {
    manifest.helper = {
      repo: "example/helper",
      version: "v1",
      assets: {
        [PLATFORM]: "helper-archive",
        [UNIX_PLATFORM]: "helper-archive-unix",
      },
      binaryName: { default: "helper", win32: "helper.exe" },
    };
  }
  return manifest;
}

function createDepsRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "mediago-deps-provisioner-"));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeCandidate(workDir: string, contents: string): string {
  const candidatePath = path.join(workDir, "candidate");
  writeFileSync(candidatePath, contents, { mode: 0o644 });
  return candidatePath;
}

function writeCachedBinary(
  depsRoot: string,
  toolName: string,
  contents: string,
  mode: number,
  platform: RuntimePlatform = PLATFORM,
): string {
  const platformDirectory = path.join(depsRoot, platform);
  mkdirSync(platformDirectory, { recursive: true });
  const targetPath = binaryPath(depsRoot, toolName, platform);
  writeFileSync(targetPath, contents);
  chmodSync(targetPath, mode);
  return targetPath;
}

function writeState(
  depsRoot: string,
  state: unknown,
  platform: RuntimePlatform = PLATFORM,
): string {
  return writeStateBytes(
    depsRoot,
    `${JSON.stringify(state, null, 2)}\n`,
    platform,
  );
}

function writeStateBytes(
  depsRoot: string,
  contents: string,
  platform: RuntimePlatform = PLATFORM,
): string {
  const stateDirectory = path.join(depsRoot, ".state");
  mkdirSync(stateDirectory, { recursive: true });
  const statePath = path.join(stateDirectory, `${platform}.json`);
  writeFileSync(statePath, contents);
  return statePath;
}

function readState(depsRoot: string): unknown {
  return JSON.parse(
    readFileSync(path.join(depsRoot, ".state", `${PLATFORM}.json`), "utf8"),
  );
}

function matchingState(
  includeHelper = false,
  platform: RuntimePlatform = PLATFORM,
): unknown {
  const isWindows = platform.startsWith("win32-");
  return {
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v1",
        asset: isWindows ? "tool-archive" : "tool-archive-unix",
        binaryName: isWindows ? "tool.exe" : "tool",
      },
      ...(includeHelper
        ? {
            helper: {
              repo: "example/helper",
              version: "v1",
              asset: isWindows ? "helper-archive" : "helper-archive-unix",
              binaryName: isWindows ? "helper.exe" : "helper",
            },
          }
        : {}),
    },
  };
}

function binaryPath(
  depsRoot: string,
  toolName: string,
  platform: RuntimePlatform = PLATFORM,
): string {
  const executableName = platform.startsWith("win32-")
    ? `${toolName}.exe`
    : toolName;
  return path.join(depsRoot, platform, executableName);
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
