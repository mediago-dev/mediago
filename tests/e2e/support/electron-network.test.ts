import { beforeEach, describe, expect, test } from "vitest";
import {
  assertElectronNetworkSnapshot,
  classifyElectronRequest,
  installElectronNetworkPolicy,
  normalizeElectronCoreOrigin,
  readElectronNetworkPolicy,
  scrubElectronEnvironment,
  tightenElectronNetworkPolicy,
} from "./electron-network.ts";

describe("Electron provisional network policy", () => {
  test.each([
    "about:blank",
    "blob:http://localhost:8500/fixture-id",
    "data:text/plain,hello",
    "chrome-extension://abc/popup.html",
    "http://localhost:8500/",
    "https://127.0.0.1:4443/path",
    "http://[::1]:8500/",
    "ws://localhost:8500/socket",
    "wss://127.0.0.1:4443/socket",
    "ws://[::1]:8500/socket",
  ])("allows browser-internal and loopback URL %s", (url) => {
    expect(classifyElectronRequest(url)).toBe("allow");
  });

  test.each([
    "http://10.2.3.4:39719/healthy",
    "https://172.16.0.2:39719/api/config",
    "http://172.31.255.254:39719/api/events",
    "http://192.168.10.20:39719/",
  ])("provisionally allows private Core candidate %s", (url) => {
    expect(classifyElectronRequest(url)).toBe("provisional-core");
  });

  test.each([
    "https://example.com/video.mp4",
    "http://core.local:39719/healthy",
    "http://8.8.8.8:39719/healthy",
    "http://172.15.0.2:39719/healthy",
    "http://172.32.0.2:39719/healthy",
    "http://192.168.10.20:39720/healthy",
    "ws://192.168.10.20:39719/events",
    "wss://example.com/socket",
    "ftp://127.0.0.1/video.mp4",
    "file:///tmp/video.mp4",
    "custom://localhost/resource",
    "not a URL",
  ])("blocks URL %s", (url) => {
    expect(classifyElectronRequest(url)).toBe("block");
  });
});

describe("Electron tightened network policy", () => {
  const coreOrigin = "http://192.168.10.20:39719";

  test("allows only the exact non-loopback Core origin", () => {
    expect(
      classifyElectronRequest(
        "http://192.168.10.20:39719/api/config?ignored=yes",
        coreOrigin,
      ),
    ).toBe("allow");
    expect(
      classifyElectronRequest("https://192.168.10.20:39719/", coreOrigin),
    ).toBe("block");
    expect(
      classifyElectronRequest("http://192.168.10.21:39719/", coreOrigin),
    ).toBe("block");
    expect(
      classifyElectronRequest("http://192.168.10.20:39720/", coreOrigin),
    ).toBe("block");
  });

  test("continues allowing loopback after tightening", () => {
    expect(classifyElectronRequest("http://localhost:8500/", coreOrigin)).toBe(
      "allow",
    );
    expect(
      classifyElectronRequest("http://127.0.0.1:49152/sample.mp4", coreOrigin),
    ).toBe("allow");
    expect(
      classifyElectronRequest("ws://localhost:8500/socket", coreOrigin),
    ).toBe("allow");
  });

  test.each([
    "https://example.com:39719",
    "http://core.local:39719",
    "http://192.168.10.20:39720",
    "ws://192.168.10.20:39719",
    "http://192.168.10.20:39719/path",
  ])("rejects invalid owned Core origin %s", (origin) => {
    expect(() => normalizeElectronCoreOrigin(origin)).toThrow(
      /Owned Core origin/,
    );
  });

  test.each([
    "http://127.0.0.1:39719",
    "https://192.168.10.20:39719",
    "http://10.2.3.4:39719",
    "http://172.31.255.254:39719",
  ])("accepts valid owned Core origin %s", (origin) => {
    expect(normalizeElectronCoreOrigin(origin)).toBe(origin);
  });

  test("accepts provisional records only from the owned Core origin", () => {
    expect(() =>
      assertElectronNetworkSnapshot(
        {
          provisionalRequests: [
            "http://192.168.10.20:39719/healthy",
            "http://192.168.10.20:39719/api/events",
          ],
          blockedRequests: [],
        },
        coreOrigin,
      ),
    ).not.toThrow();

    expect(() =>
      assertElectronNetworkSnapshot(
        {
          provisionalRequests: ["http://192.168.10.21:39719/healthy"],
          blockedRequests: [],
        },
        coreOrigin,
      ),
    ).toThrow(/192\.168\.10\.21/);
  });

  test("rejects any recorded blocked HTTP(S) request", () => {
    expect(() =>
      assertElectronNetworkSnapshot(
        {
          provisionalRequests: [],
          blockedRequests: ["https://example.com/update"],
        },
        coreOrigin,
      ),
    ).toThrow(/example\.com/);
  });
});

