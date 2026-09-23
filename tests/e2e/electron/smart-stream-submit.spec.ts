import type { ElectronApplication, Page } from "@playwright/test";
import { electronTest as test, expect } from "../support/electron-app.ts";

async function submitStream(page: Page, name: string, url: string) {
  await page.locator('aside a[href="/"]').click();
  await page
    .locator("header")
    .getByRole("button", { name: "New download", exact: true })
    .click();
  await page.getByLabel("Video name").fill(name);
  await page.getByLabel("Video link").fill(url);
  await page.getByRole("button", { name: "Add to list" }).click();
}

async function materialExtractionWindow(
  application: ElectronApplication,
): Promise<Page> {
  await expect
    .poll(() =>
      application
        .windows()
        .some(
          (candidate) => candidate.url() === "http://localhost:8500/browser",
        ),
    )
    .toBe(true);
  const page = application
    .windows()
    .find((candidate) => candidate.url() === "http://localhost:8500/browser");
  if (!page) throw new Error("Material Extraction window was not available");
  await expect(
    page.getByRole("tablist", { name: "Browser tabs" }),
  ).toBeVisible();
  return page;
}

test("recognizes suffixless HLS in the dedicated discovery dialog", async ({
  electronRuntime,
}) => {
  const { client, media, page } = electronRuntime;
  await submitStream(page, "Suffixless fixture", media.suffixlessHLSURL);

  await expect(
    page.getByRole("heading", { name: "New download" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Select media to download" }),
  ).toBeVisible();
  await page.getByRole("combobox", { name: /Quality:/ }).click();
  await page.getByRole("option", { name: /^720p/ }).click();
  await page.getByRole("button", { name: "Confirm and create" }).click();

  await expect
    .poll(async () => {
      const response = await client.getDownloadTasks({
        current: 1,
        pageSize: 20,
      });
      return response.data.list.find(
        (task) => task.name === "Suffixless fixture",
      )?.url;
    })
    .toBe(`${media.baseURL}/streams/720?token=fixture`);
});

test("shows webpage sniffing in a dedicated dialog before source selection", async ({
  electronRuntime,
}) => {
  const { client, media, page } = electronRuntime;
  await submitStream(page, "Embedded fixture", media.embeddedHLSPageURL);

  await expect(
    page.getByRole("status").filter({
      hasText: /Checking the stream URL|Discovering downloadable media/,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "New download" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("combobox", { name: /Quality: Embedded HLS Fixture/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("combobox", { name: /Quality: Embedded HLS Fixture/ })
    .click();
  await page.getByRole("option", { name: /^720p/ }).click();
  await page.getByRole("button", { name: "Confirm and create" }).click();

  await expect
    .poll(async () => {
      const response = await client.getDownloadTasks({
        current: 1,
        pageSize: 20,
      });
      return response.data.list.find(
        (task) => task.name === "Embedded HLS Fixture",
      )?.url;
    })
    .toBe(`${media.baseURL}/streams/720?fixture=embedded`);
});

test("moves m3u8 fallback into smart discovery without reopening the form", async ({
  electronRuntime,
}) => {
  const { client, media, page } = electronRuntime;
  await page.locator('aside a[href="/"]').click();
  await page
    .locator("header")
    .getByRole("button", { name: "New download", exact: true })
    .click();
  await page.getByLabel("Download type").click();
  await page.getByRole("option", { name: "Stream media (m3u8)" }).click();
  await page.getByLabel("Video name").fill("Prompt fixture");
  await page.getByLabel("Video link").fill(media.embeddedHLSPageURL);
  await page.getByRole("button", { name: "Add to list" }).click();

  await expect(
    page.getByRole("heading", { name: "No m3u8 stream detected" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Use Smart Download" }).click();
  await expect(
    page.getByRole("combobox", { name: /Quality: Embedded HLS Fixture/ }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "Confirm and create" }).click();

  await expect
    .poll(async () => {
      const response = await client.getDownloadTasks({
        current: 1,
        pageSize: 20,
      });
      return response.data.list.some(
        (task) => task.name === "Embedded HLS Fixture",
      );
    })
    .toBe(true);
});

test("offers interactive Material Extraction after discovery finds no resource", async ({
  electronRuntime,
}) => {
  const { application, media, page } = electronRuntime;
  await submitStream(
    page,
    "No resource fixture",
    media.redirectNoResourcePageURL,
  );

  await expect(
    page.getByRole("heading", { name: "No downloadable media found" }),
  ).toBeVisible({ timeout: 25_000 });
  await page.getByRole("button", { name: "Open Material Extraction" }).click();
  const extraction = await materialExtractionWindow(application);
  await expect(
    extraction.getByRole("tab", { name: /No Resource Fixture/ }),
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByRole("heading", { name: "New download" }),
  ).not.toBeVisible();
});

test("does not create a task when discovery has no selected resource", async ({
  electronRuntime,
}) => {
  const { application, client, media, page } = electronRuntime;
  await submitStream(page, "Cancelled fixture", media.noResourcePageURL);
  await expect(
    page.getByRole("heading", { name: "No downloadable media found" }),
  ).toBeVisible({ timeout: 25_000 });

  await expect
    .poll(async () => {
      const response = await client.getDownloadTasks({
        current: 1,
        pageSize: 20,
      });
      return response.data.list.some(
        (task) => task.name === "Cancelled fixture",
      );
    })
    .toBe(false);
  expect(
    application
      .windows()
      .some((candidate) => candidate.url() === "http://localhost:8500/browser"),
  ).toBe(false);
});
