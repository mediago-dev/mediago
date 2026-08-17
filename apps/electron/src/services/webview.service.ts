import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { ElectronBlocker } from "@ghostery/adblocker-electron";
import { provide } from "@inversifyjs/binding-decorators";
import { DownloadType } from "@mediago/shared-common";
import { i18n } from "../core/i18n";
import {
  type Event,
  type HandlerDetails,
  session,
  WebContentsView,
} from "electron";
import isDev from "electron-is-dev";
import { inject, injectable } from "inversify";
import {
  isDeeplink,
  mobileUA,
  PERSIST_WEBVIEW,
  PRIVACY_WEBVIEW,
  pcUA,
  pluginUrl,
} from "../utils";
import ElectronLogger from "../vendor/ElectronLogger";
import GoConfigCache from "./go-config-cache";
import BrowserWindow from "../windows/browser.window";
import MainWindow from "../windows/main.window";
import { AdBlockerLoader } from "./ad-blocker-loader";
import { SniffingHelper, type SourceParams } from "./sniffing-helper.service";
import { enableSessionProxy } from "./webview-proxy";

const require = createRequire(import.meta.url);

const preload = require.resolve("@mediago/electron-preload");
const EASYLIST_URL = "https://easylist.to/easylist/easylist.txt";

@injectable()
@provide()
export default class WebviewService {
  private view: WebContentsView | null = null;
  private blocker?: ElectronBlocker;
  private readonly blockerLoader: AdBlockerLoader<ElectronBlocker>;
  private blockingRequested: boolean;
  private blockingSession?: Electron.Session;
  private defaultSession: string;
  private viewShow = false;

  constructor(
    @inject(MainWindow)
    private readonly mainWindow: MainWindow,
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
    @inject(BrowserWindow)
    private readonly browserWindow: BrowserWindow,
    @inject(GoConfigCache)
    private readonly configCache: GoConfigCache,
    @inject(SniffingHelper)
    private readonly sniffingHelper: SniffingHelper,
  ) {
    this.blockingRequested = Boolean(this.configCache.get("blockAds"));
    this.blockerLoader = new AdBlockerLoader(
      () => ElectronBlocker.fromLists(fetch, [EASYLIST_URL]),
      () => this.logger.error("[AdBlocker] list load failed"),
    );

    const { useProxy, proxy, privacy } = this.configCache.store;

    this.sniffingHelper.start(privacy);
    this.sniffingHelper.on("source", this.onSource);

    this.setDefaultSession(privacy, true);
    this.setProxy(useProxy, proxy);
  }

  async init(): Promise<void> {
    if (this.view) return;

    this.view = new WebContentsView({
      webPreferences: {
        partition: this.defaultSession,
        preload: preload,
      },
    });

    if (isDev && process.env.OPEN_DEVTOOLS === "true") {
      this.view.webContents.openDevTools();
    }

    this.view.setBackgroundColor("#fff");
    const { isMobile, audioMuted } = this.configCache.store;
    this.setAudioMuted(audioMuted);
    this.setUserAgent(isMobile);

    this.view.webContents.on("dom-ready", this.onDomReady);
    this.view.webContents.on("did-navigate", this.onDidNavigate);
    this.view.webContents.on("did-fail-load", this.onDidFailLoad);
    this.view.webContents.on("did-navigate-in-page", this.onDidNavigateInPage);
    this.view.webContents.on("page-title-updated", this.onPageTitleUpdated);
    this.view.webContents.on("will-navigate", this.onWillNavigate);
    this.view.webContents.setWindowOpenHandler(this.onOpenNewWindow);
  }

  onWillNavigate = (e: Event, url: string) => {
    if (isDeeplink(url)) {
      e.preventDefault();
    }
  };

  onDomReady = () => {
    if (!this.view) return;
    const pageInfo = this.getPageInfo();
    this.sniffingHelper.update(pageInfo);
    this.window?.webContents.send("browser:domReady", pageInfo);
  };

  onDidNavigate = async () => {
    if (!this.view) return;
    const pageInfo = this.getPageInfo();
    this.sniffingHelper.update(pageInfo);
    this.window?.webContents.send("browser:didNavigate", pageInfo);

    try {
      const content = await readFile(pluginUrl, "utf-8");
      await this.view.webContents.executeJavaScript(content);
    } catch {
      // empty
    }

    this.sniffingHelper.checkPageInfo();
  };

