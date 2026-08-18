import { DESKTOP_HTTP_BASE, MEDIAGO_SCHEME } from "@/shared/constants";
import type {
  DetectedSource,
  ExtensionSettings,
  LocalizedMessage,
  ServerStatus,
} from "@/shared/types";
import type {
  HLSMediaInfo,
  HLSPlaylistType,
  HLSVariantInfo,
} from "@mediago/shared-common";
import { validateDownloadImportResponse } from "./mediago-response";

/* --------------------------- helpers --------------------------- */

function withApiKey(headers: HeadersInit, apiKey?: string): HeadersInit {
  if (!apiKey) return headers;
  return { ...headers, "X-API-Key": apiKey };
}

function joinUrl(base: string, path: string): string {
  const trimmed = base.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return trimmed + suffix;
}

function sourcesToTasks(sources: DetectedSource[]) {
  return sources.map((s) => ({
    name: s.name || s.url,
    url: s.url,
    type: s.type,
    headers: s.headers,
    folder: "",
  }));
}

function errorToText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface ImportResult {
  ok: boolean;
  count: number;
  /**
   * Translation descriptor when the service worker can attribute the
   * failure to a known-wording case; raw string for anything opaque
   * (HTTP status text, OS / network error messages).
   */
  error?: LocalizedMessage | string;
}

/* --------------------------- HTTP path --------------------------- */

interface HttpConfig {
  serverUrl: string;
  apiKey?: string;
}

interface InspectSourceResponse {
  id: string;
  url: string;
  playlistType: HLSPlaylistType;
  maxQuality?: string;
  variants: HLSVariantInfo[];
  error?: string;
}

function storedHeadersToArray(headers?: string): string[] {
  if (!headers) return [];
  try {
    const parsed = JSON.parse(headers) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.entries(parsed as Record<string, unknown>).map(
        ([name, value]) => `${name}:${String(value)}`,
      );
    }
  } catch {
    // Current sources use newline-separated headers.
  }
  return headers
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((header) => header.trim())
    .filter(Boolean);
}

function inspectedMediaInfo(result?: InspectSourceResponse): HLSMediaInfo {
  if (!result || result.error) {
    return { status: "failed", playlistType: "unknown", variants: [] };
  }
  return {
    status: "ready",
    playlistType: result.playlistType,
    maxQuality: result.maxQuality,
    variants: result.variants,
  };
}

/** Inspect sniffed HLS sources through the configured Desktop/Docker Core. */
export async function inspectSources(
  settings: ExtensionSettings,
  sources: DetectedSource[],
): Promise<DetectedSource[]> {
  const config = httpConfigFor(settings);
  if (!config || sources.length === 0) {
    return sources.map((source) => ({
      ...source,
      mediaInfo: inspectedMediaInfo(),
    }));
  }

  try {
    const requests: Promise<InspectSourceResponse[]>[] = [];
    for (let index = 0; index < sources.length; index += 20) {
      const chunk = sources.slice(index, index + 20);
      requests.push(
        fetch(joinUrl(config.serverUrl, "/api/sources/inspect"), {
          method: "POST",
          headers: withApiKey(
            {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            config.apiKey,
          ),
          body: JSON.stringify({
            sources: chunk.map((source) => ({
              id: source.id,
              url: source.url,
              headers: storedHeadersToArray(source.headers),
            })),
          }),
          signal: AbortSignal.timeout(6_000),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const body = (await res.json()) as {
            data?: { sources?: InspectSourceResponse[] };
          };
          return body.data?.sources ?? [];
        }),
      );
    }
    const results = (await Promise.all(requests)).flat();
    const inspections = new Map(results.map((result) => [result.id, result]));
    return sources.map((source) => ({
      ...source,
      mediaInfo: inspectedMediaInfo(inspections.get(source.id)),
    }));
  } catch {
    return sources.map((source) => ({
      ...source,
      mediaInfo: inspectedMediaInfo(),
    }));
  }
}

/**
 * GET /healthy against the configured server. Intentionally permissive:
 * any 2xx means "reachable". Used by both the test button and the
 * popup's status badge.
 */
async function probeHttp(config: HttpConfig): Promise<ServerStatus> {
  try {
    const res = await fetch(joinUrl(config.serverUrl, "/healthy"), {
      method: "GET",
      headers: withApiKey({ Accept: "application/json" }, config.apiKey),
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return { ok: false, status: res.status, message: `HTTP ${res.status}` };
    }
    return { ok: true, status: res.status, message: "connected" };
  } catch (err) {
    return { ok: false, message: errorToText(err) };
  }
}

async function importViaHttp(
  config: HttpConfig,
  sources: DetectedSource[],
  opts: { startDownload: boolean },
): Promise<ImportResult> {
  if (!config.serverUrl) {
    return {
      ok: false,
      count: 0,
      error: { key: "errors.serverNotConfigured" },
    };
  }
  try {
    const res = await fetch(joinUrl(config.serverUrl, "/api/downloads"), {
      method: "POST",
      headers: withApiKey(
        { "Content-Type": "application/json", Accept: "application/json" },
        config.apiKey,
      ),
      body: JSON.stringify({
        tasks: sourcesToTasks(sources),
        startDownload: opts.startDownload,
      }),
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { message?: string };
        if (body?.message) message = body.message;
      } catch {
        /* body isn't JSON; keep status-based message */
      }
      return { ok: false, count: 0, error: message };
    }
    const downloadIds = validateDownloadImportResponse(
      (await res.json()) as unknown,
      sources.length,
    );
    return { ok: true, count: downloadIds.length };
  } catch (err) {
    return { ok: false, count: 0, error: errorToText(err) };
  }
}

/* --------------------------- Schema path --------------------------- */

/**
 * Build a review-only Share Intent deeplink. Electron's main process
 * validates and queues this payload, then the renderer opens the existing
 * download form through IPC. Scheme invocations never create tasks directly.
 */

function buildTaskDeeplink(source: DetectedSource): string {
  const params = new URLSearchParams();
  params.set("v", "1");
  params.set("url", source.url);
  if (source.name) params.set("name", source.name);
  params.set("type", source.type);
  return `${MEDIAGO_SCHEME}://share?${params.toString()}`;
}

/**
 * Open a deeplink so Chrome hands the URL to the OS's registered
 * protocol handler (Electron).
 *
 * Strategy — copied verbatim from cat-catch's proven `#play` flow in
 * `popup.js:317-331`: navigate the user's currently-active tab to the
 * scheme URL via `chrome.tabs.update`. The "Open MediaGo?" dialog is
 * tab-modal, so putting it on the tab the user is already looking at
 * guarantees it's visible. Earlier attempts that opened a new
 * background tab and auto-closed it failed because the dialog went
 * with the tab before the OS could receive the handoff.
 *
 * After the user approves once (and ticks "Always allow" on the
 * dialog), subsequent navigations are silent — Chrome routes the URL
 * straight to the OS with no prompt.
 *
 * Throws a sentinel `SchemaNoTabError` when there is no active tab, so
 * the caller can render a translated message.
 */
class SchemaNoTabError extends Error {
  readonly code = "NO_ACTIVE_TAB";
}

async function openDeeplink(url: string): Promise<void> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
  });
  if (activeTab?.id === undefined) {
    throw new SchemaNoTabError("no active tab");
  }
  await chrome.tabs.update(activeTab.id, { url });
}

