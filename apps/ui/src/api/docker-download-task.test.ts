import { DownloadStatus, DownloadType } from "@mediago/common";
import { afterEach, expect, test, vi } from "vitest";
import { http } from "@/utils";
import { getDockerTasks } from "./docker-download-task";

afterEach(() => vi.restoreAllMocks());

test("returns a valid Docker task page without changing its tasks", async () => {
  const page = {
    list: [
      {
        id: 1,
        name: "video",
        url: "https://example.com/video.mp4",
        type: DownloadType.direct,
        status: DownloadStatus.Downloading,
      },
    ],
    total: 1,
  };
  const get = vi.spyOn(http, "get").mockResolvedValue(page);
  const params = { current: 1, pageSize: 20 };

  await expect(getDockerTasks(params)).resolves.toBe(page);
  expect(get).toHaveBeenCalledWith("/api/docker/downloads", { params });
});

test.each([
  undefined,
  null,
  {},
  { total: 0 },
  { list: null, total: 0 },
  { list: {}, total: 0 },
  { list: [] },
  { list: [], total: "0" },
  "<html>loading</html>",
])(
  "rejects an invalid task page so SWR can use its offline fallback: %j",
  async (value) => {
    vi.spyOn(http, "get").mockResolvedValue(value);

    await expect(getDockerTasks({ current: 1 })).rejects.toThrow(
      "Invalid Docker task response",
    );
  },
);
