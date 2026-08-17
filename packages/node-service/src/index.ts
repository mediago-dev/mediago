import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { createServer as createNetServer } from "node:net";
import { networkInterfaces } from "node:os";
import path from "node:path";
import kill from "tree-kill";
import { isPrivateIPv4, looksVirtual } from "./utils";

/**
 * ServiceRunner configuration options.
 */
export interface ServiceRunnerOptions {
  /** Executable name (e.g. "bin/mediago-core"; `.exe` is appended on Windows). */
  executableName: string;
  /** Directory containing the executable. */
  executableDir: string;
  /** Preferred port; the actual listen port may differ if taken. */
  preferredPort?: number;
  /**
   * Whether to listen only on the loopback interface (127.0.0.1).
   * Defaults to `true`.
   *
   * - `true`  — bind to 127.0.0.1; only the local machine can reach it.
   * - `false` — bind to 0.0.0.0 (every network interface); both the
   *             local machine and the LAN can reach it. `state.host` /
   *             `getURL()` still return the detected LAN IPv4 so the
   *             UI can surface a shareable address, while the actual
   *             listener accepts 127.0.0.1 / localhost too.
   */
  internal?: boolean;
  /** Health-check path (default "/healthy"). */
  healthPath?: string;
  /** Max time to wait for the health check to pass, in ms (default 15000). */
  healthCheckTimeoutMs?: number;
  /** Health-check poll interval, in ms (default 500). */
  healthCheckIntervalMs?: number;
  /** Timeout for a single health-check request, in ms (default 2000). */
  healthRequestTimeoutMs?: number;
  /** Max time to wait for SIGTERM before sending SIGKILL, in ms (default 5000). */
  shutdownTimeoutMs?: number;
  /** Command-line arguments passed to the child process. */
  extraArgs?: string[];
  /** Environment variables passed to the child process. */
  extraEnv?: Record<string, string | undefined>;
}

/**
 * Configuration that can be updated on restart.
 */
export interface ServiceRunnerRestartOptions {
  preferredPort?: number;
  internal?: boolean;
  healthPath?: string;
  healthCheckTimeoutMs?: number;
  healthCheckIntervalMs?: number;
  healthRequestTimeoutMs?: number;
  extraArgs?: string[];
  extraEnv?: Record<string, string | undefined>;
}

/**
 * ServiceRunner runtime state.
 */
export interface ServiceRunnerState {
  pid?: number;
  /** Current listen host. */
  host: string;
  /** Current listen port (0 when not started). */
  port: number;
  url: string;
  started: boolean;
}

/**
 * ServiceRunner events.
 */
export interface ServiceRunnerEvents {
  exit: [code: number | null, signal: NodeJS.Signals | null];
  error: [err: Error];
  stdout: [chunk: Buffer];
  stderr: [chunk: Buffer];
}

/**
 * Child-process service manager.
 * Handles starting, stopping, and supervising the service subprocess.
 */
export class ServiceRunner extends EventEmitter<ServiceRunnerEvents> {
  private childProcess: ChildProcessWithoutNullStreams | null = null;
  private readonly runtimeState: ServiceRunnerState;
  private readonly binaryPath: string;
  private preferredPort?: number;
  private internalOnly: boolean;
  private spawnArguments: readonly string[];
  private baseEnvironment: Record<string, string>;
  private environmentOverrides: Record<string, string | undefined>;
  private healthPath: string;
  private healthCheckTimeoutMs: number;
  private healthCheckIntervalMs: number;
  private healthRequestTimeoutMs: number;
  private shutdownTimeoutMs: number;
  private currentHost: string;

