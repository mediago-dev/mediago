import { redactDiagnostic } from "./process.ts";

const INTERNAL_PROTOCOLS = new Set([
  "about:",
  "blob:",
  "data:",
  "chrome-extension:",
]);
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BLOCKED_REQUEST_LIMIT = 32;
const BLOCKED_LOCATION_LIMIT = 512;

export interface BrowserNetworkGuard {
  readonly blockedRequests: readonly string[];
  readonly blockedRequestCount: number;
}

export interface RoutableBrowserContext {
  routeWebSocket(
    url: string,
    handler: (route: BrowserWebSocketRoute) => Promise<void> | void,
  ): Promise<unknown>;
  route(
    url: string,
    handler: (route: BrowserRoute) => Promise<void>,
  ): Promise<unknown>;
}

interface BrowserWebSocketRoute {
  url(): string;
  connectToServer(): unknown;
  close(options?: { code?: number; reason?: string }): Promise<void>;
}

interface BrowserRoute {
  request(): { url(): string };
  abort(errorCode?: "blockedbyclient"): Promise<void>;
  continue(): Promise<void>;
}

export function isAllowedBrowserURL(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (INTERNAL_PROTOCOLS.has(url.protocol)) return true;
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    LOOPBACK_HOSTS.has(url.hostname)
  );
}

function safeOriginPath(url: URL): string {
  return redactDiagnostic(`${url.origin}${url.pathname}`).slice(
    0,
    BLOCKED_LOCATION_LIMIT,
  );
}

function isAllowedWebSocketURL(url: URL): boolean {
  return (
    (url.protocol === "ws:" || url.protocol === "wss:") &&
    LOOPBACK_HOSTS.has(url.hostname)
  );
}

export async function guardBrowserContext(
  context: RoutableBrowserContext,
): Promise<BrowserNetworkGuard> {
  const blockedRequests: string[] = [];
  let blockedRequestCount = 0;
  const guard: BrowserNetworkGuard = {
    blockedRequests,
    get blockedRequestCount() {
      return blockedRequestCount;
    },
  };

  const recordBlockedRequest = (url: URL): void => {
    blockedRequestCount += 1;
    if (blockedRequests.length < BLOCKED_REQUEST_LIMIT) {
      blockedRequests.push(safeOriginPath(url));
    }
  };

  await context.routeWebSocket("**/*", async (route) => {
    let url: URL;
    try {
      url = new URL(route.url());
    } catch {
      await route.close({ code: 1008, reason: "Blocked by network guard" });
      return;
    }

    if (isAllowedWebSocketURL(url)) {
      route.connectToServer();
      return;
    }

    if (url.protocol === "ws:" || url.protocol === "wss:") {
      recordBlockedRequest(url);
    }
    await route.close({ code: 1008, reason: "Blocked by network guard" });
  });

  await context.route("**/*", async (route) => {
    const value = route.request().url();
    if (isAllowedBrowserURL(value)) {
      await route.continue();
      return;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      await route.continue();
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      await route.continue();
      return;
    }

    recordBlockedRequest(url);
    await route.abort("blockedbyclient");
  });
  return guard;
}

export function assertNoBlockedRequests(guard: BrowserNetworkGuard): void {
  if (guard.blockedRequestCount === 0) return;
  const omitted = guard.blockedRequestCount - guard.blockedRequests.length;
  throw new Error(
    [
      `Blocked ${guard.blockedRequestCount} external browser request(s):`,
      ...guard.blockedRequests,
      ...(omitted > 0 ? [`... ${omitted} more omitted`] : []),
    ]
      .join("\n")
      .slice(0, 4_096),
  );
}
