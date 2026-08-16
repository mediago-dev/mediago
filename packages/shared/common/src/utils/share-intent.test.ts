import { expect, test } from "vitest";
import { DownloadType } from "../types";
import {
  ELECTRON_SHARE_PROTOCOLS,
  WEB_SHARE_PROTOCOLS,
  extractFirstHttpUrl,
  inferDownloadType,
  isFreshShareIntent,
  normalizeShareIntent,
} from "./share-intent";

test("infers download types from parsed hostnames and paths", () => {
  expect(inferDownloadType("https://www.bilibili.com/video/BV1")).toBe(
    DownloadType.bilibili,
  );
  expect(inferDownloadType("https://youtu.be/example")).toBe(
    DownloadType.youtube,
  );
  expect(
    inferDownloadType("https://media.example/live/index.m3u8?token=abc"),
  ).toBe(DownloadType.m3u8);
  expect(
    inferDownloadType("https://example.com/video.mp4?next=bilibili.com"),
  ).toBe(DownloadType.direct);
});

test("normalizes supported share intents and rejects unsafe web protocols", () => {
  const intent = normalizeShareIntent(
    {
      id: "intent-1",
      source: "web",
      createdAt: 100,
      url: " https://example.com/video.mp4?token=a&b=c ",
      name: " Episode 1 ",
      type: "M3U8",
    },
    { allowedProtocols: WEB_SHARE_PROTOCOLS, now: 100 },
  );

  expect(intent).toStrictEqual({
    id: "intent-1",
    version: 1,
    source: "web",
    createdAt: 100,
    url: "https://example.com/video.mp4?token=a&b=c",
    name: "Episode 1",
    type: DownloadType.m3u8,
    warning: undefined,
  });
  expect(
    normalizeShareIntent(
      { source: "web", url: "file:///C:/private/video.mp4" },
      { allowedProtocols: WEB_SHARE_PROTOCOLS },
    ),
  ).toBe(null);
  expect(
    normalizeShareIntent(
      { source: "electron", url: "file:///C:/video.mp4" },
      { allowedProtocols: ELECTRON_SHARE_PROTOCOLS },
    ),
  ).not.toBe(null);
});

test("extracts shared URLs and expires stale intents", () => {
  expect(
    extractFirstHttpUrl("Watch this: https://example.com/video.m3u8)."),
  ).toBe("https://example.com/video.m3u8");

  const intent = normalizeShareIntent(
    {
      id: "intent-2",
      source: "web",
      createdAt: 1_000,
      url: "https://example.com/video.mp4",
    },
    { now: 1_000 },
  );
  if (!intent) {
    throw new Error("Expected a normalized share intent");
  }
  expect(isFreshShareIntent(intent, 1_001)).toBe(true);
  expect(isFreshShareIntent(intent, 1_000 + 16 * 60 * 1_000)).toBe(false);
});
