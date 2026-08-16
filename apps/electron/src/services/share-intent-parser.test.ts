import { DownloadType } from "@mediago/shared-common";
import { expect, test } from "vitest";
import { parseShareIntentProtocolUrl } from "./share-intent-parser";

const SCHEME = "mediago-community";

test("parses canonical share links without losing nested query parameters", () => {
  const mediaUrl = "https://media.example/live.m3u8?token=a&expires=2";
  const query = new URLSearchParams({
    v: "1",
    url: mediaUrl,
    name: "Episode 1",
    type: "M3U8",
    headers: "should-not-be-forwarded",
  });

  const result = parseShareIntentProtocolUrl(
    `${SCHEME}://share?${query}`,
    SCHEME,
  );

  expect(result.handled).toBe(true);
  if (!result.intent) {
    throw new Error("Expected a share intent");
  }
  expect(result.intent.source).toBe("electron");
  expect(result.intent.url).toBe(mediaUrl);
  expect(result.intent.name).toBe("Episode 1");
  expect(result.intent.type).toBe(DownloadType.m3u8);
  expect("headers" in result.intent).toBe(false);
});

test("handles focus-only and unsupported-version links without an intent", () => {
  expect(parseShareIntentProtocolUrl(`${SCHEME}://open`, SCHEME)).toStrictEqual(
    {
      handled: true,
    },
  );
  expect(
    parseShareIntentProtocolUrl(`${SCHEME}://index.html/`, SCHEME),
  ).toStrictEqual({ handled: true });
  expect(
    parseShareIntentProtocolUrl(
      `${SCHEME}://share?v=2&url=https%3A%2F%2Fexample.com%2Fvideo.mp4`,
      SCHEME,
    ),
  ).toStrictEqual({ handled: true });
});

test("maps legacy automatic-action flags to a warning instead of executing them", () => {
  const mediaUrl = "https://example.com/video.mp4?token=a&part=1";
  const query = new URLSearchParams({
    n: "1",
    encodedURL: mediaUrl,
    name: "Legacy video",
    silent: "1",
    downloadNow: "1",
  });

  const result = parseShareIntentProtocolUrl(
    `${SCHEME}://index.html/?${query}`,
    SCHEME,
  );

  expect(result.handled).toBe(true);
  if (!result.intent) {
    throw new Error("Expected a legacy share intent");
  }
  expect(result.intent.source).toBe("legacy-electron");
  expect(result.intent.url).toBe(mediaUrl);
  expect(result.intent.warning).toBe("legacy-auto-action-disabled");
});

test("rejects unrelated targets and unsafe payloads", () => {
  expect(
    parseShareIntentProtocolUrl(
      "other://share?url=https://example.com",
      SCHEME,
    ),
  ).toStrictEqual({ handled: false });
  expect(
    parseShareIntentProtocolUrl(`${SCHEME}://unknown`, SCHEME),
  ).toStrictEqual({
    handled: false,
  });
  expect(
    parseShareIntentProtocolUrl(
      `${SCHEME}://share?v=1&url=javascript%3Aalert(1)`,
      SCHEME,
    ),
  ).toStrictEqual({ handled: true, intent: undefined });
});
