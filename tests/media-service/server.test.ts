import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer, type RequestListener } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  onTestFinished,
  test,
} from "vitest";
import { installFixtureVersion } from "./generate.ts";
import { startMediaServer, type StartedMediaServer } from "./server.ts";
import { verifyMediaService } from "./verify.ts";

interface FixtureManifest {
  schemaVersion: number;
  fixtureVersion: string;
  generator: {
    name: string;
    version: string;
  };
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
}

const FIXTURE_ROOT = fileURLToPath(new URL("./public/v1/", import.meta.url));
const EXPOSED_HEADERS = [
  "accept-ranges",
  "content-length",
  "content-range",
  "etag",
];
const CONTENT_TYPES = new Map([
  ["manifest.json", "application/json; charset=utf-8"],
  ["sample.mp4", "video/mp4"],
  ["hls/index.m3u8", "application/vnd.apple.mpegurl"],
  ["hls/init.mp4", "video/mp4"],
  ["hls/segment-0.m4s", "video/mp4"],
]);

let mediaServer: StartedMediaServer;
let manifest: FixtureManifest;

async function startTestServer(
  listener: RequestListener,
): Promise<StartedMediaServer> {
  const server = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error): void => reject(error);
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Test server did not bind to a TCP port");
  }
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      server.closeAllConnections();
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

