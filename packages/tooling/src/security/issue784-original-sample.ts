import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const FILE_ID = "1SMQztcT6ZYcseDYMFUmZJJpuqucH4kYK";
const PREFIX_BYTES = 995870;
const SAMPLE_SHA256 =
  "0904543e9ba39995af48d7aaa5af6b2f32494ff2139f6e176661dc87a88c0fe1";

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++)
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return (value ^ 0xffffffff) >>> 0;
}

function extractSample(prefix: Buffer): Buffer {
  assert.ok(prefix.length >= PREFIX_BYTES, "Incomplete ZIP prefix");
  let offset = 0;
  for (let index = 0; index < 4; index++) {
    assert.equal(prefix.readUInt32LE(offset), 0x04034b50);
    const flags = prefix.readUInt16LE(offset + 6);
    const method = prefix.readUInt16LE(offset + 8);
    const expectedCrc = prefix.readUInt32LE(offset + 14);
    const compressed = prefix.readUInt32LE(offset + 18);
    const uncompressed = prefix.readUInt32LE(offset + 22);
    const nameLength = prefix.readUInt16LE(offset + 26);
    const extraLength = prefix.readUInt16LE(offset + 28);
    assert.equal(flags, 0, "Encrypted/data-descriptor entries are unsupported");
    assert.ok(nameLength <= 4096 && compressed <= 4 * 1024 * 1024);
    assert.ok(uncompressed <= 4 * 1024 * 1024);
    const name = prefix
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    const dataOffset = offset + 30 + nameLength + extraLength;
    assert.ok(dataOffset + compressed <= prefix.length);
    if (name === "0____/000.ts") {
      assert.equal(method, 8);
      const sample = inflateRawSync(
        prefix.subarray(dataOffset, dataOffset + compressed),
        { maxOutputLength: 4 * 1024 * 1024 },
      );
      assert.equal(sample.length, uncompressed);
      assert.equal(sample.length, 1026292);
      assert.equal(crc32(sample), expectedCrc);
      assert.equal(expectedCrc, 0x76adb4f7);
      assert.equal(
        createHash("sha256").update(sample).digest("hex"),
        SAMPLE_SHA256,
      );
      assert.equal(sample.length % 188, 0);
      for (let packet = 0; packet < sample.length; packet += 188)
        assert.equal(sample[packet], 0x47);
      return sample;
    }
    assert.equal(compressed, 0, "Only the leading directory may be skipped");
    offset = dataOffset;
  }
  throw new Error("Original 000.ts entry missing");
}

async function publicSamplePrefix(): Promise<Buffer> {
  const base = new URL("https://drive.usercontent.google.com/download");
  base.search = new URLSearchParams({
    id: FILE_ID,
    export: "download",
  }).toString();
  const page = await fetch(base, {
    redirect: "error",
    credentials: "omit",
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(page.status, 200);
  assert.match(page.headers.get("content-type") ?? "", /text\/html/);
  const html = await page.text();
  assert.ok(Buffer.byteLength(html) <= 16384);
  assert.match(html, /too large for Google to scan for viruses/);
  const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/i)?.[0] ?? "";
  const action = new URL(form.match(/\baction="([^"]+)"/)?.[1] ?? "");
  assert.equal(action.origin, base.origin);
  assert.equal(action.pathname, "/download");
  const parameters = new URLSearchParams();
  for (const input of form.matchAll(/<input\b[^>]*>/gi)) {
    const name = input[0].match(/\bname="([^"]+)"/)?.[1];
    const value = input[0].match(/\bvalue="([^"]*)"/)?.[1];
    if (name && value !== undefined) parameters.append(name, value);
  }
  assert.deepEqual([...parameters.keys()].toSorted(), [
    "confirm",
    "export",
    "id",
    "uuid",
  ]);
  assert.equal(parameters.get("id"), FILE_ID);
  assert.equal(parameters.get("export"), "download");
  assert.equal(parameters.get("confirm"), "t");
  assert.match(parameters.get("uuid") ?? "", /^[A-Za-z0-9_-]{16,128}$/);
  action.search = parameters.toString();
  const response = await fetch(action, {
    redirect: "error",
    credentials: "omit",
    headers: { Range: "bytes=0-" + (PREFIX_BYTES - 1) },
    signal: AbortSignal.timeout(60000),
  });
  assert.ok(response.status === 200 || response.status === 206);
  assert.match(
    response.headers.get("content-type") ?? "",
    /application\/(?:octet-stream|zip|x-zip-compressed|binary)/,
  );
  assert.ok(response.body);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let length = 0;
  try {
    while (length < PREFIX_BYTES) {
      const item = await reader.read();
      assert.ok(!item.done, "Public ZIP prefix transfer ended early");
      const chunk = Buffer.from(item.value).subarray(0, PREFIX_BYTES - length);
      chunks.push(chunk);
      length += chunk.length;
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks, PREFIX_BYTES);
}

