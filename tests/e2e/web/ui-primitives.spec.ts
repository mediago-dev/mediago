import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "@playwright/test";
import { assertPortFree } from "../support/ports";

const fixture = fileURLToPath(
  new URL("../../fixtures/ui-primitives/index.html", import.meta.url),
).replaceAll("\\", "/");
const baseURL = "http://127.0.0.1:8501";
let stopUI: (() => Promise<void>) | undefined;
let previousTarget: string | undefined;

test.beforeAll(async () => {
  previousTarget = process.env.APP_TARGET;
  process.env.APP_TARGET = "server";
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const require = createRequire(path.join(root, "apps/ui/package.json"));
  const { createServer } = await import(
    pathToFileURL(require.resolve("vite")).href
  );
  await assertPortFree("127.0.0.1", 8501, "UI primitives regression");
  const server = await createServer({
    root: path.join(root, "apps/ui"),
    configFile: path.join(root, "apps/ui/vite.config.ts"),
    server: { host: "127.0.0.1", port: 8501, strictPort: true },
  });
  stopUI = () => server.close();
  await server.listen();
});

test.afterAll(async () => {
  await stopUI?.();
  if (previousTarget === undefined) delete process.env.APP_TARGET;
  else process.env.APP_TARGET = previousTarget;
});

test.beforeEach(async ({ page }) => {
  await page.goto(baseURL + "/@fs/" + fixture);
  await expect(
    page.getByRole("heading", { name: "MediaGo UI interaction regression" }),
  ).toBeVisible();
});

test("keeps nested dialog focus, translated select labels and dismiss behavior", async ({
  page,
}) => {
  const trigger = page.getByRole("button", {
    name: "Open preferences",
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Preferences", exact: true });
  await expect(
    dialog.getByRole("textbox", { name: "Name", exact: true }),
  ).toBeFocused();
  const language = dialog.getByRole("combobox", { name: "Language" });
  await expect(language).toHaveText("简体中文");
  await language.click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(language).toHaveText("English");
  await dialog.getByRole("button", { name: "Advanced", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Advanced name" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Advanced preferences" }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Advanced", exact: true }),
  ).toBeFocused();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.mouse.click(5, 5);
  await expect(dialog).toHaveCount(0);
  expect(await page.locator("button button").count()).toBe(0);
});

test("supports mixed checkbox, keyboard switches, radios and disabled cursors", async ({
  page,
}, testInfo) => {
  const checkbox = page.getByRole("checkbox", {
    name: "Select files",
    exact: true,
  });
  await expect(checkbox).toBeChecked({ indeterminate: true });
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  const disabled = page.getByRole("checkbox", { name: "Unavailable file" });
  await expect(disabled).toBeDisabled();
  await expect(disabled).toHaveCSS("cursor", "not-allowed");
  const toggle = page.getByRole("switch", { name: "Automatic updates" });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).toBeChecked();
  await page.getByRole("radio", { name: "Normal", exact: true }).focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("radio", { name: "Fast", exact: true }),
  ).toBeChecked();
  const disabledLink = page.getByRole("button", { name: "Disabled link" });
  await expect(disabledLink).toBeDisabled();
  await expect(disabledLink).toHaveCSS("cursor", "not-allowed");
  await expect(
    page.getByRole("progressbar", { name: "Download progress" }),
  ).toHaveAttribute("aria-valuenow", "25");
  const progressRatio = await page
    .locator('[data-slot="progress-indicator"]')
    .evaluate((element) => {
      const track = element.parentElement;
      if (!track) throw new Error("Missing progress track");
      return (
        element.getBoundingClientRect().width /
        track.getBoundingClientRect().width
      );
    });
  expect(progressRatio).toBeCloseTo(0.25, 2);
  await page.screenshot({
    path: testInfo.outputPath("base-ui-controls.png"),
    fullPage: true,
  });
});

test("fires menu actions once with keyboard and preserves submenus", async ({
  page,
}) => {
  const trigger = page.getByRole("button", { name: "Actions", exact: true });
  await trigger.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Refresh", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Action count")).toHaveText("1");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await expect(
    page.getByRole("menuitem", { name: "Unavailable action" }),
  ).toBeDisabled();
  await page.getByRole("menuitem", { name: "More actions" }).hover();
  await page.getByRole("menuitem", { name: "Export", exact: true }).click();
  await expect(page.getByLabel("Action count")).toHaveText("11");
  await page.getByText("Extension name", { exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Extension name" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Extension action" }).click();
  await expect(page.getByLabel("Action count")).toHaveText("111");
});

test("shows tooltip and preview content and scrolls the player sheet", async ({
  page,
}) => {
  await page
    .getByRole("button", { name: "Download shortcuts", exact: true })
    .hover();
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(
    "Download shortcuts",
  );
  await page.getByRole("button", { name: "Preview", exact: true }).hover();
  await expect(
    page.getByText("Local download preview", { exact: true }),
  ).toBeVisible();
  const infoTrigger = page.getByRole("button", {
    name: "About statistics",
    exact: true,
  });
  await infoTrigger.focus();
  await page.keyboard.press("Enter");
  const info = page.getByRole("dialog", {
    name: "Statistics information",
    exact: true,
  });
  await expect(info).toContainText("Statistics are optional.");
  await info
    .getByRole("button", { name: "Privacy policy", exact: true })
    .click();
  await expect(page.getByLabel("Action count")).toHaveText("1");
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);
  await expect(infoTrigger).toBeFocused();
  await page.getByRole("button", { name: "Playlist", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Playlist", exact: true });
  await expect(sheet).toBeVisible();
  const viewport = sheet.locator("[data-slot=scroll-area-viewport]");
  await viewport.evaluate((element) => {
    element.scrollTop = 200;
  });
  await expect
    .poll(() => viewport.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Playlist", exact: true }),
  ).toBeFocused();
});
