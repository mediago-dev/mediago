import { EventEmitter } from "node:events";
import path from "node:path";
import { provide } from "@inversifyjs/binding-decorators";
import {
  type CreateTaskResponse,
  MediaGoClient,
  type TaskEventEmitter,
  TaskStatus,
} from "@mediago/core-sdk";
import { ServiceRunner } from "@mediago/service-runner";
import {
  DownloadProgress,
  DownloadStatus,
  type DownloadType,
} from "@mediago/shared-common";
import { inject, injectable } from "inversify";
import {
  resolveCoreBinaries,
  resolveDepsBinaries,
} from "../utils/binaryResolver";
import ElectronLogger from "../vendor/ElectronLogger";

export interface DownloadTaskOptions {
  deleteSegments: boolean;
  folder?: string;
  headers?: string[];
  id: string;
  localDir: string;
  name: string;
  proxy?: string;
  type: DownloadType;
  url: string;
}

export interface DownloadServiceOptions {
  logDir: string;
  dbPath: string;
}

interface DownloaderStartOperation {
  promise: Promise<void>;
  runner: ServiceRunner;
  started: boolean;
}

@injectable()
@provide()
export class DownloaderServer extends EventEmitter {
  private serverUrl = "";
  private client: MediaGoClient | null = null;
  private runner: ServiceRunner | null = null;
  private events: TaskEventEmitter | null = null;
  private startOperation: DownloaderStartOperation | null = null;
  private stopping: Promise<void> | null = null;
  private shutdownFailed = false;
  private pollingTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @inject(ElectronLogger)
    private readonly logger: ElectronLogger,
  ) {
    super();
  }

  start(opts: DownloadServiceOptions): Promise<void> {
    if (this.stopping) {
      return Promise.reject(new Error("DownloaderServer is stopping"));
    }
    if (this.shutdownFailed) {
      return Promise.reject(
        new Error("DownloaderServer cannot restart after shutdown failure"),
      );
    }
    if (this.startOperation) return this.startOperation.promise;
    if (this.runner) return Promise.resolve();

    let runner: ServiceRunner;
    try {
      const core = resolveCoreBinaries();
      const deps = resolveDepsBinaries();
      runner = new ServiceRunner({
        executableName: "mediago-core",
        executableDir: path.dirname(core.coreBin),
        preferredPort: 39719,
        internal: false,
        extraArgs: [
          `-log-level=info`,
          `-log-dir=${opts.logDir}`,
          `-schema-path=${core.coreConfig}`,
          `-deps-dir=${deps.depsDir}`,
          `-db-path=${opts.dbPath}`,
          `-config-dir=${path.dirname(opts.dbPath)}`,
        ],
      });
    } catch (error) {
      return Promise.reject(error);
    }

    this.runner = runner;
    const operation = {
      runner,
      started: false,
    } as DownloaderStartOperation;
    operation.promise = this.startRunner(operation);
    this.startOperation = operation;
    void operation.promise.then(
      () => this.clearStartOperation(operation),
      () => this.clearStartOperation(operation),
    );
    return operation.promise;
  }

  private async startRunner(operation: DownloaderStartOperation) {
    const { runner } = operation;
    try {
      await runner.start();
    } catch (error) {
      if (this.runner === runner) this.runner = null;
      throw error;
    }

    operation.started = true;
    if (this.runner !== runner) return;

    this.serverUrl = runner.getURL();

    this.logger.info("Downloader server started at:", this.serverUrl);

    this.client = new MediaGoClient({
      baseURL: this.serverUrl,
    });
    this.events = this.client.streamEvents();
    const events = this.events;

    events.on("download-start", (payload) => {
      this.emit("download-start", payload.id);
      this.startPolling();
    });

    events.on("download-success", (payload) => {
      this.emit("download-success", payload.id);
      this.stopPollingIfIdle();
    });

    events.on("download-failed", (payload) => {
      this.emit("download-failed", payload.id, payload.error);
      this.stopPollingIfIdle();
    });

    events.on("download-stop", (payload) => {
      this.emit("download-stop", payload.id);
      this.stopPollingIfIdle();
    });

    events.on("config-changed", (payload) => {
      this.emit("config-changed", payload.key, payload.value);
    });
  }

  private clearStartOperation(operation: DownloaderStartOperation) {
    if (this.startOperation === operation) this.startOperation = null;
  }

  stop(): Promise<void> {
    if (this.stopping) return this.stopping;

    this.stopPolling();
    const events = this.events;
    this.events = null;
    this.client = null;
    const runner = this.runner;
    this.runner = null;
    this.serverUrl = "";

    let closeFailed = false;
    let closeError: unknown;
    try {
      events?.close();
    } catch (error) {
      closeFailed = true;
      closeError = error;
    }

    if (!runner) {
      if (closeFailed) {
        this.shutdownFailed = true;
        return Promise.reject(closeError);
      }
      return Promise.resolve();
    }

    const startOperation =
      this.startOperation?.runner === runner ? this.startOperation : null;
    const stopping = this.stopRunner(
      runner,
      startOperation,
      closeFailed,
      closeError,
    );
    this.stopping = stopping;
    void stopping.then(
      () => {
        if (this.stopping === stopping) this.stopping = null;
      },
      () => {
        this.shutdownFailed = true;
        if (this.stopping === stopping) this.stopping = null;
      },
    );
    return stopping;
  }

  private async stopRunner(
    runner: ServiceRunner,
    startOperation: DownloaderStartOperation | null,
    closeFailed: boolean,
    closeError: unknown,
  ) {
    if (startOperation) {
      try {
        await startOperation.promise;
      } catch {
        // ServiceRunner.start already cleans up its own failed start.
      }
    }

    let runnerStopFailed = false;
    let runnerStopError: unknown;
    if (!startOperation || startOperation.started) {
      try {
        await runner.stop();
      } catch (error) {
        runnerStopFailed = true;
        runnerStopError = error;
      }
    }

    if (runnerStopFailed) throw runnerStopError;
    if (closeFailed) throw closeError;
  }

  async startTask(
    opts: DownloadTaskOptions,
  ): Promise<CreateTaskResponse | undefined> {
    const taskResult = await this.client?.createTask({
      id: opts.id,
      type: opts.type as any,
      url: opts.url,
      name: opts.name,
      folder: opts.folder,
      headers: opts.headers,
    });
    return taskResult?.data;
  }

  async stopTask(id: string) {
    return this.client?.stopTask(id);
  }

  async getTaskLogs(id: string) {
    const logResult = await this.client?.getTaskLogs(id);
    return logResult?.data.log || "";
  }

  getClient(): MediaGoClient {
    if (!this.client) {
      throw new Error("DownloaderServer not started");
    }
    return this.client;
  }

  async getURL() {
    return this.serverUrl;
  }

  private startPolling() {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(async () => {
      if (!this.client) return;

      try {
        const { data } = await this.client.listTasks();

        const tasks: DownloadProgress[] = data.tasks
          .filter(
            (task) =>
              task.percent &&
              task.percent > 0 &&
              task.percent < 100 &&
              task.status === TaskStatus.Downloading,
          )
          .map((task) => ({
            id: Number(task.id),
            type: task.type,
            percent: String(task.percent || 0),
            speed: task.speed || "",
            isLive: task.isLive || false,
            status: task.status as unknown as DownloadStatus,
          }));

        if (tasks.length > 0) {
          this.emit("download-progress", tasks);
        }
      } catch {
        // ignore
      }
    }, 1000);
  }

  private stopPolling() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
  }

  private async stopPollingIfIdle() {
    if (!this.client) return;
    try {
      const { data } = await this.client.listTasks();
      const hasActive = data.tasks.some(
        (task) => task.status === TaskStatus.Downloading,
      );
      if (!hasActive) {
        this.stopPolling();
      }
    } catch {
      // ignore
    }
  }
}