function verify(
  candidate: string,
  previous: string,
  reportPath: string,
  sample: Buffer,
): void {
  assert.equal(
    process.platform,
    "linux",
    "Media verification requires a native Linux runner",
  );
  const directory = mkdtempSync(join(tmpdir(), "mediago-issue784-"));
  const report: Record<string, unknown> = {
    sampleSha256: SAMPLE_SHA256,
    sampleBytes: sample.length,
    nativeArchitecture: process.arch,
    candidateImage: candidate,
    publishedImage: previous,
    sourceCommit: process.env.GITHUB_SHA ?? null,
    fullArchiveDownloaded: false,
    scope:
      "Original CRC/SHA-verified 000.ts only; remaining segments and the complete original download are untested",
  };
  function run(image: string, binary: string, args: string[]) {
    const result = spawnSync(
      "docker",
      [
        "run",
        "--rm",
        "--network",
        "none",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=64m",
        "--memory",
        "512m",
        "--cpus",
        "2",
        "--pids-limit",
        "128",
        "--user",
        (process.getuid?.() ?? 0) + ":" + (process.getgid?.() ?? 0),
        "--mount",
        "type=bind,source=" + directory + ",target=/fixture",
        "--entrypoint",
        "/app/deps/" + binary,
        image,
        ...args,
      ],
      { encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.ifError(result.error);
    return result;
  }
  const input = [
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "error",
    "-protocol_whitelist",
    "file,pipe",
    "-i",
    "/fixture/000.ts",
  ];
  try {
    writeFileSync(join(directory, "000.ts"), sample, { mode: 0o444 });
    const oldVersion = run(previous, "ffmpeg", ["-version"]);
    const newVersion = run(candidate, "ffmpeg", ["-version"]);
    report.previousVersion = oldVersion.stdout.split("\n")[0];
    report.candidateVersion = newVersion.stdout.split("\n")[0];
    assert.match(oldVersion.stdout, /ffmpeg version 6\.0/);
    assert.match(newVersion.stdout, /8\.1\.3-Jellyfin/);
    const oldRead = run(previous, "ffmpeg", [
      ...input,
      "-map",
      "0:v:0",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ]);
    report.previousParse = {
      status: oldRead.status,
      signal: oldRead.signal,
      stderr: oldRead.stderr.slice(-2048),
    };
    const currentRead = run(candidate, "ffmpeg", [
      ...input,
      "-map",
      "0:v:0",
      "-c",
      "copy",
      "-f",
      "null",
      "-",
    ]);
    report.currentParse = {
      status: currentRead.status,
      signal: currentRead.signal,
      stderr: currentRead.stderr.slice(-2048),
    };
    assert.equal(currentRead.status, 0);
    assert.equal(currentRead.signal, null);
    const remux = run(candidate, "ffmpeg", [
      ...input,
      "-c",
      "copy",
      "/fixture/current.mp4",
    ]);
    report.currentRemux = {
      status: remux.status,
      signal: remux.signal,
      stderr: remux.stderr.slice(-2048),
    };
    assert.equal(remux.status, 0);
    const probe = run(candidate, "ffprobe", [
      "-v",
      "error",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "/fixture/current.mp4",
    ]);
    assert.equal(probe.status, 0);
    const media = JSON.parse(probe.stdout);
    assert.ok(
      media.streams.some(
        (stream: { codec_type: string }) => stream.codec_type === "video",
      ),
    );
    assert.ok(Number(media.format.duration) > 0);
    report.output = {
      bytes: readFileSync(join(directory, "current.mp4")).length,
      duration: Number(media.format.duration),
      codecs: media.streams.map(
        (stream: { codec_name: string }) => stream.codec_name,
      ),
    };
    const decode = run(candidate, "ffmpeg", [
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-i",
      "/fixture/current.mp4",
      "-f",
      "null",
      "-",
    ]);
    report.currentDecode = {
      status: decode.status,
      signal: decode.signal,
      stderr: decode.stderr.slice(-2048),
    };
    assert.equal(decode.status, 0);
    assert.equal(decode.signal, null);
  } finally {
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === "--inspect-prefix") {
  const sample = extractSample(readFileSync(process.argv[3]));
  process.stdout.write(
    JSON.stringify({
      bytes: sample.length,
      sha256: SAMPLE_SHA256,
      crc32: "76adb4f7",
    }),
  );
} else {
  const [, , candidate, previous, reportPath] = process.argv;
  assert.ok(
    candidate && previous && reportPath,
    "Expected candidate image, old image and report path",
  );
  verify(
    candidate,
    previous,
    reportPath,
    extractSample(await publicSamplePrefix()),
  );
}
