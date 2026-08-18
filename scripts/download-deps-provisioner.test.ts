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

const PLATFORM: RuntimePlatform = "linux-x64";

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
  expect(readFileSync(path.join(depsRoot, PLATFORM, "tool"), "utf8")).toBe(
    "fresh tool",
  );
  expect(readState(depsRoot)).toEqual({
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v1",
        asset: "tool-archive",
        binaryName: "tool",
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
        binaryName: "tool",
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
  expect(readFileSync(path.join(depsRoot, PLATFORM, "tool"), "utf8")).toBe(
    contents,
  );
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
        binaryName: "tool",
      },
      helper: {
        repo: "example/helper",
        version: "v1",
        asset: "helper-archive",
        binaryName: "helper",
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
  expect(readFileSync(path.join(depsRoot, PLATFORM, "tool"), "utf8")).toBe(
    "fresh tool",
  );
  expect(readFileSync(path.join(depsRoot, PLATFORM, "helper"), "utf8")).toBe(
    "cached helper",
  );
});

test("refreshes only a non-executable Unix dependency", async () => {
  const depsRoot = createDepsRoot();
  const manifest = createManifest({ includeHelper: true });
  writeCachedBinary(depsRoot, "tool", "non-executable tool", 0o644);
  writeCachedBinary(depsRoot, "helper", "cached helper", 0o755);
  writeState(depsRoot, matchingState(true));
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
  expect(readFileSync(path.join(depsRoot, PLATFORM, "helper"), "utf8")).toBe(
    "cached helper",
  );
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
          binaryName: "tool",
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

  expect(existsSync(path.join(depsRoot, PLATFORM, "tool"))).toBe(true);
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
      platformKeys: [PLATFORM],
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

interface ManifestOptions {
  includeHelper?: boolean;
  toolSha256?: string;
}

function createManifest(options: ManifestOptions = {}): DependencyManifest {
  const manifest: Record<string, DependencyManifest[string]> = {
    tool: {
      repo: "example/tool",
      version: "v1",
      assets: { [PLATFORM]: "tool-archive" },
      binaryName: { default: "tool", win32: "tool.exe" },
      ...(options.toolSha256 === undefined
        ? {}
        : { sha256: { [PLATFORM]: options.toolSha256 } }),
    },
  };
  if (options.includeHelper) {
    manifest.helper = {
      repo: "example/helper",
      version: "v1",
      assets: { [PLATFORM]: "helper-archive" },
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
): string {
  const platformDirectory = path.join(depsRoot, PLATFORM);
  mkdirSync(platformDirectory, { recursive: true });
  const binaryPath = path.join(platformDirectory, toolName);
  writeFileSync(binaryPath, contents);
  chmodSync(binaryPath, mode);
  return binaryPath;
}

function writeState(depsRoot: string, state: unknown): string {
  return writeStateBytes(depsRoot, `${JSON.stringify(state, null, 2)}\n`);
}

function writeStateBytes(depsRoot: string, contents: string): string {
  const stateDirectory = path.join(depsRoot, ".state");
  mkdirSync(stateDirectory, { recursive: true });
  const statePath = path.join(stateDirectory, `${PLATFORM}.json`);
  writeFileSync(statePath, contents);
  return statePath;
}

function readState(depsRoot: string): unknown {
  return JSON.parse(
    readFileSync(path.join(depsRoot, ".state", `${PLATFORM}.json`), "utf8"),
  );
}

function matchingState(includeHelper = false): unknown {
  return {
    schemaVersion: 1,
    tools: {
      tool: {
        repo: "example/tool",
        version: "v1",
        asset: "tool-archive",
        binaryName: "tool",
      },
      ...(includeHelper
        ? {
            helper: {
              repo: "example/helper",
              version: "v1",
              asset: "helper-archive",
              binaryName: "helper",
            },
          }
        : {}),
    },
  };
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}
