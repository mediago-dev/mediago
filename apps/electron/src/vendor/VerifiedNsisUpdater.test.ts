import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  downloaded: vi.fn(),
  installed: vi.fn(() => true),
  path: "C:\\cache\\installer.exe" as string | null,
}));
vi.mock("./windows-signature", () => ({
  assertWindowsUpdateSignature: mocks.verify,
  verifyWindowsUpdateSignature: vi.fn(async () => null),
}));
vi.mock("electron-updater", () => ({
  NsisUpdater: class {
    verifyUpdateCodeSignature: unknown;
    get installerPath() {
      return mocks.path;
    }
    protected dispatchUpdateDownloaded(event: unknown) {
      mocks.downloaded(event);
    }
    protected doInstall(options: unknown) {
      return mocks.installed(options);
    }
  },
}));
const { default: VerifiedNsisUpdater } = await import("./VerifiedNsisUpdater");
class TestUpdater extends VerifiedNsisUpdater {
  downloaded(file = "C:\\cache\\installer.exe") {
    this.dispatchUpdateDownloaded({
      downloadedFile: file,
      version: "3.6.0",
      files: [],
      path: "installer.exe",
      sha512: "hash",
      releaseDate: "2026-10-28",
    });
  }
  installTest() {
    return this.doInstall({
      isSilent: true,
      isForceRunAfter: false,
      isAdminRightsRequired: false,
    });
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.verify.mockReset();
  mocks.path = "C:\\cache\\installer.exe";
});
test("a cached update must be verified before it is reported as ready", () => {
  const updater = new TestUpdater();
  updater.downloaded();
  expect(mocks.verify).toHaveBeenCalledWith(mocks.path);
  expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.downloaded.mock.invocationCallOrder[0],
  );
});
test("a missing or rejected signature cannot produce a downloaded event", () => {
  mocks.verify.mockImplementation(() => {
    throw new Error("invalid signature");
  });
  expect(() => new TestUpdater().downloaded()).toThrow("invalid signature");
  expect(mocks.downloaded).not.toHaveBeenCalled();
});
test("installation verifies the file again, including silent install on quit", () => {
  const updater = new TestUpdater();
  updater.downloaded();
  mocks.verify.mockImplementation(() => {
    throw new Error("file changed after download");
  });
  expect(() => updater.installTest()).toThrow("changed");
  expect(mocks.installed).not.toHaveBeenCalled();
});
test("a valid file can reach the real installer entry", () => {
  expect(new TestUpdater().installTest()).toBe(true);
  expect(mocks.installed).toHaveBeenCalledOnce();
});
test("a missing installer fails closed", () => {
  mocks.path = null;
  expect(() => new TestUpdater().installTest()).toThrow("missing");
  expect(mocks.installed).not.toHaveBeenCalled();
});