describe("Electron environment isolation", () => {
  test("removes inherited proxy and devtools variables case-insensitively", () => {
    expect(
      scrubElectronEnvironment({
        HTTP_PROXY: "http://proxy.invalid",
        https_proxy: "http://proxy.invalid",
        Ws_PrOxY: "http://proxy.invalid",
        WSS_PROXY: "http://proxy.invalid",
        FTP_PROXY: "http://proxy.invalid",
        npm_config_proxy: "http://proxy.invalid",
        NPM_CONFIG_HTTP_PROXY: "http://proxy.invalid",
        NODE_USE_ENV_PROXY: "1",
        ELECTRON_GET_USE_PROXY: "1",
        NO_PROXY: "example.com",
        no_proxy: "example.com",
        LOAD_DEVTOOLS: "1",
        open_devtools: "true",
        MEDIAGO_SAFE_VALUE: "kept",
        MEDIAGO_UNDEFINED_VALUE: undefined,
      }),
    ).toEqual({ MEDIAGO_SAFE_VALUE: "kept" });
  });
});

describe("Electron main-process policy evaluator", () => {
  let onBeforeRequest: (
    details: { url: string },
    callback: (response: { cancel?: boolean }) => void,
  ) => void;

  beforeEach(() => {
    delete (
      globalThis as typeof globalThis & {
        __mediagoE2eElectronNetworkPolicy?: unknown;
      }
    ).__mediagoE2eElectronNetworkPolicy;
    installElectronNetworkPolicy({
      session: {
        defaultSession: {
          webRequest: {
            onBeforeRequest(listener) {
              onBeforeRequest = listener;
            },
          },
        },
      },
    });
  });

  function request(url: string): { cancel?: boolean } {
    let response: { cancel?: boolean } | undefined;
    onBeforeRequest({ url }, (result) => {
      response = result;
    });
    if (!response) throw new Error("Network policy did not answer request");
    return response;
  }

  test.each([
    "ws://192.168.10.20:39719/events",
    "wss://example.com/socket",
    "ftp://127.0.0.1/video.mp4",
    "file:///tmp/video.mp4",
  ])("blocks and records non-allowlisted URL %s", (url) => {
    expect(request(url)).toEqual({ cancel: true });
    const snapshot = readElectronNetworkPolicy({} as never);
    expect(snapshot.blockedRequestCount).toBe(1);
    expect(snapshot.blockedRequests).toHaveLength(1);
  });

  test("records a fixed sentinel for malformed URLs without leaking credentials", () => {
    expect(request("http://user:super-secret@[/?token=private")).toEqual({
      cancel: true,
    });
    const snapshot = readElectronNetworkPolicy({} as never);
    expect(snapshot.blockedRequests).toEqual(["<invalid-url>"]);
    expect(JSON.stringify(snapshot)).not.toMatch(/super-secret|private/);
  });

  test.each([
    "https://example.com/mediago-e2e-password",
    "https://example.com/update?token=mediago-e2e-password",
    "https://mediago-e2e-password@example.com/update",
  ])("redacts secrets from blocked URL diagnostics for %s", (url) => {
    expect(request(url)).toEqual({ cancel: true });
    const snapshot = readElectronNetworkPolicy({} as never);
    let message = "";
    try {
      assertElectronNetworkSnapshot(snapshot, "http://127.0.0.1:39719");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toMatch(/Electron blocked 1 external request/);
    expect(message).toContain("https://example.com/");
    expect(message).not.toContain("mediago-e2e-password");
    expect(JSON.stringify(snapshot)).not.toContain("mediago-e2e-password");
  });

  test.each([
    "https://example.com:39719",
    "http://core.local:39719",
    "http://192.168.10.20:39720",
  ])("refuses to tighten to invalid origin %s", (origin) => {
    expect(() => tightenElectronNetworkPolicy({} as never, origin)).toThrow(
      /Owned Core origin/,
    );
  });

  test("bounds request history without hiding counts or origin mismatches", () => {
    for (let index = 0; index < 40; index += 1) {
      request(`https://example.com/request-${index}`);
    }
    for (let index = 0; index < 40; index += 1) {
      request(`http://192.168.10.20:39719/request-${index}`);
    }
    request("http://192.168.10.21:39719/request-after-bound");

    const snapshot = tightenElectronNetworkPolicy(
      {} as never,
      "http://192.168.10.20:39719",
    );
    expect(snapshot.blockedRequestCount).toBe(40);
    expect(snapshot.blockedRequests).toHaveLength(32);
    expect(snapshot.provisionalRequestCount).toBe(41);
    expect(snapshot.provisionalRequests).toHaveLength(32);
    expect(snapshot.provisionalOriginMismatch).toBe(true);
    expect(() =>
      assertElectronNetworkSnapshot(snapshot, "http://192.168.10.20:39719"),
    ).toThrow(/provisional Core request/);
  });
});
