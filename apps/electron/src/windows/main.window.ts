import { provide } from "@inversifyjs/binding-decorators";
import {
  DOWNLOAD_EVENT_NAME,
  type DownloadFailedEvent,
  type DownloadProgress,
  type DownloadProgressEvent,
  type DownloadStoppedEvent,
  type DownloadSuccessEvent,
  type DownloadTask,
} from "@mediago/shared-common";
import { i18n } from "../core/i18n";
import { DownloaderServer } from "../services/downloader.server";
import { app, Menu, Notification } from "electron";
import isDev from "electron-is-dev";
import { inject, injectable } from "inversify";
import _ from "lodash";
import Window from "../core/window";
import { preloadUrl } from "../utils";
import { defaultScheme, isWin } from "../constants";
import GoConfigCache from "../services/go-config-cache";
import ElectronLogger from "../vendor/ElectronLogger";
import ElectronStore from "../vendor/ElectronStore";

@injectable()
@provide()
export default class MainWindow extends Window {
  url = isDev ? "http://localhost:8500/" : `${defaultScheme}://index.html/`;
  private initialUrl: string | null = null;

  constructor(
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
    @inject(ElectronStore)
    private readonly store: ElectronStore,
    @inject(GoConfigCache)
    private readonly configCache: GoConfigCache,
    @inject(DownloaderServer)
    private readonly downloaderServer: DownloaderServer,
  ) {
    super({
      width: 1100,
      minWidth: 1100,
      height: 680,
      minHeight: 680,
      show: false,
      frame: true,
      webPreferences: {
        preload: preloadUrl,
        spellcheck: false,
      },
    });

    this.downloaderServer.on("download-success", this.onDownloadSuccess);
    this.downloaderServer.on("download-failed", this.onDownloadFailed);
    this.downloaderServer.on("download-start", this.onDownloadStart);
    this.downloaderServer.on("download-progress", this.onDownloadProgress);
    this.downloaderServer.on("download-stop", this.onDownloadStop);
  }

  closeMainWindow = () => {
    const { closeMainWindow } = this.configCache.store;
    if (closeMainWindow) {
      app.quit();
    }
  };

  onDownloadProgress = async (tasks: DownloadProgress[]) => {
    const data: DownloadProgressEvent = {
      type: "progress",
      data: tasks,
    };
    this.send(DOWNLOAD_EVENT_NAME, data);
  };

  init(): void {
    if (this.window) {
      // If the window already exists, it is displayed directly
      this.window.show();
      return;
    }

    Menu.setApplicationMenu(null);

    this.window = this.create();

    const mainBounds = this.store.get("mainBounds");
    if (mainBounds) {
      this.window.setBounds(mainBounds);
    }

    // Handle current window resize
    this.window.on("resized", this.handleResize);
    this.window.on("close", this.closeMainWindow);

    app.on("open-url", (event, url) => {
      event.preventDefault();
      this.handleUrl(url);
    });
  }

  handleResize = () => {
    if (!this.window) return;

    const bounds = this.window.getBounds();
    this.store.set("mainBounds", _.omit(bounds, ["x", "y"]));
  };

  // DB status updates are now handled by Go queue callbacks
  onDownloadSuccess = async (id: number) => {
    this.logger.info(`taskId: ${id} success`);

    const promptTone = this.configCache.get("promptTone");
    if (promptTone) {
      new Notification({
        title: i18n.t("downloadSuccess"),
        body: i18n.t("videoDownloadSuccess", { name: String(id) }),
      }).show();
    }

    const data: DownloadSuccessEvent = {
      type: "success",
      data: { id } as unknown as DownloadTask,
    };
    this.send(DOWNLOAD_EVENT_NAME, data);
  };

  onDownloadFailed = async (id: number, err: unknown) => {
    this.logger.info(`taskId: ${id} failed`, err);

    const promptTone = this.configCache.get("promptTone");
    if (promptTone) {
      new Notification({
        title: i18n.t("downloadFailed"),
        body: i18n.t("videoDownloadFailed", { name: String(id) }),
      }).show();
    }

    const data: DownloadFailedEvent = {
      type: "failed",
      data: { id, error: String(err) },
    };
    this.send(DOWNLOAD_EVENT_NAME, data);
  };

  onDownloadStart = async (id: number) => {
    this.logger.info(`taskId: ${id} start`);
  };

  onDownloadStop = async (id: number) => {
    this.logger.info(`taskId: ${id} stopped`);

    const data: DownloadStoppedEvent = {
      type: "stopped",
      data: { id },
    };
    this.send(DOWNLOAD_EVENT_NAME, data);
  };

  showWindow(url?: string) {
    if (isWin) {
      if (this.window) {
        if (this.window.isMinimized()) {
          this.window.restore();
        }
        if (this.window.isVisible()) {
          this.window.focus();
        } else {
          this.window.show();
        }
      } else {
        this.init();
      }

      if (url) {
        this.window!.loadURL(url);
      }
    }
  }

  // Handle URL in the form of mediago://
  handleUrl(url: string) {
    if (!this.window) {
      this.init();
    }

    if (this.window) {
      if (this.window.isMinimized()) {
        this.window.restore();
      }
      this.window.focus();
    }

    if (url) {
      this.window!.loadURL(url);
    }
  }
}
