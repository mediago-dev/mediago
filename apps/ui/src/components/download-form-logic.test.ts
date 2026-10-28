import { DownloadType } from "@mediago/common";
import { expect, test } from "vitest";
import {
  buildBatchDownloadTasks,
  buildDownloadTasks,
  createDownloadFormValues,
  DOWNLOAD_URL_RE,
  parseBatchDownloadRows,
  resolveSmartSubmitMode,
  resolveEditTaskId,
  resolveDownloadTaskType,
} from "./download-form-logic";
import { SMART_DOWNLOAD_TYPE } from "@/store/download-dialog";

test("accepts supported download URL schemes", () => {
  expect(DOWNLOAD_URL_RE.test("https://example.com/video.m3u8")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("file://C:/video.mp4")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("magnet:?xt=urn:btih:abc")).toBe(true);
  expect(DOWNLOAD_URL_RE.test("javascript:alert(1)")).toBe(false);
});

test("fills form defaults without replacing supplied values", () => {
  expect(createDownloadFormValues({ name: "episode" })).toStrictEqual({
    downloadTarget: "local",
    proxyMode: "inherit",
    proxyUrl: "",
    batch: false,
    batchList: "",
    folder: "",
    headers: "",
    name: "episode",
    type: SMART_DOWNLOAD_TYPE,
    url: "",
  });
});

test("resolves smart download to the best task type for non-discovery submissions", () => {
  expect(
    resolveDownloadTaskType(
      SMART_DOWNLOAD_TYPE,
      "https://www.bilibili.com/video/BV1example",
    ),
  ).toBe(DownloadType.bilibili);
  expect(
    resolveDownloadTaskType(
      SMART_DOWNLOAD_TYPE,
      "https://cdn.example.com/video.mp4",
    ),
  ).toBe(DownloadType.direct);
});

test("maps the legacy Xiaohongshu form value to the unified yt-dlp option", () => {
  expect(
    createDownloadFormValues({
      type: DownloadType.xiaohongshu,
      url: "https://www.xiaohongshu.com/explore/note-id",
    }).type,
  ).toBe(DownloadType.youtube);
});

test("resolves the unified yt-dlp option to the URL-specific internal type", () => {
  expect(
    resolveDownloadTaskType(
      DownloadType.youtube,
      "https://www.xiaohongshu.com/explore/note-id?xsec_token=token",
    ),
  ).toBe(DownloadType.xiaohongshu);
  expect(
    resolveDownloadTaskType(
      DownloadType.youtube,
      "https://www.youtube.com/watch?v=video-id",
    ),
  ).toBe(DownloadType.youtube);
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

test("infers each URL independently for a mixed yt-dlp batch", () => {
  const rows = parseBatchDownloadRows(
    "https://www.youtube.com/watch?v=one youtube\nhttps://www.xiaohongshu.com/explore/note-id?xsec_token=token xhs",
  );

  expect(
    buildBatchDownloadTasks(rows, DownloadType.youtube).map(
      (task) => task.type,
    ),
  ).toStrictEqual([DownloadType.youtube, DownloadType.xiaohongshu]);
});

test("infers each URL independently for a smart batch", () => {
  const rows = parseBatchDownloadRows(
    "https://www.bilibili.com/video/BV1example bili\nhttps://www.xiaohongshu.com/explore/note-id?xsec_token=token xhs\nhttps://cdn.example.com/video.mp4 direct",
  );

  expect(
    buildBatchDownloadTasks(rows, SMART_DOWNLOAD_TYPE).map((task) => task.type),
  ).toStrictEqual([
    DownloadType.bilibili,
    DownloadType.xiaohongshu,
    DownloadType.direct,
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
      proxyMode: "inherit",
      proxyUrl: "",
      name: "episode",
      url: "https://a.example/1.m3u8",
      headers: undefined,
      type: DownloadType.m3u8,
      folder: "season",
    },
  ]);
});

test("preserves a custom proxy for every local batch task and strips it for Docker", () => {
  const values = createDownloadFormValues({
    batch: true,
    batchList: "https://a.example/one.m3u8 one\nhttps://a.example/two.m3u8 two",
    proxyMode: "custom",
    proxyUrl: " http://127.0.0.1:7890 ",
  });
  for (const task of buildDownloadTasks(values)) {
    expect(task).toMatchObject({
      proxyMode: "custom",
      proxyUrl: "http://127.0.0.1:7890",
    });
  }
  for (const task of buildDownloadTasks(values, "docker")) {
    expect(task).not.toHaveProperty("proxyMode");
    expect(task).not.toHaveProperty("proxyUrl");
  }
  expect(
    buildDownloadTasks({ ...values, proxyMode: "direct" })[0].proxyUrl,
  ).toBe("");
  expect(
    createDownloadFormValues({ origin: "docker", id: 1 }).downloadTarget,
  ).toBe("docker");
});

test("treats NaN or missing ids as new tasks instead of edit targets", () => {
  expect(resolveEditTaskId(42)).toBe(42);
  expect(resolveEditTaskId(Number.NaN)).toBeUndefined();
  expect(resolveEditTaskId(undefined)).toBeUndefined();
});

test("selects the submit inspection mode for new single HTTP URLs", () => {
  expect(
    resolveSmartSubmitMode(
      {
        batch: false,
        type: DownloadType.m3u8,
        url: "https://example.com/watch",
      },
      false,
    ),
  ).toBe("hls-only");
  expect(
    resolveSmartSubmitMode(
      {
        batch: false,
        type: SMART_DOWNLOAD_TYPE,
        url: "https://example.com/watch",
      },
      false,
    ),
  ).toBe("smart");
  expect(
    resolveSmartSubmitMode(
      {
        batch: true,
        type: SMART_DOWNLOAD_TYPE,
        url: "https://example.com/watch",
      },
      false,
    ),
  ).toBeUndefined();
  expect(
    resolveSmartSubmitMode(
      {
        batch: false,
        type: DownloadType.direct,
        url: "https://example.com/video",
      },
      false,
    ),
  ).toBeUndefined();
  expect(
    resolveSmartSubmitMode(
      { batch: false, type: DownloadType.m3u8, url: "file:///tmp/video.m3u8" },
      false,
    ),
  ).toBeUndefined();
});
