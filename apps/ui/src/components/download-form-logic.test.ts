import { DownloadType } from "@mediago/shared-common";
import { expect, test } from "vitest";
import {
  buildBatchDownloadTasks,
  buildDownloadTasks,
  createDownloadFormValues,
  DOWNLOAD_URL_RE,
  parseBatchDownloadRows,
} from "./download-form-logic";

test("accepts supported download URL schemes", () => {
  expect(DOWNLOAD_URL_RE.test("https://example.com/video.m3u8")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("file://C:/video.mp4")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("magnet:?xt=urn:btih:abc")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("javascript:alert(1)")).toBe(false);
});

test("fills form defaults without replacing supplied values", () => {
  expect(createDownloadFormValues({ name: "episode" })).toStrictEqual({
    batch: false,
    batchList: "",
    folder: "",
    headers: "",
    name: "episode",
    type: DownloadType.m3u8,
    url: "",
  });
});

test("ignores blank lines and accepts repeated whitespace", () => {
  expect(
    parseBatchDownloadRows(
      "\nhttps://a.example/1.m3u8   episode-1   season-1\n\thttps://a.example/2.m3u8\t episode-2\n",
    ),
  ).toStrictEqual([
    {
      line: 2,
      url: "https://a.example/1.m3u8",
      name: "episode-1",
      folder: "season-1",
      valid: true,
    },
    {
      line: 3,
      url: "https://a.example/2.m3u8",
      name: "episode-2",
      folder: "",
      valid: true,
    },
  ]);
});

test("rejects rows with more than three columns", () => {
  const [row] = parseBatchDownloadRows(
    "https://a.example/1.m3u8 one folder unexpected",
  );
  expect(row.valid).toBe(false);
});

test("builds tasks without leaking preview-only fields", () => {
  const rows = parseBatchDownloadRows("https://a.example/1.m3u8 one folder");
  expect(
    buildBatchDownloadTasks(rows, DownloadType.m3u8, "Referer: example.com"),
  ).toStrictEqual([
    {
      url: "https://a.example/1.m3u8",
      name: "one",
      folder: "folder",
      headers: "Referer: example.com",
      type: DownloadType.m3u8,
    },
  ]);
});

test("builds one task from single-download form values", () => {
  expect(
    buildDownloadTasks({
      name: "episode",
      url: "https://a.example/1.m3u8",
      type: DownloadType.m3u8,
      folder: "season",
    }),
  ).toStrictEqual([
    {
      name: "episode",
      url: "https://a.example/1.m3u8",
      headers: undefined,
      type: DownloadType.m3u8,
      folder: "season",
    },
  ]);
});