  constructor(options: ServiceRunnerOptions) {
    super();

    // Resolve the binary path (append `.exe` on Windows).
    const executableName =
      process.platform === "win32"
        ? `${options.executableName}.exe`
        : options.executableName;
    this.binaryPath = path.resolve(options.executableDir, executableName);

    // Apply configuration.
    this.preferredPort = options.preferredPort;
    this.internalOnly = options.internal ?? true;
    this.spawnArguments = Object.freeze([...(options.extraArgs ?? [])]);
    this.environmentOverrides = { ...options.extraEnv };
    this.baseEnvironment = ServiceRunner.mergeEnvironmentVariables(
      this.environmentOverrides,
    );
    this.healthPath = options.healthPath ?? "/healthy";
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 15_000;
    this.healthCheckIntervalMs = options.healthCheckIntervalMs ?? 500;
    const requestTimeout = options.healthRequestTimeoutMs ?? 2_000;
    this.healthRequestTimeoutMs = Math.min(
      requestTimeout,
      this.healthCheckTimeoutMs,
    );
    this.shutdownTimeoutMs = options.shutdownTimeoutMs ?? 5_000;
    this.currentHost = this.computeHost();

    // Initialise runtime state.
    this.runtimeState = {
      host: this.currentHost,
      port: this.preferredPort ?? 0,
      url: ServiceRunner.buildURL(
        this.currentHost,
        this.preferredPort ?? Number.NaN,
      ),
      started: false,
    };
  }

  /**
   * Start the service.
   */
  async start(): Promise<ServiceRunnerState> {
    if (this.isRunning()) {
      return this.getState();
    }

    if (this.childProcess) {
      // Clean up a stale child-process handle (e.g. after an abnormal exit).
      this.resetRuntimeState(false);
    }

    await this.ensureBinaryAccessible();
    this.refreshBaseEnvironment();

    const host = this.computeHost();
    this.currentHost = host;
    const resolvedPort = this.preferredPort ?? 0;
    // Bind host ≠ display host:
    //   - `internal: true`  → bind 127.0.0.1 (display is also 127.0.0.1)
    //   - `internal: false` → bind 0.0.0.0 (listen on every interface);
    //                         `state.host` keeps the detected LAN IPv4
    //                         so the UI can surface a shareable address.
    // This lets the Desktop app be reached via 127.0.0.1 AND its LAN IP
    // at the same time, while still showing the LAN URL in settings.
    const bindHost = this.internalOnly ? "127.0.0.1" : "0.0.0.0";

    // Pre-flight port check. Without this, a stray instance (e.g. a
    // background-running installed Desktop app) holding the preferred
    // port causes our freshly-spawned child to fail to bind and exit
    // immediately — but `waitForHealthy()` would still see `/healthy`
    // answered by that other instance and mistakenly call the service
    // "started". Every subsequent request then hits the wrong server.
    // Fail fast with a human-readable error instead.
    if (resolvedPort > 0) {
      const free = await ServiceRunner.isPortFree(bindHost, resolvedPort);
      if (!free) {
        throw new Error(
          `Port ${resolvedPort} on ${bindHost} is already in use. ` +
            `Another instance (e.g. an installed Desktop build running in the ` +
            `background) may be holding it — close it and retry.`,
        );
      }
    }

    const childEnv: Record<string, string> = {
      ...this.baseEnvironment,
      PORT: String(resolvedPort),
      HOST: bindHost,
    };

    try {
      const child = spawn(this.binaryPath, this.spawnArguments, {
        env: childEnv,
        stdio: "pipe",
        windowsHide: process.platform === "win32",
      }) as ChildProcessWithoutNullStreams;

      this.childProcess = child;
      this.runtimeState.pid = child.pid ?? undefined;
      this.runtimeState.started = false;
      this.runtimeState.host = host;
      this.runtimeState.port = resolvedPort;
      this.runtimeState.url = ServiceRunner.buildURL(host, resolvedPort);

      this.attachChildProcessListeners(child);
      await this.waitForHealthy(host, resolvedPort);
      this.runtimeState.started = true;
    } catch (error) {
      if (this.childProcess) {
        try {
          await this.stop();
        } catch {
          this.resetRuntimeState();
        }
      } else {
        this.resetRuntimeState();
      }

      throw error instanceof Error ? error : new Error(String(error));
    }

    return this.getState();
  }

  /**
   * Stop the service, gracefully terminating the process tree.
   */
  async stop(): Promise<void> {
    const child = this.childProcess;
    if (!child?.pid) {
      this.resetRuntimeState();
      return;
    }

    const pid = child.pid;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let shutdownTimeout: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        child.removeListener("exit", handleExit);
        if (shutdownTimeout) clearTimeout(shutdownTimeout);
      };

      const settle = (result: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        result();
      };

