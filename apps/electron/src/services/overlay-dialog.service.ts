import { provide } from "@inversifyjs/binding-decorators";
import { type DownloadTask, IpcEvent } from "@mediago/shared-common";
import { WebContentsView } from "electron";
import isDev from "electron-is-dev";
import { inject, injectable } from "inversify";
import { defaultScheme, preloadUrl } from "../utils";
import BrowserWindow from "../windows/browser.window";
import MainWindow from "../windows/main.window";
import ElectronLogger from "../vendor/ElectronLogger";

@injectable()
@provide()
export default class OverlayDialogService {
  private view: WebContentsView | null = null;
  private visible = false;
  private ready = false;
  private pendingData: Omit<DownloadTask, "id">[] | null = null;

  private readonly url = isDev
    ? "http://localhost:8500/download-dialog"
    : `${defaultScheme}://index.html/download-dialog`;

  constructor(
    @inject(MainWindow)
    private readonly mainWindow: MainWindow,
    @inject(BrowserWindow)
    private readonly browserWindow: BrowserWindow,
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
  ) {}

  async init(): Promise<void> {
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadUrl,
        transparent: true,
      },
    });

    this.view.setBackgroundColor("#00000000");

    this.view.webContents.on("dom-ready", () => {
      this.ready = true;
      if (this.pendingData) {
        this.view?.webContents.send(
          IpcEvent.browser.showOverlayDialog,
          this.pendingData,
        );
        this.pendingData = null;
      }
    });

    if (isDev) {
      this.view.webContents.openDevTools({ mode: "detach" });
    }

    await this.view.webContents.loadURL(this.url);
  }

  private get window() {
    if (this.browserWindow.window) return this.browserWindow.window;
    if (this.mainWindow.window) return this.mainWindow.window;
    return null;
  }

  show(data: Omit<DownloadTask, "id">[]): void {
    if (!this.view || !this.window) {
      this.logger.error("[OverlayDialog] view or window not available");
      return;
    }

    if (this.visible) return;

    // Set bounds to cover the full window content area
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });

    // Add as topmost child view
    this.window.contentView.addChildView(this.view);
    this.visible = true;

    // Listen for resize to keep overlay in sync
    this.window.on("resize", this.onResize);

    // Send data to the overlay renderer
    if (this.ready) {
      this.view.webContents.send(IpcEvent.browser.showOverlayDialog, data);
    } else {
      this.pendingData = data;
    }
  }

  hide(): void {
    if (!this.view || !this.window || !this.visible) return;

    this.window.contentView.removeChildView(this.view);
    this.visible = false;
    this.window.removeListener("resize", this.onResize);
  }

  private onResize = () => {
    if (!this.view || !this.window || !this.visible) return;
    const { width, height } = this.window.getContentBounds();
    this.view.setBounds({ x: 0, y: 0, width, height });
  };
}
