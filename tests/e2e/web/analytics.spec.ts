import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";
import { assertPortFree } from "../support/ports";

const baseURL = "http://127.0.0.1:8501";
let stopUI: (() => Promise<void>) | undefined;
const fixture = fileURLToPath(
  new URL("../../fixtures/analytics/index.html", import.meta.url),
).replaceAll("\\", "/");
let previousID: string | undefined;
let previousTarget: string | undefined;
test.beforeAll(async () => {
  previousID = process.env.APP_TD_APPID;
  previousTarget = process.env.APP_TARGET;
  process.env.APP_TD_APPID = "mediago-test-only";
  process.env.APP_TARGET = "server";
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const require = createRequire(path.join(root, "apps/ui/package.json"));
  const { createServer } = await import(
    pathToFileURL(require.resolve("vite")).href
  );
  await assertPortFree("127.0.0.1", 8501, "Analytics regression UI");
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
  if (previousID === undefined) delete process.env.APP_TD_APPID;
  else process.env.APP_TD_APPID = previousID;
  if (previousTarget === undefined) delete process.env.APP_TARGET;
  else process.env.APP_TARGET = previousTarget;
});
test("refusal never loads SDK and remains off after reload", async ({
  page,
  context,
}, testInfo) => {
  let scripts = 0;
  await context.route("https://jic.talkingdata.com/**", (route) => {
    scripts += 1;
    return route.abort();
  });
  await page.goto(baseURL + "/@fs/" + fixture);
  await page
    .getByRole("region", { name: "Optional usage statistics", exact: true })
    .screenshot({ path: testInfo.outputPath("statistics-choice.png") });
  await page
    .getByRole("button", { name: "Continue without statistics", exact: true })
    .click();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "Share usage statistics", exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("region", {
      name: "Optional usage statistics",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(scripts).toBe(0);
});

test("opens statistics details and privacy policy access from the keyboard", async ({
  page,
}, testInfo) => {
  await page.goto(baseURL + "/@fs/" + fixture);
  await page
    .getByRole("button", { name: "Continue without statistics", exact: true })
    .click();
  const help = page.getByRole("button", {
    name: /Share usage statistics.*Help/i,
  });
  await help.focus();
  await page.keyboard.press("Enter");
  const info = page.getByRole("dialog", {
    name: "Share usage statistics",
    exact: true,
  });
  await expect(info).toContainText("TalkingData");
  await expect(
    info.getByRole("button", { name: "Privacy policy", exact: true }),
  ).toBeVisible();
  await info.screenshot({
    path: testInfo.outputPath("statistics-info-tip.png"),
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(info).toHaveCount(0);
  await expect(help).toBeFocused();
});

test("allows statistics then stops SDK timers in all tabs on withdrawal", async ({
  page,
  context,
}, testInfo) => {
  let scripts = 0;
  let ticks = 0;
  const events: unknown[] = [];
  await context.route("https://analytics.invalid/**", (route) => {
    if (route.request().url().endsWith("/tick")) ticks += 1;
    else events.push(JSON.parse(route.request().postData() || "null"));
    return route.fulfill({
      status: 200,
      body: "",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await context.route("https://jic.talkingdata.com/**", (route) => {
    scripts += 1;
    return route.fulfill({
      contentType: "application/javascript",
      body: `
      window.TDAPP = {onEvent(...args) {fetch("https://analytics.invalid/event", {method:"POST", body:JSON.stringify(args)})}};
      setInterval(() => fetch("https://analytics.invalid/tick"), 50);
    `,
    });
  });
  const url = baseURL + "/@fs/" + fixture;
  await page.goto(url);
  await page
    .getByRole("button", { name: "Allow statistics", exact: true })
    .click();
  await expect.poll(() => ticks).toBeGreaterThan(2);
  expect(scripts).toBe(1);
  await page.getByRole("button", { name: "Send test event" }).click();
  await expect.poll(() => events.length).toBe(1);
  expect(events[0]).toEqual(["DOWNLOAD_NOW", "", {}]);
  const other = await context.newPage();
  await other.goto(url);
  await expect(
    other.getByRole("switch", { name: "Share usage statistics", exact: true }),
  ).toBeChecked();
  await expect.poll(() => scripts).toBe(2);
  await page
    .getByRole("switch", { name: "Share usage statistics", exact: true })
    .uncheck();
  for (const tab of [page, other]) {
    await expect(
      tab.getByRole("switch", { name: "Share usage statistics", exact: true }),
    ).not.toBeChecked();
    await expect(
      tab.getByRole("region", {
        name: "Optional usage statistics",
        exact: true,
      }),
    ).toHaveCount(0);
  }
  const afterReload = ticks;
  await page.waitForTimeout(400);
  expect(ticks).toBe(afterReload);
  expect(scripts).toBe(2);
  await page.screenshot({
    path: testInfo.outputPath("statistics-disabled.png"),
    fullPage: true,
  });
  await other.close();
});
