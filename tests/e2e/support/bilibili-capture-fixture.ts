import { readFile } from "node:fs/promises";
import {
  expect,
  type BrowserContext,
  type Locator,
  type Page,
  type Worker,
} from "@playwright/test";

export const BILIBILI_TASK_NAME = "MediaGo Bilibili Fixture";
export const BILIBILI_SOURCE_ID = "bilibili-controlled-source-fixture";
export const BILIBILI_SOURCE_URL =
  "https://www.bilibili.com/video/BV1MediaGoFixture";
export const BILIBILI_REFERER = "https://www.bilibili.com/";
export const BILIBILI_COOKIE = "SESSDATA=mediago-e2e-fixture; bili_jct=fixture";
export const BILIBILI_HEADERS = `Referer:${BILIBILI_REFERER}\nCookie:${BILIBILI_COOKIE}`;
export const MALFORMED_BILIBILI_RESPONSES = [
  {
    label: "missing Download ID",
    body: JSON.stringify({ success: true, data: [{}] }),
    error: /Invalid Download ID/,
  },
  {
    label: "string Download ID",
    body: JSON.stringify({ success: true, data: [{ id: "1" }] }),
    error: /Invalid Download ID/,
  },
  {
    label: "wrong response count",
    body: JSON.stringify({ success: true, data: [] }),
    error: /Invalid download import response count/,
  },
  {
    label: "non-JSON response",
    body: "not JSON",
    error: /JSON|Unexpected token|parse/i,
  },
] as const;

interface PopupFixtureOptions {
  context: BrowserContext;
  extensionURL(relativePath: string): string;
  localPageURL: string;
  trackPage(page: Page): void;
  worker: Worker;
}

export interface OpenedBilibiliPopup {
  popupPage: Page;
  sourceRow: Locator;
}

export interface CapturedRealBilibiliImport {
  postedBody?: unknown;
  realResponseBody?: unknown;
  requestCount: number;
}

function controlledBilibiliSource(documentURL: string) {
  return {
    id: BILIBILI_SOURCE_ID,
    url: BILIBILI_SOURCE_URL,
    documentURL,
    name: BILIBILI_TASK_NAME,
    type: "bilibili",
    headers: BILIBILI_HEADERS,
    detectedAt: 1_700_000_000_000,
  } as const;
}

export async function badgeTextForActiveTab(worker: Worker): Promise<string> {
  return worker.evaluate(async () => {
    const extensionChrome = (
      globalThis as typeof globalThis & {
        chrome: {
          action: {
            getBadgeText(options: { tabId: number }): Promise<string>;
          };
          tabs: {
            query(options: {
              active: boolean;
              currentWindow: boolean;
            }): Promise<Array<{ id?: number }>>;
          };
        };
      }
    ).chrome;
    const [tab] = await extensionChrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id === undefined) return "";
    return extensionChrome.action.getBadgeText({ tabId: tab.id });
  });
}

export async function enableImmediateDownload(
  optionsPage: Page,
): Promise<void> {
  const downloadNow = optionsPage.getByRole("switch", {
    name: "Start downloading immediately",
  });
  if ((await downloadNow.getAttribute("aria-checked")) !== "true") {
    await downloadNow.click();
    await expect(optionsPage.getByText("Saved", { exact: true })).toBeVisible();
  }
  await expect(downloadNow).toHaveAttribute("aria-checked", "true");
}

export async function injectControlledBilibiliSource(
  worker: Worker,
): Promise<void> {
  await worker.evaluate(
    async ({ source }) => {
      const extensionChrome = (
        globalThis as typeof globalThis & {
          chrome: {
            action: {
              setBadgeBackgroundColor(options: {
                tabId: number;
                color: string;
              }): Promise<void>;
              setBadgeText(options: {
                tabId: number;
                text: string;
              }): Promise<void>;
            };
            storage: {
              session: {
                set(items: Record<string, unknown>): Promise<void>;
              };
            };
            tabs: {
              query(options: {
                active: boolean;
                currentWindow: boolean;
              }): Promise<Array<{ id?: number; url?: string }>>;
            };
          };
        }
      ).chrome;
      const [tab] = await extensionChrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab?.id === undefined || !tab.url?.startsWith("http://127.0.0.1:")) {
        throw new Error(
          "Controlled Bilibili source requires a local active tab",
        );
      }
      await extensionChrome.storage.session.set({
        [`mediago.tab.${tab.id}`]: [{ ...source, documentURL: tab.url }],
      });
      await extensionChrome.action.setBadgeBackgroundColor({
        tabId: tab.id,
        color: "#ef4444",
      });
      await extensionChrome.action.setBadgeText({ tabId: tab.id, text: "1" });
    },
    { source: controlledBilibiliSource("") },
  );
}

export async function importControlledBilibiliSource(
  popupPage: Page,
): Promise<unknown> {
  return popupPage.evaluate(async (source) => {
    const extensionChrome = (
      globalThis as typeof globalThis & {
        chrome: {
          runtime: {
            sendMessage(message: unknown): Promise<unknown>;
          };
        };
      }
    ).chrome;
    return extensionChrome.runtime.sendMessage({
      type: "IMPORT_SOURCES",
      sources: [source],
    });
  }, controlledBilibiliSource("http://127.0.0.1/controlled-fixture"));
}

export async function clickBilibiliImport(sourceRow: Locator): Promise<void> {
  await sourceRow.getByRole("button", { name: "Import" }).click();
}

export async function openControlledBilibiliPopup(
  options: PopupFixtureOptions,
): Promise<OpenedBilibiliPopup> {
  const popupPage = await options.context.newPage();
  await popupPage.goto(options.extensionURL("src/popup/index.html"));

  const localPage = await options.context.newPage();
  options.trackPage(localPage);
  await localPage.goto(options.localPageURL);
  await localPage.bringToFront();
  await injectControlledBilibiliSource(options.worker);
  await expect
    .poll(() => badgeTextForActiveTab(options.worker), {
      timeout: 10_000,
      intervals: [100],
    })
    .toBe("1");

  await popupPage.reload();
  options.trackPage(popupPage);
  const sourceRow = popupPage
    .getByRole("listitem")
    .filter({ hasText: BILIBILI_TASK_NAME });
  await expect(sourceRow).toBeVisible();
  await expect(sourceRow.getByText("bilibili", { exact: true })).toBeVisible();
  return { popupPage, sourceRow };
}

export async function captureRealBilibiliImport(
  context: BrowserContext,
  coreBaseURL: string,
): Promise<CapturedRealBilibiliImport> {
  const capture: CapturedRealBilibiliImport = { requestCount: 0 };
  await context.route(`${coreBaseURL}/api/downloads`, async (route) => {
    capture.requestCount += 1;
    capture.postedBody = route.request().postDataJSON();
    const response = await route.fetch();
    capture.realResponseBody = await response.json();
    await route.fulfill({ response });
  });
  return capture;
}

export async function readBBDownArguments(
  filePath: string,
): Promise<string[][]> {
  try {
    return (await readFile(filePath, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export function expectNoInvalidDownloadIDRequests(
  urls: readonly string[],
): void {
  for (const value of urls) {
    expect(value).not.toContain("NaN");
    expect(value).not.toContain("undefined");
    expect(value).not.toContain(BILIBILI_SOURCE_URL);
    expect(value).not.toContain(encodeURIComponent(BILIBILI_SOURCE_URL));
    expect(new URL(value).pathname).not.toContain(BILIBILI_SOURCE_ID);
  }
}
