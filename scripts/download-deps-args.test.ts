import { describe, expect, test } from "vitest";
import { selectToolsFromArgs } from "./download-deps-args.ts";

const AVAILABLE_TOOLS = [
  "ffmpeg",
  "N_m3u8DL-RE",
  "BBDown",
  "aria2",
  "yt-dlp",
  "mediago",
];

describe("selectToolsFromArgs", () => {
  test("returns every available tool when --tools is omitted", () => {
    expect(selectToolsFromArgs(["--all"], AVAILABLE_TOOLS)).toEqual(
      AVAILABLE_TOOLS,
    );
  });

  test("selects space-separated tools in manifest order", () => {
    expect(
      selectToolsFromArgs(
        ["--tools", "aria2,N_m3u8DL-RE,ffmpeg"],
        AVAILABLE_TOOLS,
      ),
    ).toEqual(["ffmpeg", "N_m3u8DL-RE", "aria2"]);
  });

  test("selects equals-separated tools in manifest order", () => {
    expect(
      selectToolsFromArgs(
        ["--tools=aria2,ffmpeg", "--platform", "linux-x64"],
        AVAILABLE_TOOLS,
      ),
    ).toEqual(["ffmpeg", "aria2"]);
  });

  test("selects BBDown by itself", () => {
    expect(selectToolsFromArgs(["--tools", "BBDown"], AVAILABLE_TOOLS)).toEqual(
      ["BBDown"],
    );
  });

  test("trims and de-duplicates tool names", () => {
    expect(
      selectToolsFromArgs(
        ["--tools", " aria2, ffmpeg,aria2 , ffmpeg "],
        AVAILABLE_TOOLS,
      ),
    ).toEqual(["ffmpeg", "aria2"]);
  });

  test.each([["--tools"], ["--tools="], ["--tools", "  ,  "]])(
    "rejects a missing or empty --tools value: %j",
    (...argv) => {
      const selectTools = () => selectToolsFromArgs(argv, AVAILABLE_TOOLS);
      expect(selectTools).toThrow(
        /--tools requires a non-empty comma-separated value/i,
      );
      expect(selectTools).toThrow(
        `Available tools: ${AVAILABLE_TOOLS.join(", ")}`,
      );
    },
  );

  test("rejects unknown tools and lists every valid tool", () => {
    expect(() =>
      selectToolsFromArgs(["--tools", "missing"], AVAILABLE_TOOLS),
    ).toThrow(
      `Unknown tool "missing". Available tools: ${AVAILABLE_TOOLS.join(", ")}`,
    );
  });

  test("rejects repeated --tools options", () => {
    expect(() =>
      selectToolsFromArgs(
        ["--tools=aria2", "--tools", "ffmpeg"],
        AVAILABLE_TOOLS,
      ),
    ).toThrow(/--tools may only be specified once/i);
  });
});
