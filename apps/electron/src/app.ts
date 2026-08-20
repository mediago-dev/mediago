import { resolve } from "node:path";
import { provide } from "@inversifyjs/binding-decorators";
import { i18n } from "./core/i18n";
import { DownloaderServer } from "./services/downloader.server";
import {
  app,
  BrowserWindow,
  Menu,
  nativeImage,
  nativeTheme,
  Tray,
} from "electron";
import { inject, injectable } from "inversify";
import TrayIcon from "../assets/icon.ico";
import TrayTemplate from "../assets/trayTemplate.png";
import ProtocolService from "./core/protocol";
import ElectronRouter from "./core/router";
import { db, isMac, logDir } from "./constants";
import ElectronDevtools from "./vendor/ElectronDevtools";
import ElectronUpdater from "./vendor/ElectronUpdater";
import GoConfigCache from "./services/go-config-cache";
import OverlayDialogService from "./services/overlay-dialog.service";
import WebviewService from "./services/webview.service";
import BrowserWindowService from "./windows/browser.window";
import MainWindow from "./windows/main.window";
import "./controller";
import ElectronLogger from "./vendor/ElectronLogger";
import { AppTheme, IpcEvent, resolveAppLanguage } from "@mediago/shared-common";
import { installApplicationMenu } from "./core/application-menu";
import ShareIntentService from "./services/share-intent.service";

@injectable()
@provide()
export default class ElectronApp {
  private tray?: Tray;
  private externalPresentationPending = false;

  constructor(
    @inject(MainWindow)
    private readonly mainWindow: MainWindow,
    @inject(ProtocolService)
    private readonly protocol: ProtocolService,
    @inject(ElectronUpdater)
    private readonly updater: ElectronUpdater,
    @inject(ElectronRouter)
    private readonly router: ElectronRouter,
    @inject(ElectronDevtools)
    private readonly devTools: ElectronDevtools,
    @inject(DownloaderServer)
    private readonly downloaderServer: DownloaderServer,
    @inject(WebviewService)
    private readonly webviewService: WebviewService,
    @inject(OverlayDialogService)
    private readonly overlayDialogService: OverlayDialogService,
    @inject(GoConfigCache)
    private readonly configCache: GoConfigCache,
    @inject(BrowserWindowService)
    private readonly browserWindow: BrowserWindowService,
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
    @inject(ShareIntentService)
    private readonly shareIntentService: ShareIntentService,
  ) {}

  private async serviceInit(): Promise<void> {
    this.mainWindow.init();
    this.overlayDialogService.init();
  }
  handleExternalCommandLine(
    commandLine: readonly string[],
    present = true,
  ): boolean {
    const result = this.shareIntentService.handleCommandLine(commandLine);
    return this.acceptExternalInvocation(result.handled, present);
  }

  handleExternalUrl(url: string, present = true): boolean {
    const result = this.shareIntentService.handleProtocolUrl(url);
    return this.acceptExternalInvocation(result.handled, present);
  }

  presentPendingExternalInvocations() {
    if (!this.externalPresentationPending) return;
    this.externalPresentationPending = false;
    this.mainWindow.showWindow();
    if (this.shareIntentService.hasPending()) {
      this.mainWindow.send(IpcEvent.app.shareIntentAvailable);
    }
  }

  private acceptExternalInvocation(handled: boolean, present: boolean) {
    if (!handled) return false;
    this.externalPresentationPending = true;
    if (present) this.presentPendingExternalInvocations();
    return true;
  }

  private async vendorInit() {
    this.devTools.init();
  }

