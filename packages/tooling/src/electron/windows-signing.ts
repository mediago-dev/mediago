import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  assertWindowsUpdateSignature,
  readSignatureEvidenceSync,
  validateSignatureEvidence,
} from "../../../../apps/electron/src/vendor/windows-signature.ts";

export const TEST_CERTIFICATE_SHA256 =
  "22d8e5b9d83f87a2145311bb517427fff528d2ce88a8bb4082491226ffb9c43a";
export const TEST_PUBLISHER = {
  CN: "Test certificate for 'MediaGo [OSS]'",
} as const;
export const SIGNING_PHASES = [
  "app",
  "uninstaller",
  "installer",
  "portable",
] as const;
export type SigningPhase = (typeof SIGNING_PHASES)[number];

export function getWindowsTestVersion(version: string): {
  buildNumber: string;
  productVersion: string;
} {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-test\.(0|[1-9]\d*)$/.exec(
      version,
    );
  if (!match || match.slice(1).some((part) => Number(part) > 65535)) {
    throw new Error(
      "The test version must fit a four-part Windows version (0-65535 per part)",
    );
  }
  return { buildNumber: match[4], productVersion: match.slice(1).join(".") };
}
// Electron and NSIS expose different ProductVersion string resources.
export function getSigningProductVersion(
  version: string,
  phase: SigningPhase,
): string {
  const windowsVersion = getWindowsTestVersion(version);
  if (!SIGNING_PHASES.includes(phase)) throw new Error("Unknown signing phase");
  return phase === "app" ? windowsVersion.productVersion : version;
}
export function signingPhase(
  file: string,
  version: string,
): SigningPhase | null {
  if (!/^\d+\.\d+\.\d+-test\.\d+$/.test(version)) {
    throw new Error("SignPath test signing requires a test.N version");
  }
  const filename = path.basename(file);
  if (
    filename === "mediago.exe" &&
    /[\\/]win-unpacked[\\/]mediago\.exe$/.test(file)
  )
    return "app";
  if (filename === `mediago-setup-win32-x64-${version}.__uninstaller.exe`)
    return "uninstaller";
  if (filename === `mediago-setup-win32-x64-${version}.exe`) return "installer";
  if (filename === `mediago-portable-win32-x64-${version}.exe`)
    return "portable";
  return null;
}

export function assertTestSigningEnvironment(env = process.env): void {
  if (
    env.GITHUB_ACTIONS !== "true" ||
    env.RUNNER_ENVIRONMENT !== "github-hosted" ||
    env.GITHUB_REPOSITORY !== "mediago-dev/mediago" ||
    env.MEDIAGO_SIGNPATH_TEST !== "1" ||
    !/^\d+\.\d+\.\d+-test\.\d+$/.test(env.BUILD_VERSION ?? "") ||
    !/^[0-9a-f]{40}$/i.test(env.GITHUB_SHA ?? "")
  ) {
    throw new Error(
      "Test signing is restricted to MediaGo GitHub Actions test builds",
    );
  }
}

// Authenticode changes the checksum and security directory and appends an aligned
// certificate table. Compare every other byte before accepting a signed response.
export function unsignedPeDigest(input: Buffer): string {
  if (input.length < 256 || input.toString("ascii", 0, 2) !== "MZ")
    throw new Error("Invalid PE file");
  const pe = input.readUInt32LE(0x3c);
  const optional = pe + 24;
  if (
    optional + 160 > input.length ||
    input.toString("ascii", pe, pe + 4) !== "PE\0\0"
  ) {
    throw new Error("Invalid PE header");
  }
  const magic = input.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b)
    throw new Error("Unsupported PE format");
  const checksum = optional + 64;
  const security = optional + (magic === 0x20b ? 112 : 96) + 4 * 8;
  const offset = input.readUInt32LE(security);
  const size = input.readUInt32LE(security + 4);
  let payload = Buffer.from(input);
  if (offset || size) {
    if (
      !offset ||
      size < 8 ||
      offset + size !== input.length ||
      offset % 8 !== 0
    ) {
      throw new Error("Invalid Authenticode certificate table");
    }
    payload = payload.subarray(0, offset);
  }
  payload.fill(0, checksum, checksum + 4);
  payload.fill(0, security, security + 8);
  const aligned = Buffer.alloc(Math.ceil(payload.length / 8) * 8);
  payload.copy(aligned);
  return createHash("sha256").update(aligned).digest("hex");
}

