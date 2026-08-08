import EventEmitter from "node:events";
import { provide } from "@inversifyjs/binding-decorators";
import {
  DownloadType,
  matchPageUrl,
  matchRequestUrl,
} from "@mediago/shared-common";
import { type OnSendHeadersListenerDetails, session } from "electron";
import { inject, injectable } from "inversify";
import {
  formatHeaders,
  PERSIST_WEBVIEW,
  PRIVACY_WEBVIEW,
  urlCache,
} from "../utils";
import ElectronLogger from "../vendor/ElectronLogger";

export interface SourceParams {
  url: string;
  documentURL: string;
  name: string;
  type: DownloadType;
  headers?: string;
}

interface PageInfo {
  title: string;
  url: string;
}

@injectable()
@provide()
export class SniffingHelper extends EventEmitter {
  private pageInfo: PageInfo = { title: "", url: "" };
  private readonly prepareDelay = 1000;
  private checkTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pageHeaders = new Map<DownloadType, string>();

  constructor(
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
  ) {
    super();
  }

  pluginReady() {
    // empty
  }

  getPageHeaders(type: DownloadType): string | undefined {
    return this.pageHeaders.get(type);
  }

  update(pageInfo: PageInfo) {
    this.pageInfo = pageInfo;
    // Cancel pending check from previous page
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
      this.checkTimer = null;
    }
    // Reset dedup cache when navigating to a new page
    urlCache.clear();
  }

  checkPageInfo() {
    // Cancel any pending check
    if (this.checkTimer) {
      clearTimeout(this.checkTimer);
    }

    // Capture current page info to avoid race conditions
    const pageInfo = { ...this.pageInfo };

    this.checkTimer = setTimeout(() => {
      this.checkTimer = null;
      const filter = matchPageUrl(pageInfo.url);
      if (filter) {
        this.send({
          url: pageInfo.url,
          documentURL: pageInfo.url,
          name: pageInfo.title,
          type: filter.type,
          headers: this.pageHeaders.get(filter.type),
        });
      }
    }, this.prepareDelay);
  }

  start(privacy: boolean = false) {
    this.pageHeaders.clear();
    const partition = privacy ? PRIVACY_WEBVIEW : PERSIST_WEBVIEW;
    const viewSession = session.fromPartition(partition);
    viewSession.webRequest.onSendHeaders(this.onSendHeaders);
  }

  send = (item: SourceParams) => {
    const urlCacheKey = `${item.url}_${item.name}`;
    const cacheUrl = urlCache.get(urlCacheKey);
    if (cacheUrl) {
      return;
    }

    this.logger.info(`[SniffingHelper] send: ${item.url}`);
    this.emit("source", item);

    urlCache.set(urlCacheKey, true);
  };

  private onSendHeaders = (details: OnSendHeadersListenerDetails): void => {
    const { url, requestHeaders } = details;
    const { title, url: documentURL } = this.pageInfo;
    const headers = formatHeaders(requestHeaders);

    const cookieBackedType = getCookieBackedType(url);
    if (cookieBackedType && hasHeader(requestHeaders, "cookie")) {
      this.pageHeaders.set(cookieBackedType, headers);
    }

    const filter = matchRequestUrl(url);
    if (filter) {
      this.send({
        url,
        documentURL,
        name: title,
        type: filter.type,
        headers,
      });
    }
  };
}

export function hasHeader(
  headers: Record<string, string>,
  name: string,
): boolean {
  return Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === name.toLowerCase(),
  );
}

export function getCookieBackedType(url: string): DownloadType | undefined {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === "bilibili.com" || hostname.endsWith(".bilibili.com")) {
      return DownloadType.bilibili;
    }
  } catch {
    // Ignore malformed request URLs.
  }
  return undefined;
}
