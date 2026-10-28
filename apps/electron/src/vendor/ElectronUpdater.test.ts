import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const electronMocks = vi.hoisted(() => ({
  version: "3.5.0",
  app: {
    getVersion: vi.fn(() => electronMocks.version),
    isPackaged: true,
  },
  shell: {
    openExternal: vi.fn(async () => undefined),
    openPath: vi.fn(async () => ""),
  },
}));

const updaterMocks = vi.hoisted(() => ({
  autoUpdater: {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    channel: undefined as string | undefined,
    checkForUpdates: vi.fn(async () => null),
    checkForUpdatesAndNotify: vi.fn(async () => null),
    disableWebInstaller: false,
    downloadUpdate: vi.fn(async () => [] as string[]),
    forceDevUpdateConfig: false,
    logger: undefined as unknown,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  app: electronMocks.app,
  shell: electronMocks.shell,
}));

vi.mock("electron-is-dev", () => ({ default: false }));

vi.mock("electron-updater", () => updaterMocks);

vi.mock("./VerifiedNsisUpdater", () => ({
  default: class {
    constructor() {
      return updaterMocks.autoUpdater;
    }
  },
}));

vi.mock("../core/i18n", () => ({
  i18n: { t: vi.fn((key: string) => key) },
}));

vi.mock("../constants", () => ({ logDir: "/tmp/mediago-logs" }));

vi.mock("../windows/main.window", () => ({
  default: class MainWindow {},
}));

vi.mock("./ElectronLogger", () => ({
  default: class ElectronLogger {},
}));

const { default: ElectronUpdater } = await import("./ElectronUpdater");

function createUpdater() {
  const logger = {
    error: vi.fn(),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    },
  };
  const mainWindow = { send: vi.fn() };
  return {
    mainWindow,
    updater: new ElectronUpdater(logger as never, mainWindow as never),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  electronMocks.version = "3.5.0";
  delete process.env.PORTABLE_EXECUTABLE_FILE;
  Object.assign(updaterMocks.autoUpdater, {
    allowDowngrade: false,
    allowPrerelease: false,
    autoDownload: true,
    channel: undefined,
    disableWebInstaller: false,
    forceDevUpdateConfig: false,
    logger: undefined,
  });
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PORTABLE_EXECUTABLE_FILE;
});

describe.each([
  ["stable", "3.5.0"],
  ["Beta", "3.6.0-beta.1"],
  ["test", "3.6.0-test.1"],
] as const)("%s build channel selection", (_label, version) => {
  test.each([
    [false, "latest"],
    [true, "beta"],
  ] as const)(
    "uses %s prereleases with the %s channel",
    (allowBeta, channel) => {
      electronMocks.version = version;
      const { updater } = createUpdater();

      updater.init({ allowBeta, autoUpgrade: false });

      expect(updaterMocks.autoUpdater.channel).toBe(channel);
      expect(updaterMocks.autoUpdater.allowPrerelease).toBe(allowBeta);
      expect(updaterMocks.autoUpdater.allowDowngrade).toBe(false);
    },
  );
});

test("switches from latest to Beta and immediately checks the new channel", async () => {
  const { updater } = createUpdater();
  updater.init({ allowBeta: false, autoUpgrade: false });

  updater.changeAllowBeta(true);

  expect(updaterMocks.autoUpdater.channel).toBe("beta");
  expect(updaterMocks.autoUpdater.allowPrerelease).toBe(true);
  expect(updaterMocks.autoUpdater.allowDowngrade).toBe(false);
  await vi.waitFor(() => {
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });
});

test("switches from Beta to latest without permitting a downgrade", async () => {
  electronMocks.version = "3.6.0-beta.1";
  const { updater } = createUpdater();
  updater.init({ allowBeta: true, autoUpgrade: false });

  updater.changeAllowBeta(false);

  expect(updaterMocks.autoUpdater.channel).toBe("latest");
  expect(updaterMocks.autoUpdater.allowPrerelease).toBe(false);
  expect(updaterMocks.autoUpdater.allowDowngrade).toBe(false);
  await vi.waitFor(() => {
    expect(updaterMocks.autoUpdater.checkForUpdates).toHaveBeenCalledOnce();
  });
});

test("does not recheck when the selected channel did not change", () => {
  const { updater } = createUpdater();
  updater.init({ allowBeta: false, autoUpgrade: false });

  updater.changeAllowBeta(false);

  expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
});

test("test-signed previews never contact update feeds or install updates", async () => {
  electronMocks.version = "3.6.0-test.1";
  const { updater } = createUpdater();
  updater.init({ allowBeta: true, autoUpgrade: true });
  updater.changeAllowBeta(false);
  updater.changeAutoUpgrade(true);
  await vi.advanceTimersByTimeAsync(120_000);
  expect(updaterMocks.autoUpdater.autoDownload).toBe(false);
  expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
  expect(
    updaterMocks.autoUpdater.checkForUpdatesAndNotify,
  ).not.toHaveBeenCalled();
  expect((await updater.manualUpdate()).mode).toBe("external");
  await updater.install();
  expect(updaterMocks.autoUpdater.quitAndInstall).not.toHaveBeenCalled();
});

test("does not run an in-app channel refresh for portable builds", () => {
  process.env.PORTABLE_EXECUTABLE_FILE = "/tmp/mediago.exe";
  const { updater } = createUpdater();
  updater.init({ allowBeta: false, autoUpgrade: false });

  updater.changeAllowBeta(true);

  expect(updaterMocks.autoUpdater.channel).toBe("beta");
  expect(updaterMocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled();
});
