import { provide } from "@inversifyjs/binding-decorators";
import {
  type Controller,
  type DownloadTask,
  IPC,
} from "@mediago/shared-common";
import { handle } from "../core/decorators";
import { DownloaderServer } from "../services/downloader.server";
import OverlayDialogService from "../services/overlay-dialog.service";
import { TYPES } from "../types/symbols";
import { type IpcMainEvent } from "electron";
import { inject, injectable } from "inversify";
import { SniffingHelper } from "../services/sniffing-helper.service";
import WebviewService from "../services/webview.service";

@injectable()
@provide(TYPES.Controller)
export default class WebviewController implements Controller {
  constructor(
    @inject(WebviewService)
    private readonly webview: WebviewService,
    @inject(DownloaderServer)
    private readonly downloaderServer: DownloaderServer,
    @inject(SniffingHelper)
    private readonly sniffingHelper: SniffingHelper,
    @inject(OverlayDialogService)
    private readonly overlayDialog: OverlayDialogService,
  ) {}

  @handle(IPC.browser.setBounds)
  async setWebviewBounds(e: IpcMainEvent, bounds: Electron.Rectangle) {
    this.webview.setBounds(bounds);
  }

  @handle(IPC.browser.loadURL)
  async browserViewLoadUrl(e: IpcMainEvent, url: string): Promise<void> {
    await this.webview.loadURL(url);
  }

  @handle(IPC.browser.back)
  async webviewGoBack(): Promise<boolean> {
    return this.webview.goBack();
  }

  @handle(IPC.browser.reload)
  async webviewReload() {
    await this.webview.reload();
  }

  @handle(IPC.browser.show)
  async webviewShow() {
    this.webview.show();
  }

  @handle(IPC.browser.hide)
  async webviewHide() {
    this.webview.hide();
  }

  @handle(IPC.browser.home)
  async webviewGoHome() {
    await this.webview.goHome();
  }

  @handle(IPC.browser.setUserAgent)
  async webviewChangeUserAgent(e: IpcMainEvent, isMobile: boolean) {
    this.webview.setUserAgent(isMobile);
    const client = this.downloaderServer.getClient();
    await client.setConfigKey("isMobile", isMobile);
  }

  @handle(IPC.browser.pluginReady)
  async pluginReady() {
    this.sniffingHelper.pluginReady();
  }

  @handle(IPC.browser.clearCache)
  async clearWebviewCache() {
    return this.webview.clearCache();
  }

  @handle(IPC.browser.showDownloadDialog)
  async showDownloadDialog(e: IpcMainEvent, data: DownloadTask[]) {
    this.overlayDialog.show(
      await Promise.all(
        data.map(async (task) =>
          this.webview.withBilibiliSessionCookies({
            ...task,
            headers:
              task.headers || this.sniffingHelper.getPageHeaders(task.type),
          }),
        ),
      ),
    );
  }

  @handle(IPC.browser.dismissOverlayDialog)
  async dismissOverlayDialog() {
    this.overlayDialog.hide();
  }
}
