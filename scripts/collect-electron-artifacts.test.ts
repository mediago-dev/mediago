import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { collectElectronArtifacts } from "./collect-electron-artifacts.ts";

type ManifestEntry = {
  url: string;
  sha512: string;
  size: number;
  blockMapSize?: number;
};

test("collects and validates a complete cross-platform release", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "mediago-electron-artifacts-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const output = path.join(root, "output");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "stale.txt"), "stale");
  await writeFile(
    path.join(release.windows, "builder-effective-config.yaml"),
    "ignored",
  );

  const files = await collectElectronArtifacts(input, output, {
    version: "3.6.0",
    channel: "latest",
  });
  assert.equal(files.length, 15);
  const names = files.map((file) => path.basename(file));
  assert.deepEqual(
    names,
    names.toSorted((left, right) => left.localeCompare(right)),
  );
  assert.ok(!names.some((name) => name.startsWith("builder-")));
  await assert.rejects(readFile(path.join(output, "stale.txt")), {
    code: "ENOENT",
  });

  const merged = await readFile(path.join(output, "latest-mac.yml"), "utf8");
  assert.match(
    merged,
    /url: mediago-community-setup-darwin-arm64-3\.6\.0\.dmg/,
  );
  assert.match(
    merged,
    /url: mediago-community-setup-darwin-arm64-3\.6\.0\.zip/,
  );
  assert.match(merged, /url: mediago-community-setup-darwin-x64-3\.6\.0\.dmg/);
  assert.match(merged, /url: mediago-community-setup-darwin-x64-3\.6\.0\.zip/);
});

test("rejects an incomplete platform inventory", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0-beta.1", "beta");
  await rm(path.join(release.intel, `${release.macIntelZip}.blockmap`));

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0-beta.1",
      channel: "beta",
    }),
    /Electron release inventory mismatch/,
  );
});

test("rejects incorrect updater hashes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-hash-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await writeFile(
    path.join(release.linux, "latest-linux.yml"),
    manifest([{ ...release.linuxEntry, sha512: "incorrect" }], "3.6.0"),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /wrong sha512/,
  );
});

test("rejects updater manifests for another version", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-version-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await writeFile(
    path.join(release.windows, "latest.yml"),
    manifest([release.windowsEntry], "3.6.1"),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /contains version 3\.6\.1, expected 3\.6\.0/,
  );
});

test("rejects conflicting non-manifest filenames", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-conflict-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = path.join(root, "input", "first");
  const second = path.join(root, "input", "second");
  await mkdir(first, { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(path.join(first, "mediago.exe"), "first");
  await writeFile(path.join(second, "mediago.exe"), "second");

  await assert.rejects(
    collectElectronArtifacts(
      path.join(root, "input"),
      path.join(root, "output"),
    ),
    /Conflicting Electron release files/,
  );
});

test("deduplicates identical non-manifest filenames", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "mediago-electron-duplicate-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = path.join(root, "input", "first");
  const second = path.join(root, "input", "second");
  await Promise.all(
    [first, second].map((directory) => mkdir(directory, { recursive: true })),
  );
  await Promise.all(
    [first, second].map((directory) =>
      writeFile(path.join(directory, "mediago.exe"), "same"),
    ),
  );

  const output = path.join(root, "output");
  const files = await collectElectronArtifacts(
    path.join(root, "input"),
    output,
  );
  assert.deepEqual(files, [path.join(output, "mediago.exe")]);
  assert.equal(await readFile(files[0], "utf8"), "same");
});

test("defers optional manifest validation when no contract is requested", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "mediago-electron-unvalidated-manifest-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const first = path.join(input, "first");
  const second = path.join(input, "second");
  await Promise.all(
    [first, second].map((directory) => mkdir(directory, { recursive: true })),
  );
  await Promise.all([
    writeFile(path.join(first, "latest-mac.yml"), looseManifest("arm.zip")),
    writeFile(path.join(second, "latest-mac.yml"), looseManifest("x64.zip")),
  ]);

  const output = path.join(root, "output");
  const files = await collectElectronArtifacts(input, output);
  assert.deepEqual(files, [path.join(output, "latest-mac.yml")]);
  const merged = await readFile(files[0], "utf8");
  assert.match(merged, /url: arm\.zip/);
  assert.match(merged, /url: x64\.zip/);
});

test("rejects macOS manifests for different versions", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "mediago-electron-mac-version-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await writeFile(
    path.join(release.intel, "latest-mac.yml"),
    manifest(release.intelEntries, "3.6.1"),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /Cannot merge macOS updater manifests for 3\.6\.0 and 3\.6\.1/,
  );
});

test("rejects conflicting macOS entries with the same URL", async (t) => {
  const root = await mkdtemp(
    path.join(tmpdir(), "mediago-electron-mac-conflict-"),
  );
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  const conflict = { ...release.armEntries[0], sha512: "different" };
  await writeFile(
    path.join(release.intel, "latest-mac.yml"),
    manifest([conflict, ...release.intelEntries], "3.6.0"),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /Conflicting macOS updater entries/,
  );
});

