import { provide } from "@inversifyjs/binding-decorators";
import {
  IpcEvent,
  type OpenUpdateLogsResult,
  type UpdateCheckResult,
  type UpdateErrorPhase,
  type UpdateState,
} from "@mediago/common";
import { app, shell } from "electron";
import isDev from "electron-is-dev";
import {
  autoUpdater as defaultAutoUpdater,
  type ProgressInfo,
  type UpdateInfo,
} from "electron-updater";
import { inject, injectable } from "inversify";
import { i18n } from "../core/i18n";
import { logDir } from "../constants";
import MainWindow from "../windows/main.window";
import ElectronLogger from "./ElectronLogger";
import VerifiedNsisUpdater from "./VerifiedNsisUpdater";

const autoUpdater =
  process.platform === "win32" ? new VerifiedNsisUpdater() : defaultAutoUpdater;

const GITHUB_RELEASES_URL = "https://github.com/mediago-dev/mediago/releases";

type UpdateInitialization = {
  allowBeta: boolean;
  autoUpgrade: boolean;
};

type RuntimeUpdateChannel = "beta" | "latest";

function updateChannel(allowBeta: boolean): RuntimeUpdateChannel {
  return allowBeta ? "beta" : "latest";
}

function clampProgress(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(100, Math.max(0, percent));
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof Error) {
    const code =
      "code" in error && typeof error.code === "string"
        ? error.code
        : "UPDATE_FAILED";
    return { code, message: error.message };
  }
  return { code: "UPDATE_FAILED", message: String(error) };
}

@injectable()
@provide()
export default class UpdateService {
  private readonly testBuild = /-test\.\d+$/.test(app.getVersion());
  private initialized = false;
  private allowBeta = false;
  private channel: RuntimeUpdateChannel = "latest";
  private phase: UpdateErrorPhase = "unknown";
  private state: UpdateState = {
    status: "idle",
    currentVersion: app.getVersion(),
    progress: 0,
    autoDownload: true,
    portable: Boolean(process.env.PORTABLE_EXECUTABLE_FILE),
  };

  constructor(
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
    @inject(MainWindow)
    private readonly mainWindow: MainWindow,
  ) {}

  init({ allowBeta, autoUpgrade }: UpdateInitialization): void {
    if (this.initialized) return;
    this.initialized = true;

    autoUpdater.disableWebInstaller = true;
    autoUpdater.logger = this.logger.logger;
    this.configureChannel(allowBeta);
    autoUpdater.autoDownload = this.testBuild ? false : autoUpgrade;
    if (this.testBuild) autoUpdater.autoInstallOnAppQuit = false;
    if (isDev) autoUpdater.forceDevUpdateConfig = true;

    this.patchState({ autoDownload: autoUpdater.autoDownload });
    this.registerListeners();

    if (this.state.portable || this.testBuild) return;
    if (autoUpgrade) {
      void this.autoUpdate();
    } else {
      this.scheduleInitialCheck();
    }
  }

  getState(): UpdateState {
    return structuredClone(this.state);
  }

