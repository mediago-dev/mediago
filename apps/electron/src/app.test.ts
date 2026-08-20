import { beforeEach, expect, test, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  app: {
    getLocale: vi.fn(() => "en"),
    on: vi.fn(),
  },
  nativeTheme: { themeSource: "system" },
}));

vi.mock("electron", () => ({
  app: electronMocks.app,
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  Menu: { buildFromTemplate: vi.fn() },
  nativeImage: {},
  nativeTheme: electronMocks.nativeTheme,
  Tray: class Tray {},
}));

vi.mock("./core/i18n", () => ({
  i18n: {
    changeLanguage: vi.fn(),
    on: vi.fn(),
    t: vi.fn((key: string) => key),
  },
}));

vi.mock("@mediago/shared-common", () => ({
  IpcEvent: { app: { shareIntentAvailable: "share-intent-available" } },
  resolveAppLanguage: vi.fn((language: string) => language),
}));

vi.mock("../assets/icon.ico", () => ({ default: "icon.ico" }));
vi.mock("../assets/trayTemplate.png", () => ({ default: "tray.png" }));
vi.mock("./controller", () => ({}));
vi.mock("./core/application-menu", () => ({
  installApplicationMenu: vi.fn(),
}));
vi.mock("./constants", () => ({ db: "/db", isMac: false, logDir: "/log" }));

vi.mock("./core/protocol", () => ({ default: class ProtocolService {} }));
vi.mock("./core/router", () => ({ default: class ElectronRouter {} }));
vi.mock("./services/downloader.server", () => ({
  DownloaderServer: class DownloaderServer {},
}));
vi.mock("./services/go-config-cache", () => ({
  default: class GoConfigCache {},
}));
vi.mock("./services/overlay-dialog.service", () => ({
  default: class OverlayDialogService {},
}));
vi.mock("./services/share-intent.service", () => ({
  default: class ShareIntentService {},
}));
vi.mock("./services/webview.service", () => ({
  default: class WebviewService {},
}));
vi.mock("./vendor/ElectronDevtools", () => ({
  default: class ElectronDevtools {},
}));
vi.mock("./vendor/ElectronLogger", () => ({
  default: class ElectronLogger {},
}));
vi.mock("./vendor/ElectronUpdater", () => ({
  default: class ElectronUpdater {},
}));
vi.mock("./windows/browser.window", () => ({
  default: class BrowserWindowService {},
}));
vi.mock("./windows/main.window", () => ({
  default: class MainWindow {},
}));

const { default: ElectronApp } = await import("./app");

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.nativeTheme.themeSource = "system";
});

test("seeds initial config before prewarming an enabled ad blocker", async () => {
  const { app, configCache, webviewService } = createApp({ blockAds: true });

  await app.init();

  expect(configCache.seed).toHaveBeenCalledOnce();
  expect(webviewService.setBlocking).toHaveBeenCalledWith(true);
  expect(configCache.seed.mock.invocationCallOrder[0]).toBeLessThan(
    webviewService.setBlocking.mock.invocationCallOrder[0],
  );
});

test("does not apply unrelated initial webview config when ad blocking is off", async () => {
  const { app, webviewService } = createApp({ blockAds: false });

  await app.init();

  expect(webviewService.setBlocking).not.toHaveBeenCalled();
  expect(webviewService.setProxy).not.toHaveBeenCalled();
  expect(webviewService.setUserAgent).not.toHaveBeenCalled();
  expect(webviewService.setDefaultSession).not.toHaveBeenCalled();
  expect(webviewService.setAudioMuted).not.toHaveBeenCalled();
});

function createApp(config: Record<string, unknown>) {
  const mainWindow = {
    init: vi.fn(),
    send: vi.fn(),
    showWindow: vi.fn(),
  };
  const protocol = { create: vi.fn() };
  const updater = {
    changeAllowBeta: vi.fn(),
    changeAutoUpgrade: vi.fn(),
    init: vi.fn(),
  };
  const router = { init: vi.fn() };
  const devTools = { init: vi.fn() };
  const downloaderServer = {
    getClient: vi.fn(() => ({
      getConfig: vi.fn(async () => ({ data: config })),
    })),
    on: vi.fn(),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
  };
  const webviewService = {
    setAudioMuted: vi.fn(),
    setBlocking: vi.fn(),
    setDefaultSession: vi.fn(),
    setProxy: vi.fn(),
    setUserAgent: vi.fn(),
  };
  const overlayDialogService = { init: vi.fn() };
  const configCache = {
    get: vi.fn(),
    seed: vi.fn(),
    update: vi.fn(),
  };
  const browserWindow = { send: vi.fn() };
  const logger = { error: vi.fn() };
  const shareIntentService = {
    handleCommandLine: vi.fn(),
    handleProtocolUrl: vi.fn(),
    hasPending: vi.fn(() => false),
  };
  const app = new ElectronApp(
    mainWindow as never,
    protocol as never,
    updater as never,
    router as never,
    devTools as never,
    downloaderServer as never,
    webviewService as never,
    overlayDialogService as never,
    configCache as never,
    browserWindow as never,
    logger as never,
    shareIntentService as never,
  );
  vi.spyOn(app, "initTray").mockImplementation(() => undefined);

  return { app, configCache, webviewService };
}
