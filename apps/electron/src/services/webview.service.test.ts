import { beforeEach, expect, test, vi } from "vitest";

interface MockWebContents {
  loadURL: ReturnType<typeof vi.fn>;
}

const moduleMocks = vi.hoisted(() => ({
  resolve: vi.fn(() => "/tmp/preload.cjs"),
}));

const electronMocks = vi.hoisted(() => ({
  currentWebContents: undefined as MockWebContents | undefined,
  fromPartition: vi.fn(),
  persistSession: {
    clearCache: vi.fn(),
    clearStorageData: vi.fn(),
    cookies: { get: vi.fn() },
    setProxy: vi.fn(),
  },
  privacySession: {
    clearCache: vi.fn(),
    clearStorageData: vi.fn(),
    cookies: { get: vi.fn() },
    setProxy: vi.fn(),
  },
}));

const adBlockerMocks = vi.hoisted(() => ({
  disableBlockingInSession: vi.fn(),
  enableBlockingInSession: vi.fn(),
  fromLists: vi.fn(),
  isBlockingEnabled: vi.fn(),
}));

vi.mock("node:module", () => ({
  createRequire: () =>
    Object.assign(vi.fn(), {
      resolve: moduleMocks.resolve,
    }),
}));

vi.mock("electron", () => ({
  session: {
    fromPartition: electronMocks.fromPartition,
  },
  WebContentsView: class MockWebContentsView {
    webContents = {
      capturePage: vi.fn(),
      clearHistory: vi.fn(),
      close: vi.fn(),
      executeJavaScript: vi.fn(),
      getTitle: vi.fn(() => "Page"),
      getURL: vi.fn(() => "http://127.0.0.1/page"),
      loadURL: vi.fn(async () => undefined),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        goBack: vi.fn(),
      },
      on: vi.fn(),
      openDevTools: vi.fn(),
      reload: vi.fn(),
      removeListener: vi.fn(),
      setAudioMuted: vi.fn(),
      setUserAgent: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      stop: vi.fn(),
    };

    constructor() {
      electronMocks.currentWebContents = this.webContents;
    }

    getBounds = vi.fn();
    setBackgroundColor = vi.fn();
    setBounds = vi.fn();
  },
}));

vi.mock("@ghostery/adblocker-electron", () => ({
  ElectronBlocker: {
    fromLists: adBlockerMocks.fromLists,
  },
}));

vi.mock("../utils", () => ({
  isDeeplink: vi.fn(() => false),
  mobileUA: "mobile-user-agent",
  pcUA: "desktop-user-agent",
  PERSIST_WEBVIEW: "persist:webview",
  PRIVACY_WEBVIEW: "privacy-webview",
  pluginUrl: "/tmp/plugin.js",
}));

vi.mock("../windows/browser.window", () => ({
  default: class BrowserWindow {},
}));

vi.mock("../windows/main.window", () => ({
  default: class MainWindow {},
}));

vi.mock("../vendor/ElectronLogger", () => ({
  default: class ElectronLogger {},
}));

vi.mock("./go-config-cache", () => ({
  default: class GoConfigCache {},
}));

vi.mock("./sniffing-helper.service", () => ({
  SniffingHelper: class SniffingHelper {},
}));

vi.mock("electron-is-dev", () => ({ default: false }));

const { default: WebviewService } = await import("./webview.service");

beforeEach(() => {
  vi.clearAllMocks();
  electronMocks.currentWebContents = undefined;
  electronMocks.fromPartition.mockImplementation((partition: string) =>
    partition === "privacy-webview"
      ? electronMocks.privacySession
      : electronMocks.persistSession,
  );

  let blockingEnabled = false;
  adBlockerMocks.isBlockingEnabled.mockImplementation(() => blockingEnabled);
  adBlockerMocks.enableBlockingInSession.mockImplementation(() => {
    blockingEnabled = true;
  });
  adBlockerMocks.disableBlockingInSession.mockImplementation(() => {
    blockingEnabled = false;
  });
  adBlockerMocks.fromLists.mockResolvedValue(adBlockerMocks);
});

test("loads EasyList only when an ad-blocked navigation needs it", async () => {
  const { service } = createService(true);

  expect(adBlockerMocks.fromLists).not.toHaveBeenCalled();

  await service.loadURL("http://127.0.0.1/page");
  await service.loadURL("http://127.0.0.1/page");

  expect(adBlockerMocks.fromLists).toHaveBeenCalledTimes(1);
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledTimes(1);
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledWith(
    electronMocks.persistSession,
  );
  expect(electronMocks.currentWebContents?.loadURL).toHaveBeenLastCalledWith(
    "http://127.0.0.1/page",
  );
});

test("uses a blockAds value seeded after service construction", async () => {
  const { service, store } = createService(undefined);

  store.blockAds = true;
  await service.loadURL("http://127.0.0.1/page");

  expect(adBlockerMocks.fromLists).toHaveBeenCalledOnce();
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledOnce();
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledWith(
    electronMocks.persistSession,
  );
  expect(electronMocks.currentWebContents?.loadURL).toHaveBeenCalledWith(
    "http://127.0.0.1/page",
  );
});