  async init(): Promise<void> {
    this.protocol.create();
    this.router.init();
    installApplicationMenu();

    // 1. Show the window immediately — must happen regardless of backend status
    await this.vendorInit();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.mainWindow.init();
      }
    });

    this.initTray();

    // 2. Start Go download service in the background; errors are non-fatal
    let updaterConfig = { allowBeta: false, autoUpgrade: true };
    try {
      await this.downloaderServer.start({
        logDir: logDir,
        dbPath: db,
      });

      // 3. Read config from Go (single source of truth) and seed cache
      const client = this.downloaderServer.getClient();
      const { data: config } = await client.getConfig();
      this.configCache.seed(config as any);
      if (config.blockAds) {
        this.webviewService.setBlocking(true);
      }
      updaterConfig = {
        allowBeta: Boolean(config.allowBeta),
        autoUpgrade: config.autoUpgrade !== false,
      };

      // 4. Apply initial config
      nativeTheme.themeSource = (config.theme || "system") as AppTheme;
      i18n.changeLanguage(resolveAppLanguage(config.language, app.getLocale()));
    } catch (err) {
      this.logger.error("[ElectronApp] Failed to start Go core service:", err);
    }

    this.updater.init(updaterConfig);

    // 5. Listen for Go config changes → update cache + platform side effects + IPC to UI
    this.downloaderServer.on(
      "config-changed",
      (key: string, value: unknown) => {
        this.configCache.update(key, value);

        // Forward to UI windows
        this.mainWindow.send("config:changed", { key, value });
        this.browserWindow.send("config:changed", { key, value });

        // Platform side effects
        const handlers: Record<string, (v: any) => void> = {
          theme: (v) => {
            nativeTheme.themeSource = v;
          },
          useProxy: (v) => {
            this.webviewService.setProxy(v, this.configCache.get("proxy"));
          },
          proxy: (v) => {
            this.webviewService.setProxy(this.configCache.get("useProxy"), v);
          },
          blockAds: (v) => {
            this.webviewService.setBlocking(v);
          },
          isMobile: (v) => {
            this.webviewService.setUserAgent(v);
          },
          privacy: (v) => {
            this.webviewService.setDefaultSession(v);
          },
          language: (v) => {
            i18n.changeLanguage(
              resolveAppLanguage(v as string, app.getLocale()),
            );
          },
          allowBeta: (v) => {
            this.updater.changeAllowBeta(v);
          },
          autoUpgrade: (v) => {
            this.updater.changeAutoUpgrade(v);
          },
          audioMuted: (v) => {
            this.webviewService.setAudioMuted(v);
          },
        };
        handlers[key]?.(value);
      },
    );

    await this.serviceInit();
    this.presentPendingExternalInvocations();
  }

  async shutdown(): Promise<void> {
    await this.downloaderServer.stop();
  }

  initTray() {
    let trayIcon = nativeImage.createFromPath(resolve(__dirname, TrayIcon));
    if (isMac) {
      const templateSource = nativeImage.createFromPath(
        resolve(__dirname, TrayTemplate),
      );
      trayIcon = nativeImage.createEmpty();

      for (const scaleFactor of [1, 2]) {
        const size = 16 * scaleFactor;
        trayIcon.addRepresentation({
          scaleFactor,
          dataURL: templateSource
            .resize({ width: size, height: size })
            .toDataURL(),
        });
      }

      trayIcon.setTemplateImage(true);
    }

    const tray = new Tray(trayIcon);
    tray.setToolTip("Media Go");
    tray.addListener("click", () => {
      this.mainWindow.init();
    });
    this.tray = tray;
    this.refreshTrayMenu();

    // Rebuild the tray menu whenever the app language changes so the
    // labels stay in sync with user settings and the OS locale.
    i18n.on("languageChanged", () => this.refreshTrayMenu());
  }

  private refreshTrayMenu() {
    if (!this.tray) return;
    const contextMenu = Menu.buildFromTemplate([
      {
        label: i18n.t("showMainWindow"),
        click: () => this.mainWindow.init(),
      },
      {
        label: i18n.t("exitApp"),
        role: "quit",
      },
    ]);
    this.tray.setContextMenu(contextMenu);
  }
}