describe("media fixture protocol", () => {
  beforeAll(async () => {
    manifest = JSON.parse(
      await readFile(path.join(FIXTURE_ROOT, "manifest.json"), "utf8"),
    ) as FixtureManifest;
    mediaServer = await startMediaServer();
  });

  afterAll(async () => {
    await mediaServer?.close();
  });

  test("starts on loopback with a versioned base URL", () => {
    expect(mediaServer.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
  });

  test("serves only the fixed read-only route allowlist", async () => {
    const health = await fetch(new URL("/healthz", mediaServer.baseURL));
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(health.headers.get("access-control-allow-origin")).toBe("*");
    await expect(health.text()).resolves.toBe("ok\n");

    const rejectedMethod = await fetch(`${mediaServer.baseURL}/sample.mp4`, {
      method: "POST",
    });
    expect(rejectedMethod.status).toBe(405);
    expect(rejectedMethod.headers.get("allow")).toBe("GET, HEAD");

    const unknown = await fetch(`${mediaServer.baseURL}/missing.mp4`);
    expect(unknown.status).toBe(404);
  });

  test("serves committed files with exact metadata and bytes", async () => {
    await Promise.all(
      [...CONTENT_TYPES].map(async ([relativePath, contentType]) => {
        const expected = await readFile(path.join(FIXTURE_ROOT, relativePath));
        const sha256 = createHash("sha256").update(expected).digest("hex");
        const response = await fetch(`${mediaServer.baseURL}/${relativePath}`);

        expect(response.status, relativePath).toBe(200);
        expect(response.headers.get("content-type"), relativePath).toBe(
          contentType,
        );
        expect(response.headers.get("content-length"), relativePath).toBe(
          String(expected.length),
        );
        expect(response.headers.get("accept-ranges"), relativePath).toBe(
          "bytes",
        );
        expect(response.headers.get("etag"), relativePath).toBe(
          `"sha256-${sha256}"`,
        );
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        const exposed = response.headers
          .get("access-control-expose-headers")
          ?.toLowerCase()
          .split(/,\s*/);
        expect(exposed, relativePath).toEqual(EXPOSED_HEADERS);
        expect(Buffer.from(await response.arrayBuffer()), relativePath).toEqual(
          expected,
        );
      }),
    );
  });

  test("returns headers without a body for HEAD", async () => {
    const expected = await readFile(path.join(FIXTURE_ROOT, "sample.mp4"));
    const response = await fetch(`${mediaServer.baseURL}/sample.mp4`, {
      method: "HEAD",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-length")).toBe(
      String(expected.length),
    );
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect((await response.arrayBuffer()).byteLength).toBe(0);
  });

  test.each([
    ["a closed byte range", "bytes=2-7", 2, 7],
    ["an open-ended byte range", "bytes=4-", 4, undefined],
    ["a suffix byte range", "bytes=-6", -6, undefined],
  ])("supports %s", async (_name, range, requestedStart, requestedEnd) => {
    const expected = await readFile(path.join(FIXTURE_ROOT, "sample.mp4"));
    const start =
      requestedStart < 0 ? expected.length + requestedStart : requestedStart;
    const end = requestedEnd ?? expected.length - 1;
    const response = await fetch(`${mediaServer.baseURL}/sample.mp4`, {
      headers: { Range: range },
    });

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${start}-${end}/${expected.length}`,
    );
    expect(response.headers.get("content-length")).toBe(
      String(end - start + 1),
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      expected.subarray(start, end + 1),
    );
  });

  test("rejects invalid and multipart ranges", async () => {
    const expected = await readFile(path.join(FIXTURE_ROOT, "sample.mp4"));
    const invalidRanges = [
      "bytes=",
      "bytes=abc-def",
      "bytes=1-2,4-5",
      "items=0-1",
      "bytes=9-2",
      `bytes=${expected.length}-`,
      "bytes=-0",
    ];

    await Promise.all(
      invalidRanges.map(async (range) => {
        const response = await fetch(`${mediaServer.baseURL}/sample.mp4`, {
          headers: { Range: range },
        });
        expect(response.status, range).toBe(416);
        expect(response.headers.get("content-range"), range).toBe(
          `bytes */${expected.length}`,
        );
        expect(response.headers.get("content-length"), range).toBe("0");
        expect((await response.arrayBuffer()).byteLength, range).toBe(0);
      }),
    );
  });

  test("publishes a stable manifest without hashing itself", async () => {
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.fixtureVersion).toBe("v1");
    expect(manifest.generator.name).toBe("ffmpeg");
    expect(manifest.generator.version).toMatch(/^ffmpeg version /);
    expect(manifest.files.map((file) => file.path)).toEqual([
      "hls/index.m3u8",
      "hls/init.mp4",
      "hls/segment-0.m4s",
      "sample.mp4",
    ]);

    await Promise.all(
      manifest.files.map(async (file) => {
        const contents = await readFile(path.join(FIXTURE_ROOT, file.path));
        expect(file.size, file.path).toBe(contents.length);
        expect(file.sha256, file.path).toBe(
          createHash("sha256").update(contents).digest("hex"),
        );
        expect(file.sha256, file.path).toMatch(/^[a-f0-9]{64}$/);
      }),
    );
  });

  test("passes reusable verification against the local service", async () => {
    await expect(
      verifyMediaService(mediaServer.baseURL),
    ).resolves.toBeUndefined();
  });
});

describe("fixture version installation", () => {
  async function createVersion(contents: string): Promise<{
    generatedDirectory: string;
    targetDirectory: string;
  }> {
    const root = await mkdtemp(path.join(tmpdir(), "mediago-fixture-test-"));
    onTestFinished(() => rm(root, { recursive: true, force: true }));
    const generatedDirectory = path.join(root, "generated", "v1");
    const targetDirectory = path.join(root, "public", "v1");
    await mkdir(path.join(generatedDirectory, "hls"), { recursive: true });
    await writeFile(path.join(generatedDirectory, "sample.mp4"), contents);
    await writeFile(path.join(generatedDirectory, "hls", "index.m3u8"), "hls");
    return { generatedDirectory, targetDirectory };
  }

  test("atomically installs a version that does not exist", async () => {
    const { generatedDirectory, targetDirectory } =
      await createVersion("original");

    await expect(
      installFixtureVersion(generatedDirectory, targetDirectory),
    ).resolves.toBe("created");
    await expect(
      readFile(path.join(targetDirectory, "sample.mp4"), "utf8"),
    ).resolves.toBe("original");
  });

  test("does not replace an existing empty version directory", async () => {
    const { generatedDirectory, targetDirectory } =
      await createVersion("original");
    await mkdir(targetDirectory, { recursive: true });

    await expect(
      installFixtureVersion(generatedDirectory, targetDirectory),
    ).rejects.toThrow(/new fixture version/);
    await expect(readdir(targetDirectory)).resolves.toEqual([]);
  });

  test("treats an identical existing version as a no-op", async () => {
    const first = await createVersion("same");
    await installFixtureVersion(
      first.generatedDirectory,
      first.targetDirectory,
    );

    const secondDirectory = path.join(
      path.dirname(path.dirname(first.generatedDirectory)),
      "regenerated",
      "v1",
    );
    await mkdir(path.join(secondDirectory, "hls"), { recursive: true });
    await writeFile(path.join(secondDirectory, "sample.mp4"), "same");
    await writeFile(path.join(secondDirectory, "hls", "index.m3u8"), "hls");

    await expect(
      installFixtureVersion(secondDirectory, first.targetDirectory),
    ).resolves.toBe("unchanged");
  });

  test("rejects a changed version without overwriting it", async () => {
    const first = await createVersion("original");
    await installFixtureVersion(
      first.generatedDirectory,
      first.targetDirectory,
    );

    const changedDirectory = path.join(
      path.dirname(path.dirname(first.generatedDirectory)),
      "changed",
      "v1",
    );
    await mkdir(path.join(changedDirectory, "hls"), { recursive: true });
    await writeFile(path.join(changedDirectory, "sample.mp4"), "changed");
    await writeFile(path.join(changedDirectory, "hls", "index.m3u8"), "hls");

    await expect(
      installFixtureVersion(changedDirectory, first.targetDirectory),
    ).rejects.toThrow(/new fixture version/);
    await expect(
      readFile(path.join(first.targetDirectory, "sample.mp4"), "utf8"),
    ).resolves.toBe("original");
  });

  test("is not blocked by a stale lock file", async () => {
    const { generatedDirectory, targetDirectory } =
      await createVersion("original");
    await mkdir(path.dirname(targetDirectory), { recursive: true });
    await writeFile(`${targetDirectory}.lock`, "stale");

    await expect(
      installFixtureVersion(generatedDirectory, targetDirectory),
    ).resolves.toBe("created");
  });
});

describe("publication verifier limits", () => {
  test("fails quickly when a remote request stalls", async () => {
    const server = await startTestServer(() => {});
    onTestFinished(server.close);
    let guardTimeout: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_resolve, reject) => {
      guardTimeout = setTimeout(
        () => reject(new Error("verifier remained pending")),
        200,
      );
    });

    try {
      await expect(
        Promise.race([
          verifyMediaService(server.baseURL, { timeoutMs: 25 }),
          guard,
        ]),
      ).rejects.toThrow("Remote manifest timed out after 25 ms");
    } finally {
      clearTimeout(guardTimeout);
    }
  });

  test("rejects a manifest larger than 64 KiB while streaming", async () => {
    const server = await startTestServer((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write(Buffer.alloc(64 * 1024, 0x20));
      response.end("x");
    });
    onTestFinished(server.close);

    await expect(verifyMediaService(server.baseURL)).rejects.toThrow(
      "Remote manifest exceeds 65536-byte limit",
    );
  });

  test("rejects a media response as soon as it exceeds the expected size", async () => {
    const manifestContents = await readFile(
      path.join(FIXTURE_ROOT, "manifest.json"),
    );
    const localManifest = JSON.parse(
      manifestContents.toString("utf8"),
    ) as FixtureManifest;
    const publishedFiles = new Map<string, Buffer>([
      ["manifest.json", manifestContents],
    ]);
    await Promise.all(
      localManifest.files.map(async (file) => {
        publishedFiles.set(
          file.path,
          await readFile(path.join(FIXTURE_ROOT, file.path)),
        );
      }),
    );
    const server = await startTestServer((request, response) => {
      const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
      const relativePath = pathname.replace(/^\/v1\//, "");
      const contents = publishedFiles.get(relativePath);
      if (!contents) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200);
      response.write(contents);
      response.end(relativePath === "sample.mp4" ? Buffer.of(0) : undefined);
    });
    onTestFinished(server.close);

    await expect(verifyMediaService(server.baseURL)).rejects.toThrow(
      `Remote file sample.mp4 exceeds expected size of ${publishedFiles.get("sample.mp4")?.length} bytes`,
    );
  });
});
