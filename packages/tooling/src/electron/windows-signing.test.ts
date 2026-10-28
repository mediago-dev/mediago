import { describe, expect, test } from "vitest";
import {
  assertTestSigningEnvironment,
  signingPhase,
  unsignedPeDigest,
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