  onDidFailLoad = (e: Event, code: number, desc: string) => {
    this.window?.webContents.send("browser:failLoad", { code, desc });
    this.logger.error(`[Webview] fail load: ${code} ${desc}`);
  };

  onDidNavigateInPage = () => {
    if (!this.view) return;
    const pageInfo = this.getPageInfo();
    this.sniffingHelper.update(pageInfo);
    this.sniffingHelper.checkPageInfo();
    this.window?.webContents.send("browser:didNavigateInPage", pageInfo);
  };

  onPageTitleUpdated = () => {
    if (!this.view) return;
    const pageInfo = this.getPageInfo();
    this.sniffingHelper.update(pageInfo);
  };

  onOpenNewWindow = ({ url }: HandlerDetails) => {
    void this.loadURL(url);

    return { action: "deny" } as { action: "deny" };
  };

  onSource = async (item: SourceParams) => {
    if (!this.view) return;
    const enrichedItem = await this.withBilibiliSessionCookies(item);
    // Send to the window for processing
    // Previously addDownloadTask was called here; now handled by Go server
    this.window?.webContents.send("browser:sourceDetected", enrichedItem);
  };

  async withBilibiliSessionCookies<
    T extends Pick<SourceParams, "type" | "headers">,
  >(item: T): Promise<T> {
    if (item.type !== DownloadType.bilibili || hasCookieHeader(item.headers)) {
      return item;
    }

    const cookies = await this.session.cookies.get({
      url: "https://www.bilibili.com",
    });
    if (cookies.length === 0) return item;

    const cookieHeader = cookies
      .map(({ name, value }) => `${name}=${value}`)
      .join("; ");
    const headers = [item.headers, `Cookie:${cookieHeader}`]
      .filter(Boolean)
      .join("\n");
    return { ...item, headers };
  }

  getPageInfo() {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    return {
      title: this.view.webContents.getTitle(),
      url: this.view.webContents.getURL(),
    };
  }

  getBounds(): Electron.Rectangle {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    return this.view.getBounds();
  }

  setBounds(bounds: Electron.Rectangle): void {
    if (!this.view) return;
    this.view.setBounds(bounds);
  }

  setBackgroundColor(color: string): void {
    if (!this.view) return;
    this.view.setBackgroundColor(color);
  }

  show() {
    if (!this.view) return;
    this.window?.contentView.addChildView(this.view);
    this.viewShow = true;
  }

  hide() {
    if (!this.view) return;
    this.window?.contentView.removeChildView(this.view);
    this.viewShow = false;
  }

  async loadURL(url: string): Promise<void> {
    // Start loading url
    if (!this.view) {
      await this.init();
    }
    if (!this.view) return;

    this.blockingRequested = Boolean(this.configCache.get("blockAds"));
    if (this.blockingRequested) {
      await this.enableBlocking();
    }

    // 1. Stop current navigation
    this.view.webContents.stop();

    // 2. Load a new url
    await this.view.webContents.loadURL(url);
  }

  async goBack() {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    const { webContents } = this.view;
    if (webContents.navigationHistory.canGoBack()) {
      webContents.navigationHistory.goBack();
      return true;
    } else {
      this.destroyView();
      return false;
    }
  }

  async reload() {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    this.view.webContents.reload();
  }

  async goHome() {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    this.view.webContents.stop();
    this.view.webContents.clearHistory();
    this.destroyView();
  }

  get window() {
    if (this.browserWindow.window) return this.browserWindow.window;
    if (this.mainWindow.window) return this.mainWindow.window;

    this.logger.error("Current window not found");
    return null;
  }

  private get session() {
    return session.fromPartition(this.defaultSession);
  }

  private enableProxy(proxy: string) {
    enableSessionProxy(this.session, this.logger, proxy);
  }

  private disableProxy() {
    this.session.setProxy({ proxyRules: "" });
    this.logger.info(`[Proxy] disable proxy`);
  }

  setProxy(useProxy: boolean, proxy: string): void {
    if (useProxy) {
      this.enableProxy(proxy);
    } else {
      this.disableProxy();
    }
  }

