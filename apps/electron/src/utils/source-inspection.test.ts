import { expect, test } from "vitest";
import {
  formattedHeadersToArray,
  inspectionToMediaInfo,
} from "./source-inspection";

test("normalizes multiline sniffed headers", () => {
  expect(
    formattedHeadersToArray(
      "Referer: https://example.com/watch/video\r\nUser-Agent: Test\r\n\r\n",
    ),
  ).toStrictEqual([
    "Referer: https://example.com/watch/video",
    "User-Agent: Test",
  ]);
});

test("maps successful and failed inspections to UI metadata", () => {
  expect(
    inspectionToMediaInfo({
      id: "source-1",
      url: "https://media.example/master.m3u8",
      playlistType: "master",
      maxQuality: "1080p",
      variants: [{ url: "https://media.example/1080.m3u8", quality: "1080p" }],
    }),
  ).toStrictEqual({
    status: "ready",
    playlistType: "master",
    maxQuality: "1080p",
    variants: [{ url: "https://media.example/1080.m3u8", quality: "1080p" }],
  });
  expect(
    inspectionToMediaInfo({
      id: "source-2",
      url: "https://media.example/invalid.m3u8",
      playlistType: "unknown",
      variants: [],
      error: "unavailable",
    }).status,
  ).toBe("failed");
});
