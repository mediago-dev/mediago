import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { assertPortFree } from "../support/ports";

const baseURL = "http://127.0.0.1:8501";
const fixture = fileURLToPath(
  new URL("../../fixtures/docker-actions/index.html", import.meta.url),
).replaceAll("\\", "/");
const fixtureURL = `${baseURL}/@fs${fixture.startsWith("/") ? fixture : "/" + fixture}`;
let close: (() => Promise<void>) | undefined;
let previousTarget: string | undefined;
test.beforeAll(async () => {
  previousTarget = process.env.APP_TARGET;
  process.env.APP_TARGET = "server";
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const require = createRequire(path.join(root, "apps/ui/package.json"));
  const { createServer } = await import(
    pathToFileURL(require.resolve("vite")).href
  );
  await assertPortFree("127.0.0.1", 8501, "Docker actions regression UI");
  const server = await createServer({
    root: path.join(root, "apps/ui"),
    configFile: path.join(root, "apps/ui/vite.config.ts"),
    server: { host: "127.0.0.1", port: 8501, strictPort: true },
  });
  close = () => server.close();
  await server.listen();
});
test.afterAll(async () => {
  await close?.();
  if (previousTarget === undefined) delete process.env.APP_TARGET;
  else process.env.APP_TARGET = previousTarget;
});

test("sends selected source directly to Docker without opening an edit dialog", async ({
  page,
}, testInfo) => {
  const requests: { url: string; body: unknown }[] = [];
  await page.route("http://127.0.0.1:9900/api/**", async (route) => {
    requests.push({
      url: route.request().url(),
      body: route.request().postDataJSON(),
    });
    await route.fulfill({ json: { success: true, code: 200, data: [] } });
  });
  await page.goto(fixtureURL);
  await page.getByRole("combobox", { name: "清晰度: 示例视频" }).click();
  await page.getByRole("option", { name: "720p", exact: true }).click();
  await page
    .getByRole("button", { name: "添加到 Docker", exact: true })
    .click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({
    url: "http://127.0.0.1:9900/api/docker/downloads",
    body: {
      tasks: [
        {
          url: "https://example.com/720.m3u8",
          name: "示例视频",
          headers: "Referer: https://example.com/watch",
          type: "m3u8",
          folder: "",
        },
      ],
      startDownload: false,
    },
  });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("source-docker-action.png"),
  });
});

test("offers Docker send from local edit and retains remote edit semantics", async ({
  page,
}, testInfo) => {
  const writes: { url: string; method: string; body: unknown }[] = [];
  await page.route("http://127.0.0.1:9900/api/**", async (route) => {
    const request = route.request();
    if (request.method() !== "GET")
      writes.push({
        url: request.url(),
        method: request.method(),
        body: request.postDataJSON(),
      });
    await route.fulfill({ json: { success: true, code: 200, data: [] } });
  });
  await page.goto(fixtureURL);
  await page.getByRole("button", { name: "编辑本地任务", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("视频名称").fill("修改后的名称");
  await dialog.screenshot({
    path: testInfo.outputPath("local-edit-docker-action.png"),
  });
  await dialog
    .getByRole("button", { name: "添加到 Docker", exact: true })
    .click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({
    url: "http://127.0.0.1:9900/api/docker/downloads",
    method: "POST",
    body: {
      tasks: [
        {
          name: "修改后的名称",
          url: "https://example.com/video.mp4",
          type: "direct",
          folder: "series",
        },
      ],
      startDownload: false,
    },
  });
  await page
    .getByRole("button", { name: "编辑 Docker 任务", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "添加到 Docker", exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1]).toMatchObject({
    url: "http://127.0.0.1:9900/api/docker/downloads/42",
    method: "PUT",
  });
});
