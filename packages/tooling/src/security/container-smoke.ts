import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readSync,
  rmdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyContainerArchitecture } from "./container-architecture.ts";
import { verifyContainerFfmpeg } from "./container-ffmpeg.ts";

const image = process.argv[2] || "mediago:security";
const expectedArchitecture =
  process.argv[3] || (process.arch === "x64" ? "amd64" : process.arch);
const container = `mediago-security-${randomUUID()}`;
function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 2 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
try {
  // Inspect Core before starting it so an architecture mismatch cannot be
  // hidden by emulation or by the image's declared platform.
  docker([
    "create",
    "--name",
    container,
    "--publish",
    "127.0.0.1::8900",
    image,
    "--port=8900",
  ]);
  const platform = docker([
    "image",
    "inspect",
    "--format",
    "{{.Os}}/{{.Architecture}}",
    image,
  ]).trim();
  const inspectionDirectory = mkdtempSync(join(tmpdir(), "mediago-core-elf-"));
  const corePath = join(inspectionDirectory, "mediago-core");
  try {
    docker(["cp", `${container}:/usr/local/bin/mediago-core`, corePath]);
    const descriptor = openSync(corePath, "r");
    const header = Buffer.alloc(20);
    let bytesRead: number;
    try {
      bytesRead = readSync(descriptor, header, 0, header.length, 0);
    } finally {
      closeSync(descriptor);
    }
    const machine = verifyContainerArchitecture(
      platform,
      expectedArchitecture,
      header.subarray(0, bytesRead),
    );
    console.log(
      `Image architecture passed: ${platform}; Core ELF machine=${machine}`,
    );
  } finally {
    rmSync(corePath, { force: true });

    rmdirSync(inspectionDirectory);
  }

  // Exercise the same native binaries that production downloads launch.
  for (const [binary, args] of [
    ["/app/deps/mediago", ["--help"]],
    ["/app/deps/ffmpeg", ["-version"]],
    ["/app/deps/N_m3u8DL-RE", ["--help"]],
    ["/app/deps/BBDown", ["--help"]],
    ["/app/deps/aria2c", ["--version"]],
    ["/app/deps/yt-dlp", ["--version"]],
    ["/app/deps/deno", ["--version"]],
  ] as const) {
    docker(["run", "--rm", "--entrypoint", binary, image, ...args]);
    console.log(`Native startup passed: ${binary}`);
  }

  verifyContainerFfmpeg(image);

  // An appended flag must override the image default without a shell wrapper.
  docker(["start", container]);
  const ports = JSON.parse(
    docker([
      "inspect",
      "--format",
      "{{json .NetworkSettings.Ports}}",
      container,
    ]),
  ) as Record<string, { HostPort: string }[]>;
  const url = `http://127.0.0.1:${ports["8900/tcp"][0].HostPort}/healthy`;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {
      /* Wait only for this fresh test container. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(
    ready,
    "Container did not become healthy with the existing volume paths and overridden port.",
  );
  docker(["stop", "--time", "10", container]);
  const code = Number(
    docker(["inspect", "--format", "{{.State.ExitCode}}", container]).trim(),
  );
  // The existing Core exits with 128 + SIGTERM (143). Both a handled exit and
  // normal SIGTERM delivery are valid; SIGKILL (137) or crashes must fail.
  assert.ok(
    code === 0 || code === 143,
    `Core did not respond to SIGTERM: exit ${code}`,
  );
  console.log(
    "Container health, volume initialization, argument override and SIGTERM delivery passed.",
  );
} finally {
  docker(["rm", "--force", "--volumes", container]);
}