test("rejects updater URLs that are not release filenames", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-url-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await writeFile(
    path.join(release.linux, "latest-linux.yml"),
    manifest(
      [{ ...release.linuxEntry, url: `nested/${release.linuxEntry.url}` }],
      "3.6.0",
    ),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /updater URL must be a release asset filename/,
  );
});

test("rejects incorrect declared asset sizes", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-electron-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const input = path.join(root, "input");
  const release = await createCompleteRelease(input, "3.6.0", "latest");
  await writeFile(
    path.join(release.linux, "latest-linux.yml"),
    manifest(
      [{ ...release.linuxEntry, size: release.linuxEntry.size + 1 }],
      "3.6.0",
    ),
  );

  await assert.rejects(
    collectElectronArtifacts(input, path.join(root, "output"), {
      version: "3.6.0",
      channel: "latest",
    }),
    /contains the wrong size/,
  );
});

async function createCompleteRelease(
  input: string,
  version: string,
  channel: "alpha" | "beta" | "latest" | "test",
) {
  const windows = path.join(input, "windows");
  const arm = path.join(input, "mac-arm");
  const intel = path.join(input, "mac-intel");
  const linux = path.join(input, "linux");
  await Promise.all(
    [windows, arm, intel, linux].map((directory) =>
      mkdir(directory, { recursive: true }),
    ),
  );

  const prefix = "mediago-community";
  const windowsInstaller = `${prefix}-setup-win32-x64-${version}.exe`;
  const windowsPortable = `${prefix}-portable-win32-x64-${version}.exe`;
  const macArmDmg = `${prefix}-setup-darwin-arm64-${version}.dmg`;
  const macArmZip = `${prefix}-setup-darwin-arm64-${version}.zip`;
  const macIntelDmg = `${prefix}-setup-darwin-x64-${version}.dmg`;
  const macIntelZip = `${prefix}-setup-darwin-x64-${version}.zip`;
  const linuxDeb = `${prefix}-setup-linux-x64-${version}.deb`;

  const windowsEntry = await writeReleaseAsset(windows, windowsInstaller, true);
  await writeReleaseAsset(windows, windowsPortable, false);
  const armEntries = await Promise.all([
    writeReleaseAsset(arm, macArmZip, true),
    writeReleaseAsset(arm, macArmDmg, true),
  ]);
  const intelEntries = await Promise.all([
    writeReleaseAsset(intel, macIntelZip, true),
    writeReleaseAsset(intel, macIntelDmg, true),
  ]);
  const linuxEntry = await writeReleaseAsset(linux, linuxDeb, false);

  await Promise.all([
    writeFile(
      path.join(windows, `${channel}.yml`),
      manifest([windowsEntry], version),
    ),
    writeFile(
      path.join(arm, `${channel}-mac.yml`),
      manifest(armEntries, version),
    ),
    writeFile(
      path.join(intel, `${channel}-mac.yml`),
      manifest(intelEntries, version),
    ),
    writeFile(
      path.join(linux, `${channel}-linux.yml`),
      manifest([linuxEntry], version),
    ),
  ]);

  return {
    windows,
    arm,
    intel,
    linux,
    macIntelZip,
    windowsEntry,
    armEntries,
    intelEntries,
    linuxEntry,
  };
}

async function writeReleaseAsset(
  directory: string,
  name: string,
  withBlockmap: boolean,
): Promise<ManifestEntry> {
  const content = Buffer.from(`release asset: ${name}`);
  await writeFile(path.join(directory, name), content);
  const entry: ManifestEntry = {
    url: name,
    sha512: createHash("sha512").update(content).digest("base64"),
    size: content.byteLength,
  };
  if (withBlockmap) {
    const blockmap = Buffer.from(`blockmap: ${name}`);
    await writeFile(path.join(directory, `${name}.blockmap`), blockmap);
    entry.blockMapSize = blockmap.byteLength;
  }
  return entry;
}

function manifest(entries: readonly ManifestEntry[], version: string): string {
  const fileLines = entries.flatMap((entry) => {
    const lines = [
      `  - url: ${entry.url}`,
      `    sha512: ${entry.sha512}`,
      `    size: ${entry.size}`,
    ];
    if (entry.blockMapSize !== undefined) {
      lines.push(`    blockMapSize: ${entry.blockMapSize}`);
    }
    return lines;
  });
  return [
    `version: ${version}`,
    "files:",
    ...fileLines,
    `path: ${entries[0].url}`,
    `sha512: ${entries[0].sha512}`,
    "releaseDate: '2026-08-09T00:00:00.000Z'",
    "",
  ].join("\n");
}

function looseManifest(url: string): string {
  return [
    "version: 3.6.0",
    "files:",
    `  - url: ${url}`,
    '    sha512: "not-yet-validated',
    "    size: invalid",
    `path: ${url}`,
    "",
  ].join("\n");
}