  setBlocking(enableBlocking: boolean): void {
    this.blockingRequested = enableBlocking;
    if (enableBlocking) {
      void this.enableBlocking();
    } else {
      this.disableBlocking();
    }
  }

  private async enableBlocking(): Promise<void> {
    this.blocker = await this.blockerLoader.load();
    if (!this.blocker) {
      return;
    }
    if (!this.blockingRequested) return;

    const blockingSession = this.session;
    if (this.blockingSession === blockingSession) {
      return;
    }

    if (this.blockingSession) {
      this.blocker.disableBlockingInSession(this.blockingSession);
      this.blockingSession = undefined;
      this.logger.info(`[AdBlocker] disable`);
    }

    if (this.blocker.isBlockingEnabled(blockingSession)) {
      this.blockingSession = blockingSession;
      return;
    }

    try {
      this.blocker.enableBlockingInSession(blockingSession);
      this.blockingSession = blockingSession;
      this.logger.info(`[AdBlocker] enable`);
    } catch {
      this.logger.error("[AdBlocker] enable failed");
    }
  }

  private disableBlocking() {
    if (!this.blocker || !this.blockingSession) {
      return;
    }
    if (!this.blocker.isBlockingEnabled(this.blockingSession)) {
      this.blockingSession = undefined;
      return;
    }
    this.blocker.disableBlockingInSession(this.blockingSession);
    this.blockingSession = undefined;
    this.logger.info(`[AdBlocker] disable`);
  }

  setAudioMuted(audioMuted?: boolean) {
    if (!this.view) return;
    this.view.webContents.setAudioMuted(audioMuted ? true : false);
    this.logger.info(`Play audio: ${!audioMuted}`);
  }

  setUserAgent(isMobile?: boolean) {
    if (!this.view) return;
    if (isMobile) {
      this.view.webContents.setUserAgent(mobileUA);
    } else {
      this.view.webContents.setUserAgent(pcUA);
    }
    this.logger.info(`[UA] User-Agent: ${isMobile ? "mobile" : "PC"}`);
  }

  async captureView(): Promise<Electron.NativeImage | null> {
    if (!this.view) {
      throw new Error(i18n.t("browserViewNotFound"));
    }
    if (!this.viewShow) {
      return null;
    }
    return this.view.webContents.capturePage();
  }

  sendToWindow(channel: string, ...args: unknown[]) {
    this.window?.webContents.send(channel, ...args);
  }

  private removeViewListeners() {
    if (!this.view) return;
    const { webContents } = this.view;
    webContents.removeListener("dom-ready", this.onDomReady);
    webContents.removeListener("did-navigate", this.onDidNavigate);
    webContents.removeListener("did-fail-load", this.onDidFailLoad);
    webContents.removeListener(
      "did-navigate-in-page",
      this.onDidNavigateInPage,
    );
    webContents.removeListener("page-title-updated", this.onPageTitleUpdated);
    webContents.removeListener("will-navigate", this.onWillNavigate);
  }

  destroyView() {
    if (this.view) {
      this.removeViewListeners();
      this.view.webContents.close();
      this.window?.contentView.removeChildView(this.view);
    }
    this.view = null;
  }

  async clearCache() {
    await this.session.clearCache();
    await this.session.clearStorageData();
  }

  setDefaultSession(isPrivacy = false, init = false) {
    this.logger.info(`[Session] ${isPrivacy ? "Privacy" : "Persist"} Mode`);
    if (isPrivacy) {
      this.defaultSession = PRIVACY_WEBVIEW;
    } else {
      this.defaultSession = PERSIST_WEBVIEW;
    }

    if (this.view) {
      const { useProxy, proxy } = this.configCache.store;
      this.destroyView();
      this.init();
      this.setProxy(useProxy, proxy);
      this.sniffingHelper.start(isPrivacy);
    }

    if (!init) {
      this.window?.webContents.send("browser:privacyChanged");
    }
  }
}

function hasCookieHeader(headers?: string): boolean {
  if (!headers) return false;
  return headers
    .replace(/\r\n/g, "\n")
    .split("\n")
    .some((line) => line.split(":", 1)[0]?.trim().toLowerCase() === "cookie");
}
