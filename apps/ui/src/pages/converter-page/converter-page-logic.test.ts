import { expect, test } from "vitest";
import {
  appendStagedMediaFiles,
  createStagedMediaFile,
  getConversionErrorKey,
  getConversionStatusKey,
  getPathExtension,
  getPathFileName,
  isConversionCancelled,
} from "./converter-page-logic";

test("extracts file names and extensions from Windows and POSIX paths", () => {
  expect(getPathFileName("C:\\Media\\demo.MP4")).toBe("demo.MP4");
  expect(getPathFileName("/media/episode.wav")).toBe("episode.wav");
  expect(getPathExtension("C:\\Media\\demo.MP4")).toBe("mp4");
});

test("classifies supported video and audio files", () => {
  expect(createStagedMediaFile("C:\\Media\\demo.mp4")).toStrictEqual({
    path: "C:\\Media\\demo.mp4",
    name: "demo.mp4",
    extension: "mp4",
    kind: "video",
  });
  expect(createStagedMediaFile("C:\\Media\\notes.txt")).toBe(null);
  expect(createStagedMediaFile("")).toBe(null);
});

test("adds unique media files while reporting duplicates and invalid files", () => {
  const first = createStagedMediaFile("C:\\Media\\demo.mp4");
  if (!first) {
    throw new Error("Expected demo.mp4 to produce a staged media file");
  }

  const result = appendStagedMediaFiles(
    [first],
    ["c:/media/DEMO.mp4", "C:\\Media\\episode.wav", "C:\\Media\\notes.txt"],
  );

  expect(result.added).toBe(1);
  expect(result.duplicates).toBe(1);
  expect(result.rejected).toBe(1);
  expect(result.files.length).toBe(2);
});

test("maps backend conversion statuses to converter-specific labels", () => {
  expect(getConversionStatusKey("pending")).toBe("conversionStatusPending");
  expect(getConversionStatusKey("done")).toBe("conversionStatusDone");
  expect(getConversionStatusKey("unexpected")).toBe("conversionStatusUnknown");
  expect(getConversionStatusKey("failed", "conversion cancelled")).toBe(
    "conversionStatusCancelled",
  );
});

test("normalizes backend conversion errors for localized presentation", () => {
  expect(isConversionCancelled("cancelled by user")).toBe(true);
  expect(isConversionCancelled("conversion cancelled")).toBe(true);
  expect(getConversionErrorKey("ffmpeg binary path not configured")).toBe(
    "conversionErrorUnavailable",
  );
  expect(getConversionErrorKey("failed to start ffmpeg: access denied")).toBe(
    "conversionErrorStartFailed",
  );
  expect(getConversionErrorKey("source file has no audio stream")).toBe(
    "conversionErrorNoAudioStream",
  );
  expect(getConversionErrorKey("ffmpeg failed: exit status 1")).toBe(
    "conversionErrorUnknown",
  );
});
