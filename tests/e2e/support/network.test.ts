import type { BrowserContext } from "@playwright/test";
import { describe, expect, test, vi } from "vitest";
import {
  assertNoBlockedRequests,
  guardBrowserContext,
  isAllowedBrowserURL,
} from "./network.ts";

function acceptsPlaywrightContext(context: BrowserContext): void {
  void guardBrowserContext(context);
}

void acceptsPlaywrightContext;

describe("isAllowedBrowserURL", () => {
  test.each([
    "about:blank",
    "blob:http://127.0.0.1/id",
    "data:text/plain,hello",
    "chrome-extension://abc/popup.html",
    "http://localhost:8501/",
    "https://localhost/path",
    "http://127.0.0.1:8501/",
    "https://[::1]:443/path",
  ])("allows browser-internal and loopback URL %s", (url) => {
    expect(isAllowedBrowserURL(url)).toBe(true);
  });

  test.each([
    "https://example.com/video.mp4",
    "http://192.168.1.2:39719/healthy",
    "https://localhost.example.com/",
    "ftp://127.0.0.1/file",
    "not a URL",
  ])("rejects URL %s", (url) => {
    expect(isAllowedBrowserURL(url)).toBe(false);
  });
});

describe("browser context network guard", () => {
  test("aborts external HTTP(S) and records only origin/path", async () => {
    let handler:
      | ((route: {
          request(): { url(): string };
          abort(): Promise<void>;
          continue(): Promise<void>;
        }) => Promise<void>)
      | undefined;
    const route = vi.fn(async (_pattern: string, callback: typeof handler) => {
      handler = callback;
    });
    const routeWebSocket = vi.fn(async () => undefined);
    const context = {
      route,
      routeWebSocket,
    };
    const guard = await guardBrowserContext(context);
    expect(routeWebSocket.mock.invocationCallOrder[0]).toBeLessThan(
      route.mock.invocationCallOrder[0],
    );
    const abort = vi.fn(async () => undefined);
    const continueRequest = vi.fn(async () => undefined);

    await handler?.({
      request: () => ({
        url: () =>
          "https://user:secret@example.com/private/video.mp4?apiKey=secret#fragment",
      }),
      abort,
      continue: continueRequest,
    });

    expect(abort).toHaveBeenCalledOnce();
    expect(continueRequest).not.toHaveBeenCalled();
    expect(guard.blockedRequests).toEqual([
      "https://example.com/private/video.mp4",
    ]);
    expect(JSON.stringify(guard)).not.toMatch(/user|secret|apiKey|fragment/);
    expect(() => assertNoBlockedRequests(guard)).toThrow(
      /example\.com\/private\/video\.mp4/,
    );
  });

  test("continues permitted HTTP(S) and non-routed protocols without recording them", async () => {
    let handler:
      | ((route: {
          request(): { url(): string };
          abort(): Promise<void>;
          continue(): Promise<void>;
        }) => Promise<void>)
      | undefined;
    const context = {
      routeWebSocket: vi.fn(async () => undefined),
      route: vi.fn(async (_pattern: string, callback: typeof handler) => {
        handler = callback;
      }),
    };
    const guard = await guardBrowserContext(context);

    for (const url of ["http://127.0.0.1:8501/", "ftp://external.invalid/"]) {
      const abort = vi.fn(async () => undefined);
      const continueRequest = vi.fn(async () => undefined);
      await handler?.({
        request: () => ({ url: () => url }),
        abort,
        continue: continueRequest,
      });
      expect(abort).not.toHaveBeenCalled();
      expect(continueRequest).toHaveBeenCalledOnce();
    }

    expect(() => assertNoBlockedRequests(guard)).not.toThrow();
  });

  test("blocks external WebSockets and records only safe origin/path", async () => {
    let webSocketHandler:
      | ((route: {
          url(): string;
          connectToServer(): unknown;
          close(options?: { code?: number; reason?: string }): Promise<void>;
        }) => Promise<void> | void)
      | undefined;
    const context = {
      routeWebSocket: vi.fn(
        async (_pattern: string, callback: typeof webSocketHandler) => {
          webSocketHandler = callback;
        },
      ),
      route: vi.fn(async () => undefined),
    };
    const guard = await guardBrowserContext(context);
    const cases = [
      {
        url: "ws://user:secret@external.invalid/private/socket?apiKey=secret#fragment",
        safe: "ws://external.invalid/private/socket",
      },
      {
        url: "wss://admin:password@secure.invalid/events?token=secret#fragment",
        safe: "wss://secure.invalid/events",
      },
    ];

    for (const item of cases) {
      const connectToServer = vi.fn(() => ({}));
      const close = vi.fn(async () => undefined);
      await webSocketHandler?.({
        url: () => item.url,
        connectToServer,
        close,
      });
      expect(connectToServer).not.toHaveBeenCalled();
      expect(close).toHaveBeenCalledOnce();
    }

    expect(guard.blockedRequestCount).toBe(2);
    expect(guard.blockedRequests).toEqual(cases.map((item) => item.safe));
    expect(JSON.stringify(guard)).not.toMatch(
      /user|secret|admin|password|apiKey|token|fragment/,
    );
    expect(() => assertNoBlockedRequests(guard)).toThrow(
      /Blocked 2 external browser request/,
    );
  });

  test("connects loopback WebSockets without recording them", async () => {
    let webSocketHandler:
      | ((route: {
          url(): string;
          connectToServer(): unknown;
          close(options?: { code?: number; reason?: string }): Promise<void>;
        }) => Promise<void> | void)
      | undefined;
    const context = {
      routeWebSocket: vi.fn(
        async (_pattern: string, callback: typeof webSocketHandler) => {
          webSocketHandler = callback;
        },
      ),
      route: vi.fn(async () => undefined),
    };
    const guard = await guardBrowserContext(context);
    const connectToServer = vi.fn(() => ({}));
    const close = vi.fn(async () => undefined);

    await webSocketHandler?.({
      url: () => "ws://127.0.0.1:8501/socket",
      connectToServer,
      close,
    });

    expect(connectToServer).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    expect(() => assertNoBlockedRequests(guard)).not.toThrow();
  });
});
