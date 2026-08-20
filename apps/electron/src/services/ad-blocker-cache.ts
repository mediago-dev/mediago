import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { ElectronBlocker } from "@ghostery/adblocker-electron";

export const AD_BLOCKER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const AD_BLOCKER_LOAD_TIMEOUT_MS = 10 * 1000;
export const EASYLIST_URL = "https://easylist.to/easylist/easylist.txt";

export function getAdBlockerCachePath(userDataPath: string): string {
  return join(userDataPath, "ad-blocker", "easylist-v1.bin");
}

export function createAdBlockerCache(
  cachePath: string,
  onError: () => void,
): AdBlockerCache {
  return new AdBlockerCache(cachePath, {
    clearTimeout: globalThis.clearTimeout,
    deserialize: (serialized) => ElectronBlocker.deserialize(serialized),
    fetch: globalThis.fetch,
    fromLists: (fetcher, urls) => ElectronBlocker.fromLists(fetcher, urls),
    mkdir,
    now: Date.now,
    onError,
    readFile,
    rename,
    setTimeout: globalThis.setTimeout,
    stat,
    unlink,
    writeFile,
  });
}

export interface AdBlockerCacheDependencies {
  clearTimeout: typeof globalThis.clearTimeout;
  deserialize(serialized: Uint8Array): ElectronBlocker;
  fetch: typeof globalThis.fetch;
  fromLists(
    fetch: typeof globalThis.fetch,
    urls: string[],
    config?: unknown,
    caching?: unknown,
  ): Promise<ElectronBlocker>;
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  now(): number;
  onError(): void;
  readFile(path: string): Promise<Uint8Array>;
  rename(oldPath: string, newPath: string): Promise<unknown>;
  setTimeout: typeof globalThis.setTimeout;
  stat(path: string): Promise<{ mtimeMs: number }>;
  unlink(path: string): Promise<unknown>;
  writeFile(path: string, data: Uint8Array): Promise<unknown>;
}

export interface AdBlockerCacheValue {
  blocker: ElectronBlocker;
  expiresAt: number;
}

export interface AdBlockerCacheResult {
  blocker?: ElectronBlocker;
  expiresAt: number;
  refresh?: Promise<AdBlockerCacheValue | undefined>;
}

export class AdBlockerCache {
  private refreshPromise: Promise<AdBlockerCacheValue | undefined> | null =
    null;

  constructor(
    private readonly cachePath: string,
    private readonly dependencies: AdBlockerCacheDependencies,
  ) {}

  async load(): Promise<AdBlockerCacheResult> {
    try {
      const [serialized, stats] = await Promise.all([
        this.dependencies.readFile(this.cachePath),
        this.dependencies.stat(this.cachePath),
      ]);
      const blocker = this.dependencies.deserialize(serialized);
      const expiresAt = stats.mtimeMs + AD_BLOCKER_CACHE_MAX_AGE_MS;
      if (this.dependencies.now() < expiresAt) {
        return { blocker, expiresAt };
      }

      return {
        blocker,
        expiresAt,
        refresh: this.startRefresh(),
      };
    } catch {
      // A missing or invalid cache is handled by the fresh-load path.
    }

    return (
      (await this.startRefresh()) ?? { expiresAt: this.dependencies.now() }
    );
  }

  private startRefresh(): Promise<AdBlockerCacheValue | undefined> {
    if (!this.refreshPromise) {
      const refreshPromise = this.refresh()
        .then((blocker) => ({
          blocker,
          expiresAt: this.dependencies.now() + AD_BLOCKER_CACHE_MAX_AGE_MS,
        }))
        .catch(() => {
          this.reportFailure();
          return undefined;
        })
        .finally(() => {
          if (this.refreshPromise === refreshPromise) {
            this.refreshPromise = null;
          }
        });
      this.refreshPromise = refreshPromise;
    }

    return this.refreshPromise;
  }

  private async refresh(): Promise<ElectronBlocker> {
    const blocker = await this.loadFreshBlocker();
    const tempPath = `${this.cachePath}.tmp`;
    try {
      await this.dependencies.mkdir(dirname(this.cachePath), {
        recursive: true,
      });
      await this.dependencies.writeFile(tempPath, blocker.serialize());
      await this.dependencies.rename(tempPath, this.cachePath);
    } catch {
      this.reportFailure();
      try {
        await this.dependencies.unlink(tempPath);
      } catch {
        // Temporary cache cleanup is best-effort.
      }
    }
    return blocker;
  }

  private async loadFreshBlocker(): Promise<ElectronBlocker> {
    const operationController = new AbortController();
    const timeoutError = new Error("Ad blocker load timed out");
    let operationTimeout: ReturnType<typeof globalThis.setTimeout> | undefined;
    const deadline = new Promise<never>((_resolve, reject) => {
      operationTimeout = this.dependencies.setTimeout(() => {
        operationController.abort(timeoutError);
        reject(timeoutError);
      }, AD_BLOCKER_LOAD_TIMEOUT_MS);
    });
    const operationFetch = this.createOperationFetch(
      operationController.signal,
    );

    try {
      return await Promise.race([
        this.dependencies.fromLists(operationFetch.fetch, [EASYLIST_URL]),
        deadline,
      ]);
    } finally {
      if (operationTimeout !== undefined) {
        this.dependencies.clearTimeout(operationTimeout);
      }
      if (!operationController.signal.aborted) {
        operationController.abort(new Error("Ad blocker load finished"));
      }
      operationFetch.cleanup();
    }
  }

  private createOperationFetch(operationSignal: AbortSignal): {
    cleanup(): void;
    fetch: typeof globalThis.fetch;
  } {
    const requestCleanups = new Set<() => void>();
    const fetch: typeof globalThis.fetch = async (input, init) => {
      if (operationSignal.aborted) {
        throw operationSignal.reason;
      }

      const requestController = new AbortController();
      const callerSignal = init?.signal;
      const abortFromOperation = () =>
        requestController.abort(operationSignal.reason);
      const abortFromCaller = () =>
        requestController.abort(callerSignal?.reason);
      const cleanup = () => {
        operationSignal.removeEventListener("abort", abortFromOperation);
        callerSignal?.removeEventListener("abort", abortFromCaller);
        requestCleanups.delete(cleanup);
      };
      requestCleanups.add(cleanup);
      operationSignal.addEventListener("abort", abortFromOperation, {
        once: true,
      });
      if (callerSignal?.aborted) {
        abortFromCaller();
      } else {
        callerSignal?.addEventListener("abort", abortFromCaller, {
          once: true,
        });
      }

      try {
        if (requestController.signal.aborted) {
          throw requestController.signal.reason;
        }
        const response = await this.dependencies.fetch(input, {
          ...init,
          signal: requestController.signal,
        });
        if (!response.ok) {
          throw new Error("Ad blocker list request failed");
        }
        return response;
      } catch (error) {
        cleanup();
        throw error;
      }
    };

    return {
      cleanup: () => {
        for (const cleanup of requestCleanups) cleanup();
      },
      fetch,
    };
  }

  private reportFailure(): void {
    try {
      this.dependencies.onError();
    } catch {
      // Error reporting must not escape the cache loader.
    }
  }
}