function schemaError(err: unknown): LocalizedMessage | string {
  if (err instanceof SchemaNoTabError) {
    return { key: "errors.schemaNoActiveTab" };
  }
  return errorToText(err);
}

async function importViaSchema(
  sources: DetectedSource[],
): Promise<ImportResult> {
  // `chrome.tabs.update` navigates THE single active tab — there's
  // no way to chain more than one scheme invocation without racing
  // through the same tab (cat-catch has the same limitation, so
  // their `#play` button is also single-item). Require HTTP mode for
  // batch imports instead of silently dropping tasks.
  if (sources.length > 1) {
    return {
      ok: false,
      count: 0,
      error: { key: "errors.schemaBatchNotSupported" },
    };
  }
  if (sources[0].headers) {
    return {
      ok: false,
      count: 0,
      error: { key: "errors.schemaHeadersNotSupported" },
    };
  }
  try {
    await openDeeplink(buildTaskDeeplink(sources[0]));
    return { ok: true, count: 1 };
  } catch (err) {
    return { ok: false, count: 0, error: schemaError(err) };
  }
}

async function probeSchemaPing(): Promise<ServerStatus> {
  // There is no silent way to probe an OS protocol handler. The test opens
  // MediaGo without a task; if no handler exists, Chrome shows its standard
  // unsupported-protocol prompt.
  try {
    await openDeeplink(`${MEDIAGO_SCHEME}://open`);
    return { ok: true, message: { key: "errors.schemaInvoked" } };
  } catch (err) {
    return { ok: false, message: schemaError(err) };
  }
}

/* --------------------------- public API --------------------------- */

/**
 * Resolve the effective HTTP config for a given settings object. Used
 * by the popup's status badge and the test button.
 */
export function httpConfigFor(settings: ExtensionSettings): HttpConfig | null {
  if (settings.mode === "desktop-http") {
    return { serverUrl: DESKTOP_HTTP_BASE };
  }
  if (settings.mode === "docker-http") {
    if (!settings.serverUrl) return null;
    return {
      serverUrl: settings.serverUrl,
      apiKey: settings.apiKey || undefined,
    };
  }
  return null;
}

export async function probe(
  mode: ExtensionSettings["mode"],
  serverUrl: string,
  apiKey?: string,
): Promise<ServerStatus> {
  if (mode === "desktop-schema") return probeSchemaPing();
  const base = mode === "desktop-http" ? DESKTOP_HTTP_BASE : serverUrl;
  if (!base) return { ok: false, message: { key: "errors.serverUrlRequired" } };
  return probeHttp({ serverUrl: base, apiKey });
}

/**
 * Dispatch sources to MediaGo via the configured mode. Never falls
 * back to another mode on failure — the user picks one explicitly and
 * must fix the chosen path or switch mode themselves.
 */
export async function importSources(
  settings: ExtensionSettings,
  sources: DetectedSource[],
): Promise<ImportResult> {
  if (sources.length === 0) return { ok: true, count: 0 };

  switch (settings.mode) {
    case "desktop-schema":
      return importViaSchema(sources);
    case "desktop-http":
      return importViaHttp({ serverUrl: DESKTOP_HTTP_BASE }, sources, {
        startDownload: settings.downloadNow,
      });
    case "docker-http":
      if (!settings.serverUrl) {
        return {
          ok: false,
          count: 0,
          error: { key: "errors.dockerNotConfigured" },
        };
      }
      return importViaHttp(
        { serverUrl: settings.serverUrl, apiKey: settings.apiKey || undefined },
        sources,
        { startDownload: settings.downloadNow },
      );
  }
}
