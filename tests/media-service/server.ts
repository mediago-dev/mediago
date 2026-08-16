import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_ROOT = fileURLToPath(new URL("./public/", import.meta.url));
const CORS_EXPOSE_HEADERS =
  "Accept-Ranges, Content-Length, Content-Range, ETag";
const FILE_ROUTES = new Map([
  [
    "/v1/manifest.json",
    {
      path: "v1/manifest.json",
      contentType: "application/json; charset=utf-8",
    },
  ],
  ["/v1/sample.mp4", { path: "v1/sample.mp4", contentType: "video/mp4" }],
  [
    "/v1/hls/index.m3u8",
    {
      path: "v1/hls/index.m3u8",
      contentType: "application/vnd.apple.mpegurl",
    },
  ],
  ["/v1/hls/init.mp4", { path: "v1/hls/init.mp4", contentType: "video/mp4" }],
  [
    "/v1/hls/segment-0.m4s",
    { path: "v1/hls/segment-0.m4s", contentType: "video/mp4" },
  ],
]);

interface ByteRange {
  start: number;
  end: number;
}

interface LoadedAsset {
  body: Buffer;
  contentType: string;
  etag: string;
}

export interface StartedMediaServer {
  baseURL: string;
  close: () => Promise<void>;
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Expose-Headers", CORS_EXPOSE_HEADERS);
}

function sendText(
  request: IncomingMessage,
  response: ServerResponse,
  statusCode: number,
  body: string,
  headers: Record<string, string> = {},
): void {
  const contents = Buffer.from(body);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": String(contents.length),
    ...headers,
  });
  response.end(request.method === "HEAD" ? undefined : contents);
}

function parseInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function parseRange(value: string, size: number): ByteRange | undefined {
  if (value.includes(",")) return undefined;

  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match) return undefined;

  const [, rawStart, rawEnd] = match;
  if (rawStart === "") {
    const suffixLength = parseInteger(rawEnd);
    if (suffixLength === undefined || suffixLength === 0) return undefined;
    const length = Math.min(suffixLength, size);
    return { start: size - length, end: size - 1 };
  }

  const start = parseInteger(rawStart);
  if (start === undefined || start >= size) return undefined;

  if (rawEnd === "") return { start, end: size - 1 };

  const requestedEnd = parseInteger(rawEnd);
  if (requestedEnd === undefined || requestedEnd < start) return undefined;
  return { start, end: Math.min(requestedEnd, size - 1) };
}

function sendAsset(
  request: IncomingMessage,
  response: ServerResponse,
  asset: LoadedAsset,
): void {
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", asset.contentType);
  response.setHeader("ETag", asset.etag);

  const requestedRange = request.headers.range;
  if (requestedRange !== undefined) {
    const range = parseRange(requestedRange, asset.body.length);
    if (!range) {
      response.writeHead(416, {
        "Content-Range": `bytes */${asset.body.length}`,
        "Content-Length": "0",
      });
      response.end();
      return;
    }

    const body = asset.body.subarray(range.start, range.end + 1);
    response.writeHead(206, {
      "Content-Range": `bytes ${range.start}-${range.end}/${asset.body.length}`,
      "Content-Length": String(body.length),
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return;
  }

  response.writeHead(200, { "Content-Length": String(asset.body.length) });
  response.end(request.method === "HEAD" ? undefined : asset.body);
}

function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  assets: ReadonlyMap<string, LoadedAsset>,
): void {
  setCorsHeaders(response);

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendText(request, response, 405, "Method Not Allowed\n", {
      Allow: "GET, HEAD",
    });
    return;
  }

  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  if (pathname === "/healthz") {
    sendText(request, response, 200, "ok\n");
    return;
  }

  const asset = assets.get(pathname);
  if (!asset) {
    sendText(request, response, 404, "Not Found\n");
    return;
  }

  sendAsset(request, response, asset);
}

async function loadAssets(): Promise<Map<string, LoadedAsset>> {
  const loaded = await Promise.all(
    [...FILE_ROUTES].map(async ([route, definition]) => {
      const body = await readFile(path.join(PUBLIC_ROOT, definition.path));
      const sha256 = createHash("sha256").update(body).digest("hex");
      return [
        route,
        {
          body,
          contentType: definition.contentType,
          etag: `"sha256-${sha256}"`,
        },
      ] as const;
    }),
  );
  return new Map(loaded);
}

export async function startMediaServer(): Promise<StartedMediaServer> {
  const assets = await loadAssets();
  const server = createServer((request, response) => {
    handleRequest(request, response, assets);
  });

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
    throw new Error("Media fixture server did not bind to a TCP port");
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    close: async () => {
      if (!server.listening) return;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
