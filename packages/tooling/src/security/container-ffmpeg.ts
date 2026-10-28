import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Exercise the SDT/ISO6937 path that crashed the former static FFmpeg build.
export function verifyContainerFfmpeg(image: string): void {
  const directory = mkdtempSync(join(tmpdir(), "mediago-ffmpeg-"));
  const run = (binary: string, args: string[]): string =>
    execFileSync("docker", argumentsFor(binary, args), {
      encoding: "utf8",
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    });
  function argumentsFor(binary: string, args: string[]): string[] {
    return [
      "run",
      "--rm",
      "--network",
      "none",
      "--user",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      "--mount",
      `type=bind,source=${directory},target=/fixture`,
      "--entrypoint",
      `/app/deps/${binary}`,
      image,
      ...args,
    ];
  }
  try {
    assert.match(run("ffmpeg", ["-version"]), /8\.1\.3-Jellyfin/);
    run("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x96:rate=10",
      "-t",
      "1",
      "-metadata",
      "service_provider=FFmpeg",
      "-metadata",
      "service_name=Service01",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-f",
      "mpegts",
      "/fixture/sdt.ts",
    ]);
    // ASCII DVB strings have no character-set prefix and select ISO6937.
    const descriptor = Buffer.concat([
      Buffer.from([0x48, 18, 1, 6]),
      Buffer.from("FFmpeg"),
      Buffer.from([9]),
      Buffer.from("Service01"),
    ]);
    assert.ok(
      readFileSync(join(directory, "sdt.ts")).includes(descriptor),
      "Generated TS must contain the unprefixed SDT service descriptor",
    );
    run("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "/fixture/sdt.ts",
      "-map",
      "0:v:0",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ]);
    const programs = JSON.parse(
      run("ffprobe", [
        "-v",
        "error",
        "-show_programs",
        "-of",
        "json",
        "/fixture/sdt.ts",
      ]),
    );
    assert.equal(programs.programs[0].tags.service_provider, "FFmpeg");
    assert.equal(programs.programs[0].tags.service_name, "Service01");
    run("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "/fixture/sdt.ts",
      "-c",
      "copy",
      "/fixture/merged.mp4",
    ]);
    run("ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      "/fixture/merged.mp4",
      "-vf",
      "scale=80:48",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "/fixture/converted.mp4",
    ]);
    const converted = JSON.parse(
      run("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-of",
        "json",
        "/fixture/converted.mp4",
      ]),
    );
    assert.equal(converted.streams[0].codec_name, "h264");
    assert.equal(converted.streams[0].width, 80);
    assert.equal(converted.streams[0].height, 48);
    writeFileSync(join(directory, "invalid.ts"), "not a transport stream");
    const invalid = spawnSync(
      "docker",
      argumentsFor("ffmpeg", [
        "-nostdin",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "/fixture/invalid.ts",
        "-c",
        "copy",
        "/fixture/invalid.mp4",
      ]),
      { encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
    );
    assert.ifError(invalid.error);
    assert.ok(
      invalid.status !== null && invalid.status !== 0,
      "Invalid input must return a normal failure, not success or a crash",
    );
    assert.equal(invalid.signal, null);
    assert.match(invalid.stderr, /Invalid data found when processing input/);
    assert.equal(existsSync(join(directory, "invalid.mp4")), false);
    console.log(
      "FFmpeg SDT/ISO6937 parsing, lossless remux, H.264 conversion and invalid-input rejection passed.",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
