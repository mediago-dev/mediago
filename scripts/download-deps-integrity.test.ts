import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import {
  assertDependencyFileIntegrity,
  dependencyFileMatchesIntegrity,
  inspectDependencyFileIntegrity,
  resolveDependencySha256,
  sha256File,
} from "./download-deps-integrity.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const provisioner = readFileSync(
  path.join(repositoryRoot, "scripts/download-deps-provisioner.ts"),
  "utf8",
);
const downloadCli = readFileSync(
  path.join(repositoryRoot, "scripts/download-deps.ts"),
  "utf8",
);
const integritySource = readFileSync(
  path.join(repositoryRoot, "scripts/download-deps-integrity.ts"),
  "utf8",
);
const depsVersions = JSON.parse(
  readFileSync(path.join(repositoryRoot, "scripts/deps-versions.json"), "utf8"),
) as Record<
  string,
  {
    assets?: Record<string, string>;
    repo?: string;
    sha256?: Record<string, string>;
    version?: string;
  }
>;
const OFFICIAL_ARIA2_LINUX_X64_SHA256 =
  "b6f2cdadcd34ba16dd7fcb29de4b84c36f893f9b223a9a05157d1892687a45a0";
const unixTest = process.platform === "win32" ? test.skip : test;

test("pins exactly one lowercase SHA-256 for every release asset", () => {
  for (const [toolName, tool] of Object.entries(depsVersions)) {
    const assetKeys = Object.keys(tool.assets ?? {}).toSorted();
    const checksumKeys = Object.keys(tool.sha256 ?? {}).toSorted();

    expect(checksumKeys, `${toolName} checksum keys`).toEqual(assetKeys);
    for (const platformKey of assetKeys) {
      expect(
        tool.sha256?.[platformKey],
        `${toolName} ${platformKey} checksum`,
      ).toMatch(/^[a-f0-9]{64}$/);
    }
  }
});

test("pins the official linux-x64 aria2 binary SHA-256", () => {
  expect(depsVersions.aria2).toMatchObject({
    repo: "AnInsomniacy/aria2-next",
    version: "v2.5.5",
    assets: {
      "linux-x64": "aria2-next-2.5.5-linux-x86_64",
    },
    sha256: {
      "linux-x64": OFFICIAL_ARIA2_LINUX_X64_SHA256,
    },
  });
});

test("rejects restored files whose SHA-256 does not match", async () => {
  const fixture = createFixture("hello");

  expect(await sha256File(fixture)).toBe(
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  expect(
    await dependencyFileMatchesIntegrity(
      fixture,
      OFFICIAL_ARIA2_LINUX_X64_SHA256,
    ),
  ).toBe(false);
  await expect(
    inspectDependencyFileIntegrity(fixture, OFFICIAL_ARIA2_LINUX_X64_SHA256),
  ).resolves.toBe("corrupt");
});

test("distinguishes a missing final file from corrupt content", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "mediago-deps-missing-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));

  await expect(
    inspectDependencyFileIntegrity(path.join(directory, "missing")),
  ).resolves.toBe("missing");
});

test("fails closed for downloaded candidate mismatches", async () => {
  const fixture = createFixture("hello");

  await expect(
    assertDependencyFileIntegrity(
      fixture,
      OFFICIAL_ARIA2_LINUX_X64_SHA256,
      "downloaded aria2 binary",
    ),
  ).rejects.toThrow(/downloaded aria2 binary.*SHA-256/i);
});

test("fails closed without a checksum for every release runtime asset", () => {
  for (const [toolName, tool] of Object.entries(depsVersions)) {
    for (const platformKey of Object.keys(tool.assets ?? {})) {
      expect(
        () => resolveDependencySha256(toolName, platformKey, undefined),
        `${toolName} ${platformKey}`,
      ).toThrow(/SHA-256/i);
    }
  }
});

test("derives required checksum tools from the dependency layout", () => {
  expect(integritySource).toContain(
    'import { isDependencyToolName } from "./dependency-layout.ts";',
  );
  expect(integritySource).not.toContain("RELEASE_RUNTIME_TOOLS");
});

test("keeps checksum-optional custom fixtures compatible", async () => {
  const fixture = createFixture("legacy tool");

  expect(await dependencyFileMatchesIntegrity(fixture)).toBe(true);
  expect(
    resolveDependencySha256("fixture-tool", "linux-x64", undefined),
  ).toBeUndefined();
});

unixTest("rejects a non-executable Unix dependency", async () => {
  const fixture = createFixture("unix tool", 0o644);

  expect(
    await dependencyFileMatchesIntegrity(fixture, undefined, {
      requireExecutable: true,
    }),
  ).toBe(false);
  await expect(
    inspectDependencyFileIntegrity(fixture, undefined, {
      requireExecutable: true,
    }),
  ).resolves.toBe("not-executable");
  await expect(
    assertDependencyFileIntegrity(fixture, undefined, "cached Unix tool", {
      requireExecutable: true,
    }),
  ).rejects.toThrow(/cached Unix tool.*executable/i);
});

unixTest("accepts an executable Unix dependency", async () => {
  const fixture = createFixture("unix tool", 0o755);

  expect(
    await dependencyFileMatchesIntegrity(fixture, undefined, {
      requireExecutable: true,
    }),
  ).toBe(true);
});

test("does not apply POSIX execute-bit validation to a Windows target", async () => {
  const fixture = createFixture("windows tool", 0o644);

  expect(
    await dependencyFileMatchesIntegrity(fixture, undefined, {
      requireExecutable: false,
    }),
  ).toBe(true);
});

test("verifies cached and downloaded binaries before reuse or state writes", () => {
  const cachedVerification = provisioner.indexOf(
    "dependencyFileMatchesIntegrity(",
  );
  const cachedReuse = provisioner.search(/if\s*\(\s*binaryIsUsable\s*&&/);
  const candidateVerification = provisioner.indexOf(
    "assertDependencyFileIntegrity(",
  );
  const replaceBinary = provisioner.indexOf(
    "await rename(candidateFile, target.executablePath)",
  );
  const writeState = provisioner.indexOf("await saveVersionManifest(");

  expect(cachedVerification).toBeGreaterThan(-1);
  expect(cachedReuse).toBeGreaterThan(cachedVerification);
  expect(candidateVerification).toBeGreaterThan(cachedReuse);
  expect(replaceBinary).toBeGreaterThan(candidateVerification);
  expect(writeState).toBeGreaterThan(replaceBinary);
});

test("passes the real candidate preparer into the isolated provisioner", () => {
  expect(downloadCli).toMatch(
    /provisionDependencies\(\{[\s\S]*?prepareCandidate,[\s\S]*?\}\)/,
  );
});

function createFixture(contents: string, mode?: number): string {
  const directory = mkdtempSync(path.join(tmpdir(), "mediago-deps-integrity-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "dependency");
  writeFileSync(fixture, contents, mode === undefined ? undefined : { mode });
  return fixture;
}