test("still navigates and logs once when EasyList loading fails", async () => {
  adBlockerMocks.fromLists.mockRejectedValue(
    new Error("request headers and URL must stay private"),
  );
  const { logger, service } = createService(true);

  await service.loadURL("http://127.0.0.1/first");
  await service.loadURL("http://127.0.0.1/page");

  expect(electronMocks.currentWebContents?.loadURL).toHaveBeenLastCalledWith(
    "http://127.0.0.1/page",
  );
  expect(logger.error).toHaveBeenCalledTimes(1);
  expect(logger.error).toHaveBeenCalledWith("[AdBlocker] list load failed");
});

test("does not enable blocking when a later disable wins the loading race", async () => {
  let resolveBlocker: (value: typeof adBlockerMocks) => void = () => undefined;
  const pendingBlocker = new Promise<typeof adBlockerMocks>((resolve) => {
    resolveBlocker = resolve;
  });
  adBlockerMocks.fromLists.mockReturnValue(pendingBlocker);
  const { service } = createService(false);

  service.setBlocking(true);
  service.setBlocking(false);
  resolveBlocker(adBlockerMocks);
  await pendingBlocker;
  await Promise.resolve();
  await Promise.resolve();

  expect(adBlockerMocks.enableBlockingInSession).not.toHaveBeenCalled();
});

test("disables the old session before enabling blocking in a new session", async () => {
  const { service } = createService(true);

  await service.loadURL("http://127.0.0.1/persist");
  service.setDefaultSession(true);
  await service.loadURL("http://127.0.0.1/privacy");

  expect(adBlockerMocks.disableBlockingInSession).toHaveBeenCalledOnce();
  expect(adBlockerMocks.disableBlockingInSession).toHaveBeenCalledWith(
    electronMocks.persistSession,
  );
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledTimes(2);
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenNthCalledWith(
    2,
    electronMocks.privacySession,
  );
  expect(
    adBlockerMocks.disableBlockingInSession.mock.invocationCallOrder[0],
  ).toBeLessThan(
    adBlockerMocks.enableBlockingInSession.mock.invocationCallOrder[1],
  );
});

test("disables blocking in the exact session that was enabled", async () => {
  const { service } = createService(true);

  await service.loadURL("http://127.0.0.1/persist");
  service.setDefaultSession(true);
  service.setBlocking(false);

  expect(adBlockerMocks.disableBlockingInSession).toHaveBeenCalledOnce();
  expect(adBlockerMocks.disableBlockingInSession).toHaveBeenCalledWith(
    electronMocks.persistSession,
  );
  expect(adBlockerMocks.disableBlockingInSession).not.toHaveBeenCalledWith(
    electronMocks.privacySession,
  );
});

test("enables blocking in the latest session when it changes during loading", async () => {
  let resolveBlocker: (value: typeof adBlockerMocks) => void = () => undefined;
  const pendingBlocker = new Promise<typeof adBlockerMocks>((resolve) => {
    resolveBlocker = resolve;
  });
  adBlockerMocks.fromLists.mockReturnValue(pendingBlocker);
  const { service } = createService(true);

  const navigation = service.loadURL("http://127.0.0.1/page");
  await vi.waitFor(() => {
    expect(adBlockerMocks.fromLists).toHaveBeenCalledOnce();
  });
  service.setDefaultSession(true);
  resolveBlocker(adBlockerMocks);
  await navigation;

  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledOnce();
  expect(adBlockerMocks.enableBlockingInSession).toHaveBeenCalledWith(
    electronMocks.privacySession,
  );
});

test("still navigates and logs safely when enabling blocking throws", async () => {
  adBlockerMocks.enableBlockingInSession.mockImplementationOnce(() => {
    throw new Error("session details must stay private");
  });
  const { logger, service } = createService(true);

  await service.loadURL("http://127.0.0.1/page");

  expect(electronMocks.currentWebContents?.loadURL).toHaveBeenCalledWith(
    "http://127.0.0.1/page",
  );
  expect(logger.error).toHaveBeenCalledOnce();
  expect(logger.error).toHaveBeenCalledWith("[AdBlocker] enable failed");
});

function createService(blockAds: boolean | undefined) {
  const store = {
    audioMuted: false,
    blockAds,
    isMobile: false,
    privacy: false,
    proxy: "",
    useProxy: false,
  };
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
  };
  const configCache = {
    get: vi.fn((key: keyof typeof store) => store[key]),
    store,
  };
  const sniffingHelper = {
    checkPageInfo: vi.fn(),
    on: vi.fn(),
    start: vi.fn(),
    update: vi.fn(),
  };

  const service = new WebviewService(
    { window: null } as never,
    logger as never,
    { window: null } as never,
    configCache as never,
    sniffingHelper as never,
  );

  return { logger, service, store };
}
