import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  assertTestSigningEnvironment,
  getWindowsTestVersion,
  getSigningProductVersion,
  signingPhase,
  unsignedPeDigest,
  verifyWindowsReleaseArtifacts,
} from "./windows-signing.ts";

const environment = {
  GITHUB_ACTIONS: "true",
  RUNNER_ENVIRONMENT: "github-hosted",
  GITHUB_REPOSITORY: "mediago-dev/mediago",
  MEDIAGO_SIGNPATH_TEST: "1",
  BUILD_VERSION: "3.6.0-test.9",
  GITHUB_SHA: "a".repeat(40),
};
test("only a test build from the expected repository can request signing", () => {
  expect(() => assertTestSigningEnvironment(environment)).not.toThrow();
  for (const invalid of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_REPOSITORY: "fork/mediago" },
    { BUILD_VERSION: "3.6.0-beta.1" },
    { BUILD_VERSION: "3.6.0" },
    { GITHUB_SHA: "master" },
  ]) {
    expect(() =>
      assertTestSigningEnvironment({ ...environment, ...invalid }),
    ).toThrow();
  }
});
test("maps test prereleases to bounded Windows product versions", () => {
  expect(getWindowsTestVersion("3.6.0-test.4")).toEqual({
    buildNumber: "4",
    productVersion: "3.6.0.4",
  });
  expect(getWindowsTestVersion("0.0.0-test.0")).toEqual({
    buildNumber: "0",
    productVersion: "0.0.0.0",
  });
  expect(
    getWindowsTestVersion("65535.65535.65535-test.65535").productVersion,
  ).toBe("65535.65535.65535.65535");
  for (const version of [
    "3.6.0-beta.4",
    "3.6.0",
    "3.6.0-test.65536",
    "65536.0.0-test.1",
    "3.06.0-test.4",
    "3.6.0-test.04",
  ]) {
    expect(() => getWindowsTestVersion(version)).toThrow();
  }
});
test("binds each signing phase to its exact ProductVersion representation", () => {
  const version = "3.6.0-test.5";
  expect(getSigningProductVersion(version, "app")).toBe("3.6.0.5");
  for (const phase of ["uninstaller", "installer", "portable"] as const) {
    expect(getSigningProductVersion(version, phase)).toBe(version);
    expect(() => getSigningProductVersion("3.6.0", phase)).toThrow();
  }
  expect(() => getSigningProductVersion(version, "unknown" as never)).toThrow();
});
test("limits signing to the four MediaGo packaging checkpoints", () => {
  expect(
    signingPhase("release/win-unpacked/mediago.exe", environment.BUILD_VERSION),
  ).toBe("app");
  expect(
    signingPhase(
      "mediago-setup-win32-x64-3.6.0-test.9.__uninstaller.exe",
      environment.BUILD_VERSION,
    ),
  ).toBe("uninstaller");
  expect(
    signingPhase(
      "mediago-setup-win32-x64-3.6.0-test.9.exe",
      environment.BUILD_VERSION,
    ),
  ).toBe("installer");
  expect(
    signingPhase(
      "mediago-portable-win32-x64-3.6.0-test.9.exe",
      environment.BUILD_VERSION,
    ),
  ).toBe("portable");
  for (const file of [
    "ffmpeg.exe",
    "yt-dlp.exe",
    "chrome_crashpad_handler.exe",
    "release/win-unpacked/resources/deps/mediago.exe",
    "mediago-setup-win32-x64-3.6.0-beta.1.exe",
  ]) {
    expect(signingPhase(file, environment.BUILD_VERSION)).toBeNull();
  }
  expect(() => signingPhase("mediago.exe", "3.6.0-beta.1")).toThrow();
});
function pe() {
  const value = Buffer.alloc(520);
  value.write("MZ");
  value.writeUInt32LE(128, 0x3c);
  value.write("PE\0\0", 128);
  value.writeUInt16LE(0x20b, 152);
  value.write("MediaGo payload", 400);
  return value;
}
describe("signed payload verification", () => {
  test("accepts only the checksum, security directory and appended signature changing", () => {
    const unsigned = pe();
    const signed = Buffer.concat([unsigned, Buffer.alloc(32, 1)]);
    signed.writeUInt32LE(123, 216);
    signed.writeUInt32LE(520, 296);
    signed.writeUInt32LE(32, 300);
    expect(unsignedPeDigest(unsigned)).toBe(unsignedPeDigest(signed));
    signed[400] ^= 1;
    expect(unsignedPeDigest(unsigned)).not.toBe(unsignedPeDigest(signed));
  });
  test("rejects malformed headers and certificate tables", () => {
    expect(() => unsignedPeDigest(Buffer.from("not a PE"))).toThrow();
    const invalid = pe();
    invalid.writeUInt32LE(0xffffff00, 296);
    invalid.writeUInt32LE(32, 300);
    expect(() => unsignedPeDigest(invalid)).toThrow();
  });
});

describe("Windows production release verification", () => {
  const release = {
    platform: "win32" as const,
    runMode: "release",
    isDir: false,
    releaseDirectory: path.resolve("release"),
    version: "3.6.0-beta.2",
    arch: "x64" as const,
  };
  test("verifies the application, installer and portable before accepting a release", () => {
    const verify = vi.fn();
    verifyWindowsReleaseArtifacts(release, verify);
    expect(verify.mock.calls.map(([file]) => path.basename(file))).toEqual([
      "mediago.exe",
      "mediago-setup-win32-x64-3.6.0-beta.2.exe",
      "mediago-portable-win32-x64-3.6.0-beta.2.exe",
    ]);
  });
  test("rejects an invalid installer even when application verification passed", () => {
    const verify = vi.fn((file: string) => {
      if (path.basename(file).startsWith("mediago-setup-"))
        throw new Error("unsigned installer");
    });
    expect(() => verifyWindowsReleaseArtifacts(release, verify)).toThrow(
      "Windows production release blocked",
    );
    expect(verify).toHaveBeenCalledTimes(2);
  });
  test("fails closed if application signature verification cannot run", () => {
    const verify = vi.fn(() => {
      throw new Error("verification unavailable");
    });
    expect(() => verifyWindowsReleaseArtifacts(release, verify)).toThrow(
      "Windows production release blocked",
    );
    expect(verify).toHaveBeenCalledTimes(1);
  });
  test("retains test, unpacked development and non-Windows behavior", () => {
    const verify = vi.fn();
    verifyWindowsReleaseArtifacts({ ...release, runMode: "test" }, verify);
    verifyWindowsReleaseArtifacts({ ...release, runMode: undefined }, verify);
    verifyWindowsReleaseArtifacts({ ...release, isDir: true }, verify);
    verifyWindowsReleaseArtifacts({ ...release, platform: "darwin" }, verify);
    expect(verify).not.toHaveBeenCalled();
  });
});