  async manualUpdate(): Promise<UpdateCheckResult> {
    if (this.state.portable || this.testBuild) {
      try {
        await shell.openExternal(GITHUB_RELEASES_URL);
        return {
          mode: "external",
          externalUrl: GITHUB_RELEASES_URL,
          state: this.getState(),
        };
      } catch (error) {
        this.setError("check", error);
        return { mode: "external", state: this.getState() };
      }
    }
    if (["checking", "downloading"].includes(this.state.status)) {
      return { mode: "in-app", state: this.getState() };
    }

    this.phase = "check";
    this.patchState({
      status: "checking",
      targetVersion: undefined,
      progress: 0,
      error: undefined,
    });
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (this.getState().status !== "error") this.setError("check", error);
    }
    return { mode: "in-app", state: this.getState() };
  }

  async startDownload(): Promise<UpdateState> {
    if (this.state.portable || this.testBuild) {
      try {
        await shell.openExternal(GITHUB_RELEASES_URL);
      } catch (error) {
        this.setError("download", error);
      }
      return this.getState();
    }
    if (this.state.status === "downloading") return this.getState();
    if (this.state.status !== "available") {
      this.setError("download", new Error(i18n.t("updateCheckRequired")));
      return this.getState();
    }

    this.phase = "download";
    this.patchState({ status: "downloading", progress: 0, error: undefined });
    try {
      await autoUpdater.downloadUpdate();
    } catch (error) {
      if (this.getState().status !== "error") this.setError("download", error);
    }
    return this.getState();
  }

  async install(): Promise<UpdateState> {
    if (this.testBuild) {
      this.setError("install", new Error("Test builds cannot install updates"));
      return this.getState();
    }
    if (this.state.status !== "downloaded") {
      this.setError("install", new Error(i18n.t("updateNotDownloaded")));
      return this.getState();
    }

    this.phase = "install";
    try {
      autoUpdater.quitAndInstall();
    } catch (error) {
      this.setError("install", error);
    }
    return this.getState();
  }

  changeAllowBeta(allowBeta: boolean): void {
    if (this.allowBeta === allowBeta) return;

    this.configureChannel(allowBeta);
    if (
      !this.initialized ||
      this.state.portable ||
      this.testBuild ||
      ["checking", "downloading", "downloaded"].includes(this.state.status)
    ) {
      return;
    }
    void this.backgroundCheck();
  }

  changeAutoUpgrade(autoUpgrade: boolean): void {
    if (this.testBuild) return;
    autoUpdater.autoDownload = autoUpgrade;
    this.patchState({ autoDownload: autoUpgrade });
    if (autoUpgrade && this.state.status === "available") {
      void this.startDownload();
    }
  }

  async openLogDirectory(): Promise<OpenUpdateLogsResult> {
    const error = await shell.openPath(logDir);
    return error ? { opened: false, error } : { opened: true };
  }

  getDiagnosticInfo(): string {
    const error = this.state.error;
    return [
      "MediaGo update diagnostics",
      `Generated: ${new Date().toISOString()}`,
      `Current version: ${this.state.currentVersion}`,
      `Target version: ${this.state.targetVersion ?? "unknown"}`,
      `Status: ${this.state.status}`,
      `Progress: ${this.state.progress.toFixed(1)}%`,
      `Platform: ${process.platform}`,
      `Architecture: ${process.arch}`,
      `Portable: ${String(this.state.portable)}`,
      `Auto download: ${String(this.state.autoDownload)}`,
      `Update channel: ${this.channel}`,
      `Allow prerelease: ${String(this.allowBeta)}`,
      `Packaged: ${String(app.isPackaged)}`,
      `Error phase: ${error?.phase ?? "none"}`,
      `Error code: ${error?.code ?? "none"}`,
      `Error message: ${error?.message ?? "none"}`,
      `Log directory: ${logDir}`,
    ].join("\n");
  }

  private registerListeners(): void {
    autoUpdater.on("checking-for-update", () => {
      this.phase = "check";
      this.patchState({
        status: "checking",
        targetVersion: undefined,
        progress: 0,
        error: undefined,
      });
      this.mainWindow.send(IpcEvent.update.checking);
    });
    autoUpdater.on("update-available", (info: UpdateInfo) => {
      const nextStatus = autoUpdater.autoDownload ? "downloading" : "available";
      this.phase = autoUpdater.autoDownload ? "download" : "unknown";
      this.patchState({
        status: nextStatus,
        targetVersion: info.version,
        progress: 0,
        error: undefined,
        autoDownload: autoUpdater.autoDownload,
      });
      this.mainWindow.send(IpcEvent.update.available);
    });
    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      this.phase = "unknown";
      this.patchState({
        status: "not-available",
        targetVersion: info.version,
        progress: 0,
        error: undefined,
      });
      this.mainWindow.send(IpcEvent.update.notAvailable);
    });
    autoUpdater.on("download-progress", (progress: ProgressInfo) => {
      this.phase = "download";
      const percent = clampProgress(progress.percent);
      this.logger.info(`Update download progress: ${percent}`);
      this.patchState({ status: "downloading", progress: percent });
      this.mainWindow.send(IpcEvent.update.downloadProgress, progress);
    });
    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      this.phase = "unknown";
      this.patchState({
        status: "downloaded",
        targetVersion: info.version,
        progress: 100,
        error: undefined,
      });
      this.mainWindow.send(IpcEvent.update.downloaded);
    });
    autoUpdater.on("error", (error: Error) => {
      this.setError(this.phase, error);
    });
  }

  private configureChannel(allowBeta: boolean): void {
    const channel = updateChannel(allowBeta);

    // electron-updater sets allowDowngrade=true whenever channel is assigned.
    // Reset it afterwards so opting out of Beta never installs an older stable
    // version over a newer prerelease build.
    autoUpdater.channel = channel;
    autoUpdater.allowPrerelease = allowBeta;
    autoUpdater.allowDowngrade = false;
    this.allowBeta = allowBeta;
    this.channel = channel;
  }

  private scheduleInitialCheck(): void {
    setTimeout(() => {
      void this.backgroundCheck();
    }, 60_000);
  }

  private async backgroundCheck(): Promise<void> {
    this.phase = "check";
    try {
      await autoUpdater.checkForUpdates();
    } catch (error) {
      if (this.getState().status !== "error") this.setError("check", error);
    }
  }

  private async autoUpdate(): Promise<void> {
    this.phase = "check";
    try {
      await autoUpdater.checkForUpdatesAndNotify({
        title: i18n.t("autoUpdateSuccess"),
        body: i18n.t("nextTimeWillAutoInstall"),
      });
    } catch (error) {
      if (this.getState().status !== "error") this.setError(this.phase, error);
    }
  }

  private patchState(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch };
    this.mainWindow.send(IpcEvent.update.stateChanged, this.getState());
  }

  private setError(phase: UpdateErrorPhase, error: unknown): void {
    const details = errorDetails(error);
    this.logger.error(`Update ${phase} failed [${details.code}]`, error);
    this.phase = "unknown";
    this.patchState({
      status: "error",
      error: { ...details, phase },
    });
  }
}
