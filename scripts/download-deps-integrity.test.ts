import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, onTestFinished, test } from "vitest";
import {
  assertDependencyFileIntegrity,
  dependencyFileMatchesIntegrity,
  resolveDependencySha256,
  sha256File,
} from "./download-deps-integrity.ts";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const provisioner = readFileSync(
  path.join(repositoryRoot, "scripts/download-deps.ts"),
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

test("keeps unconfigured platforms compatible but requires the E2E checksum", async () => {
  const fixture = createFixture("legacy tool");

  expect(await dependencyFileMatchesIntegrity(fixture)).toBe(true);
  expect(
    resolveDependencySha256("ffmpeg", "darwin-arm64", undefined),
  ).toBeUndefined();
  expect(() =>
    resolveDependencySha256("aria2", "linux-x64", undefined),
  ).toThrow(/aria2.*linux-x64.*SHA-256/i);
});

test("verifies cached and downloaded binaries before reuse or state writes", () => {
  const downloadTool = provisioner.match(
    /async function downloadTool\([\s\S]*?(?=^async function findBinaryInDir)/m,
  )?.[0];
  expect(downloadTool).toBeDefined();
  if (downloadTool === undefined) return;

  const cachedVerification = downloadTool.search(
    /dependencyFileMatchesIntegrity\(\s*binaryPath,\s*expectedSha256,?\s*\)/,
  );
  const cachedReuse = downloadTool.indexOf("already exists for");
  const candidateVerification = downloadTool.indexOf(
    "assertDependencyFileIntegrity(",
  );
  const replaceBinary = downloadTool.indexOf(
    "await rename(candidateFile, binaryPath)",
  );
  const writeState = downloadTool.indexOf(
    "await saveVersionManifest(platformKey, updatedVersionManifest)",
  );

  expect(cachedVerification).toBeGreaterThan(-1);
  expect(cachedReuse).toBeGreaterThan(cachedVerification);
  expect(candidateVerification).toBeGreaterThan(cachedReuse);
  expect(replaceBinary).toBeGreaterThan(candidateVerification);
  expect(writeState).toBeGreaterThan(replaceBinary);
});

function createFixture(contents: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), "mediago-deps-integrity-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  const fixture = path.join(directory, "dependency");
  writeFileSync(fixture, contents);
  return fixture;
}