export function verifyTestSignature(file: string): void {
  validateSignatureEvidence(
    readSignatureEvidenceSync(file),
    file,
    TEST_PUBLISHER,
    TEST_CERTIFICATE_SHA256,
  );
}

export async function writeSigningRecord(
  file: string,
  data: unknown,
): Promise<void> {
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data), { flag: "wx" });
  await fs.rename(temporary, file);
}

// Serial polling is intentional: each check waits for the previous signer state.
/* eslint-disable no-await-in-loop */
export async function waitForFile(
  file: string,
  timeoutMs = 30 * 60_000,
  completionFile?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await fs
        .stat(file)
        .then((entry) => entry.isFile())
        .catch(() => false)
    )
      return;
    if (completionFile && (await fs.stat(completionFile).catch(() => null))) {
      const completion = JSON.parse(await fs.readFile(completionFile, "utf8"));
      if (completion.status !== 0)
        throw new Error(
          "Packaging failed before its signing checkpoint; see build.log",
        );
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${path.basename(file)}`);
}
/* eslint-enable no-await-in-loop */

export async function signWindowsTestFile(options: {
  path: string;
  hash: string;
}): Promise<void> {
  assertTestSigningEnvironment();
  if (options.hash !== "sha256")
    throw new Error("Only SHA-256 signing is permitted");
  const version = process.env.BUILD_VERSION ?? "";
  const phase = signingPhase(options.path, version);
  // Preserve signatures/provenance of upstream Electron DLLs and runtime tools.
  if (!phase) return;
  const releaseRoot = await fs.realpath(path.resolve("release"));
  const target = await fs.realpath(options.path);
  const relative = path.relative(releaseRoot, target);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("Signing target is outside the release directory");
  const queuePath = process.env.MEDIAGO_SIGNPATH_QUEUE;
  if (!queuePath || !path.isAbsolute(queuePath))
    throw new Error("The signing queue path is unavailable");
  const queue = path.resolve(queuePath);
  const directory = path.join(queue, phase);
  await fs.mkdir(path.join(directory, "unsigned"), { recursive: true });
  const unsigned = await fs.readFile(target);
  await fs.writeFile(
    path.join(directory, "unsigned", "mediago.exe"),
    unsigned,
    { flag: "wx" },
  );
  await writeSigningRecord(path.join(directory, "request.json"), {
    phase,
    version,
    sourceSha: process.env.GITHUB_SHA,
    target,
    payloadDigest: unsignedPeDigest(unsigned),
  });
  await waitForFile(path.join(directory, "ready.json"));
  const signed = path.join(directory, "signed", "mediago.exe");
  verifyTestSignature(signed);
  if (
    unsignedPeDigest(await fs.readFile(signed)) !== unsignedPeDigest(unsigned)
  ) {
    throw new Error("The signed response changed the executable payload");
  }
  await fs.copyFile(signed, target);
  verifyTestSignature(target);
  await writeSigningRecord(path.join(directory, "applied.json"), {
    phase,
    target,
  });
}

export function verifyWindowsReleaseArtifacts(
  options: {
    platform: NodeJS.Platform;
    runMode: string | undefined;
    isDir: boolean;
    releaseDirectory: string;
    version: string;
    arch: "x64" | "arm64";
  },
  verifyFile: (file: string) => void = assertWindowsUpdateSignature,
): void {
  if (
    options.platform !== "win32" ||
    options.runMode !== "release" ||
    options.isDir
  )
    return;
  const files = [
    path.resolve(options.releaseDirectory, "win-unpacked/mediago.exe"),
    path.resolve(
      options.releaseDirectory,
      `mediago-setup-win32-${options.arch}-${options.version}.exe`,
    ),
    path.resolve(
      options.releaseDirectory,
      `mediago-portable-win32-${options.arch}-${options.version}.exe`,
    ),
  ];
  for (const file of files) {
    try {
      verifyFile(file);
    } catch (cause) {
      throw new Error(
        `Windows production release blocked: ${path.basename(file)} must have a valid timestamped production signature.`,
        { cause },
      );
    }
  }
}