      const handleExit = () => {
        settle(resolve);
      };

      const handleKillError = (
        killError: Error | NodeJS.ErrnoException | null | undefined,
      ) => {
        if (!killError) return false;

        if ((killError as NodeJS.ErrnoException).code === "ESRCH") {
          this.resetRuntimeState();
          settle(resolve);
          return true;
        }

        settle(() => reject(killError));
        return true;
      };

      child.once("exit", handleExit);

      kill(pid, "SIGTERM", (killError) => {
        if (settled || handleKillError(killError)) {
          return;
        }

        shutdownTimeout = setTimeout(() => {
          if (settled) return;
          kill(pid, "SIGKILL", (forceKillError) => {
            if (settled) return;
            handleKillError(forceKillError);
          });
        }, this.shutdownTimeoutMs);
      });
    });
  }

  /**
   * Restart the service, optionally applying new configuration first.
   */
  async restart(
    updates?: ServiceRunnerRestartOptions,
  ): Promise<ServiceRunnerState> {
    if (updates) {
      this.applyConfigurationUpdates(updates);
    } else {
      this.refreshBaseEnvironment();
    }

    await this.stop();
    this.resetRuntimeState(false);
    return this.start();
  }

  /**
   * Return a snapshot of the current runtime state.
   */
  getState(): ServiceRunnerState {
    return { ...this.runtimeState };
  }

  /**
   * Return the current service URL.
   */
  getURL(): string {
    return this.runtimeState.url;
  }

  /**
   * Return the child process PID, if any.
   */
  getPID(): number | undefined {
    return this.runtimeState.pid;
  }

  /**
   * Whether the service is currently running.
   */
  isRunning(): boolean {
    return Boolean(this.runtimeState.pid) && this.runtimeState.started;
  }

  /**
   * Actively probe the health endpoint and report whether the service
   * is reachable right now.
   */
  async checkHealth(): Promise<boolean> {
    if (
      !this.runtimeState.started ||
      !this.runtimeState.port ||
      this.runtimeState.port <= 0
    ) {
      return false;
    }

    try {
      await this.probeHealth(this.runtimeState.host, this.runtimeState.port);
      return true;
    } catch {
      return false;
    }
  }

  private applyConfigurationUpdates(
    updates: ServiceRunnerRestartOptions,
  ): void {
    if (updates.preferredPort !== undefined) {
      this.preferredPort = updates.preferredPort;
    }

    if (updates.internal !== undefined) {
      this.internalOnly = updates.internal;
    }

    if (updates.extraArgs !== undefined) {
      this.spawnArguments = Object.freeze([...updates.extraArgs]);
    }

    if (updates.extraEnv) {
      this.updateEnvironmentOverrides(updates.extraEnv);
    }

    if (updates.healthPath !== undefined) {
      this.healthPath = updates.healthPath;
    }

    if (updates.healthCheckTimeoutMs !== undefined) {
      this.healthCheckTimeoutMs = updates.healthCheckTimeoutMs;
    }

    if (updates.healthCheckIntervalMs !== undefined) {
      this.healthCheckIntervalMs = updates.healthCheckIntervalMs;
    }

    if (updates.healthRequestTimeoutMs !== undefined) {
      this.healthRequestTimeoutMs = updates.healthRequestTimeoutMs;
    }

    this.healthRequestTimeoutMs = Math.min(
      this.healthRequestTimeoutMs,
      this.healthCheckTimeoutMs,
    );
    this.refreshBaseEnvironment();
  }

  private updateEnvironmentOverrides(
    overrides: Record<string, string | undefined>,
  ): void {
    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) {
        delete this.environmentOverrides[key];
      } else {
        this.environmentOverrides[key] = value;
      }
    }
  }

  private refreshBaseEnvironment(): void {
    this.baseEnvironment = ServiceRunner.mergeEnvironmentVariables(
      this.environmentOverrides,
    );
  }

  private computeHost(): string {
    if (this.internalOnly) {
      return "127.0.0.1";
    }

    return ServiceRunner.findLanIPv4Address() ?? "127.0.0.1";
  }

  private static mergeEnvironmentVariables(
    extraEnv?: Record<string, string | undefined>,
  ): Record<string, string> {
    const merged = { ...(process.env as Record<string, string>) };

    if (!extraEnv) {
      return merged;
    }

    for (const [key, value] of Object.entries(extraEnv)) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }

    return merged;
  }

  private static findLanIPv4Address(): string | undefined {
    const ifaces = networkInterfaces();
    const result = [];

    for (const [name, infos] of Object.entries(ifaces)) {
      if (!infos) continue;

      for (const info of infos) {
        if (info.internal) continue;
        if (info.family !== "IPv4") continue;
        if (looksVirtual(name, info.mac)) continue;
        if (!isPrivateIPv4(info.address)) continue;
        result.push({ name, ...info });
      }
    }

    if (result.length > 0) {
      return result[0].address;
    }

    return undefined;
  }

  /**
   * Try to bind the given host/port briefly to determine whether it is
   * available. Resolves `true` on success, `false` if the socket errors
   * (EADDRINUSE or similar).
   *
   * Uses a plain TCP server and releases it immediately — the short
   * window between the check and the child's own bind attempt is a
   * theoretical race, but it is sufficient for the real-world case we
   * care about: a long-running stray instance already holding the port.
   */
  private static isPortFree(host: string, port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = createNetServer();
      server.unref();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      try {
        server.listen(port, host);
      } catch {
        resolve(false);
      }
    });
  }

  private static buildURL(host: string, port: number): string {
    if (Number.isFinite(port) && port > 0) {
      return `http://${host}:${port}`;
    }

    return `http://${host}`;
  }

  private async waitForHealthy(host: string, port: number): Promise<void> {
    const deadline = Date.now() + this.healthCheckTimeoutMs;
    let lastError: Error | undefined;

    while (Date.now() < deadline) {
      try {
        await this.probeHealth(host, port);
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (!this.childProcess) {
          break;
        }
      }

      await ServiceRunner.delay(this.healthCheckIntervalMs);
    }

    const reason = lastError ? `: ${lastError.message}` : "";
    throw new Error(
      `Service failed health check (${this.healthPath}) within ${this.healthCheckTimeoutMs} ms${reason}`,
    );
  }

  private async probeHealth(host: string, port: number): Promise<void> {
    const healthURL = this.buildHealthURL(host, port);
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.healthRequestTimeoutMs,
    );

    try {
      const response = await fetch(healthURL, {
        signal: controller.signal,
        redirect: "manual",
      });

      if (!response.ok) {
        throw new Error(
          `Health endpoint responded with status ${response.status}`,
        );
      }
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private buildHealthURL(host: string, port: number): URL {
    if (/^https?:\/\//i.test(this.healthPath)) {
      return new URL(this.healthPath);
    }

    const normalizedPath = this.healthPath.startsWith("/")
      ? this.healthPath
      : `/${this.healthPath}`;
    const baseHref = `${ServiceRunner.buildURL(host, port)}/`;

    return new URL(normalizedPath, baseHref);
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  private async ensureBinaryAccessible(): Promise<void> {
    try {
      await access(this.binaryPath, fsConstants.F_OK);
    } catch {
      throw new Error(
        `Executable not found or not accessible: ${this.binaryPath}`,
      );
    }
  }

  private attachChildProcessListeners(
    child: ChildProcessWithoutNullStreams,
  ): void {
    child.stdout.on("data", (chunk) => {
      this.emit("stdout", chunk);
    });

    child.stderr.on("data", (chunk) => {
      this.emit("stderr", chunk);
    });

    child.once("exit", (code, signal) => {
      this.resetRuntimeState();
      this.emit("exit", code, signal);
    });

    child.once("error", (error) => {
      this.emit("error", error);
    });
  }

  private resetRuntimeState(preserveBoundPort = true): void {
    this.childProcess = null;
    if (!preserveBoundPort) {
      this.currentHost = this.computeHost();
    }
    this.runtimeState.started = false;
    this.runtimeState.pid = undefined;
    this.runtimeState.host = this.currentHost;

    if (!preserveBoundPort) {
      this.runtimeState.port = this.preferredPort ?? 0;
    }

    this.runtimeState.url = ServiceRunner.buildURL(
      this.runtimeState.host,
      this.runtimeState.port,
    );
  }
}
