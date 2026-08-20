import { expect, test, vi } from "vitest";
import {
  AdBlockerCache,
  AD_BLOCKER_CACHE_MAX_AGE_MS,
  AD_BLOCKER_LOAD_TIMEOUT_MS,
  EASYLIST_URL,
  getAdBlockerCachePath,
  type AdBlockerCacheDependencies,
} from "./ad-blocker-cache";
import { AdBlockerLoader } from "./ad-blocker-loader";

const CACHE_PATH = "/user-data/ad-blocker/easylist-v1.bin";
const NOW = Date.UTC(2026, 7, 20);

test("uses a versioned cache path beneath Electron userData", () => {
  expect(getAdBlockerCachePath("/electron-user-data")).toBe(
    "/electron-user-data/ad-blocker/easylist-v1.bin",
  );
});

test("returns a fresh valid serialized cache without loading EasyList", async () => {
  const cachedBlocker = createBlocker("cached");
  const { cache, dependencies } = createCache({
    deserialize: vi.fn(() => cachedBlocker),
    mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS + 1,
  });

  await expect(cache.load()).resolves.toEqual({
    blocker: cachedBlocker,
    expiresAt: NOW + 1,
  });

  expect(dependencies.readFile).toHaveBeenCalledWith(CACHE_PATH);
  expect(dependencies.deserialize).toHaveBeenCalledWith(
    new Uint8Array([1, 2, 3]),
  );
  expect(dependencies.fromLists).not.toHaveBeenCalled();
});

test("returns a stale valid cache immediately and atomically refreshes it", async () => {
  const staleBlocker = createBlocker("stale");
  const refreshedBlocker = createBlocker("refreshed");
  let resolveRefresh: (blocker: typeof refreshedBlocker) => void = () =>
    undefined;
  const pendingRefresh = new Promise<typeof refreshedBlocker>((resolve) => {
    resolveRefresh = resolve;
  });
  const { cache, dependencies } = createCache({
    deserialize: vi.fn(() => staleBlocker),
    fromLists: vi.fn(() => pendingRefresh),
    mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS,
  });

  const result = await cache.load();
  expect(result.blocker).toBe(staleBlocker);
  expect(dependencies.fromLists).toHaveBeenCalledWith(expect.any(Function), [
    EASYLIST_URL,
  ]);
  expect(dependencies.writeFile).not.toHaveBeenCalled();

  resolveRefresh(refreshedBlocker);
  await pendingRefresh;
  await result.refresh;
  await vi.waitFor(() => {
    expect(dependencies.rename).toHaveBeenCalled();
  });

  expect(refreshedBlocker.serialize).toHaveBeenCalledOnce();
  expect(dependencies.mkdir).toHaveBeenCalledWith("/user-data/ad-blocker", {
    recursive: true,
  });
  expect(dependencies.writeFile).toHaveBeenCalledWith(
    `${CACHE_PATH}.tmp`,
    new Uint8Array([4, 5, 6]),
  );
  expect(dependencies.rename).toHaveBeenCalledWith(
    `${CACHE_PATH}.tmp`,
    CACHE_PATH,
  );
});

test.each(["missing", "corrupt"] as const)(
  "%s cache triggers a fresh EasyList load and caches the result",
  async (cacheState) => {
    const networkBlocker = createBlocker("network");
    const { cache, dependencies } = createCache({
      deserialize:
        cacheState === "corrupt"
          ? vi.fn(() => {
              throw new Error("private corrupt-cache details");
            })
          : vi.fn(() => createBlocker("cached")),
      fromLists: vi.fn(async () => networkBlocker),
      readFile:
        cacheState === "missing"
          ? vi.fn(async () => {
              throw new Error("private filesystem details");
            })
          : vi.fn(async () => new Uint8Array([1, 2, 3])),
    });

    await expect(cache.load()).resolves.toEqual({
      blocker: networkBlocker,
      expiresAt: NOW + AD_BLOCKER_CACHE_MAX_AGE_MS,
    });

    expect(dependencies.fromLists).toHaveBeenCalledWith(expect.any(Function), [
      EASYLIST_URL,
    ]);
    expect(dependencies.rename).toHaveBeenCalledWith(
      `${CACHE_PATH}.tmp`,
      CACHE_PATH,
    );
  },
);

test("bounds a fresh load to ten seconds and reports failure without details", async () => {
  vi.useFakeTimers();
  try {
    const { cache, dependencies } = createCache({
      fromLists: vi.fn(() => new Promise(() => undefined)),
      readFile: vi.fn(async () => {
        throw new Error("private filesystem details");
      }),
    });

    const load = cache.load();
    await vi.advanceTimersByTimeAsync(AD_BLOCKER_LOAD_TIMEOUT_MS - 1);
    expect(dependencies.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(load).resolves.toEqual({ expiresAt: NOW });
    expect(dependencies.onError).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledWith();
  } finally {
    vi.useRealTimers();
  }
});

test("aborts an EasyList fetch at the application timeout", async () => {
  vi.useFakeTimers();
  try {
    let fetchSignal: AbortSignal | null = null;
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          fetchSignal = init?.signal ?? null;
          fetchSignal?.addEventListener(
            "abort",
            () => reject(fetchSignal?.reason),
            { once: true },
          );
        }),
    );
    const { cache, dependencies } = createCache({
      fetch: fetchMock as typeof fetch,
      fromLists: vi.fn(async (fetcher, urls) => {
        await fetcher(urls[0]);
        return createBlocker("network") as never;
      }),
      readFile: vi.fn(async () => {
        throw new Error("cache missing");
      }),
    });

    const load = cache.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSignal).not.toBeNull();
    expect(fetchSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(AD_BLOCKER_LOAD_TIMEOUT_MS);
    await expect(load).resolves.toEqual({ expiresAt: NOW });
    expect(fetchSignal?.aborted).toBe(true);
    expect(dependencies.onError).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test("aborts EasyList body consumption when the application timeout expires", async () => {
  vi.useFakeTimers();
  try {
    let fetchSignal: AbortSignal | null = null;
    const bodyAborted = vi.fn();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        fetchSignal = init?.signal ?? null;
        return {
          ok: true,
          text: () =>
            new Promise<string>((_resolve, reject) => {
              const signal = fetchSignal;
              if (!signal) {
                reject(new Error("missing abort signal"));
                return;
              }
              if (signal.aborted) {
                reject(signal.reason);
                return;
              }
              signal.addEventListener(
                "abort",
                () => {
                  bodyAborted();
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
        } as Response;
      },
    );
    const { cache, dependencies } = createCache({
      fetch: fetchMock as typeof fetch,
      fromLists: vi.fn(async (fetcher, urls) => {
        const response = await fetcher(urls[0]);
        await response.text();
        return createBlocker("network") as never;
      }),
      readFile: vi.fn(async () => {
        throw new Error("cache missing");
      }),
    });

    const load = cache.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchSignal).not.toBeNull();
    expect(fetchSignal?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(AD_BLOCKER_LOAD_TIMEOUT_MS);
    await expect(load).resolves.toEqual({ expiresAt: NOW });
    expect(fetchSignal?.aborted).toBe(true);
    expect(bodyAborted).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});

test.each([500, 404])(
  "keeps a stale blocker and does not persist an HTTP %s refresh",
  async (status) => {
    const staleBlocker = createBlocker("stale");
    const networkBlocker = createBlocker("network");
    const { cache, dependencies } = createCache({
      deserialize: vi.fn(() => staleBlocker),
      fetch: vi.fn(async () => ({ ok: false, status }) as Response),
      fromLists: vi.fn(async (fetcher, urls) => {
        await fetcher(urls[0]);
        return networkBlocker as never;
      }),
      mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS,
    });

    const result = await cache.load();
    expect(result.blocker).toBe(staleBlocker);
    await expect(result.refresh).resolves.toBeUndefined();

    expect(dependencies.onError).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledWith();
    expect(dependencies.writeFile).not.toHaveBeenCalled();
    expect(dependencies.rename).not.toHaveBeenCalled();
  },
);

test("does not create a blocker from a non-successful HTTP response", async () => {
  const { cache, dependencies } = createCache({
    fetch: vi.fn(async () => ({ ok: false, status: 503 }) as Response),
    fromLists: vi.fn(async (fetcher, urls) => {
      await fetcher(urls[0]);
      return createBlocker("network") as never;
    }),
    readFile: vi.fn(async () => {
      throw new Error("cache missing");
    }),
  });

  await expect(cache.load()).resolves.toEqual({ expiresAt: NOW });
  expect(dependencies.onError).toHaveBeenCalledOnce();
  expect(dependencies.writeFile).not.toHaveBeenCalled();
  expect(dependencies.rename).not.toHaveBeenCalled();
});

test.each(["writeFile", "rename"] as const)(
  "uses the fresh in-memory blocker when cache %s fails",
  async (failedOperation) => {
    const networkBlocker = createBlocker("network");
    const { cache, dependencies } = createCache({
      fromLists: vi.fn(async () => networkBlocker),
      [failedOperation]: vi.fn(async () => {
        throw new Error("private filesystem details");
      }),
      readFile: vi.fn(async () => {
        throw new Error("cache missing");
      }),
    });

    await expect(cache.load()).resolves.toEqual({
      blocker: networkBlocker,
      expiresAt: NOW + AD_BLOCKER_CACHE_MAX_AGE_MS,
    });

    expect(dependencies.onError).toHaveBeenCalledOnce();
    expect(dependencies.onError).toHaveBeenCalledWith();
    expect(dependencies.unlink).toHaveBeenCalledWith(`${CACHE_PATH}.tmp`);
  },
);

test("shares one deadline across Ghostery fetch retries and later loader attempts", async () => {
  vi.useFakeTimers();
  try {
    const activeSignals = new Set<AbortSignal>();
    const baseFetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) {
            reject(new Error("missing abort signal"));
            return;
          }
          activeSignals.add(signal);
          signal.addEventListener(
            "abort",
            () => {
              activeSignals.delete(signal);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    );
    const internalRetryRejected = vi.fn();
    const { cache } = createCache({
      fetch: baseFetch as typeof fetch,
      fromLists: vi.fn(async (fetcher, urls) => {
        try {
          await fetcher(urls[0]);
        } catch {
          try {
            await fetcher(urls[0]);
          } catch {
            internalRetryRejected();
          }
          throw new Error("list load failed");
        }
        return createBlocker("network") as never;
      }),
      readFile: vi.fn(async () => {
        throw new Error("cache missing");
      }),
    });
    const loader = new AdBlockerLoader(
      async () => (await cache.load()).blocker,
      vi.fn(),
    );

    const firstLoad = loader.load();
    await vi.advanceTimersByTimeAsync(AD_BLOCKER_LOAD_TIMEOUT_MS);
    await expect(firstLoad).resolves.toBeUndefined();

    expect(internalRetryRejected).toHaveBeenCalledTimes(1);
    expect(baseFetch).toHaveBeenCalledTimes(1);
    expect(activeSignals.size).toBe(0);

    const laterLoad = loader.load();
    await vi.advanceTimersByTimeAsync(0);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(activeSignals.size).toBe(1);

    await vi.advanceTimersByTimeAsync(AD_BLOCKER_LOAD_TIMEOUT_MS);
    await expect(laterLoad).resolves.toBeUndefined();
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(activeSignals.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("retains a stale cache and reports no details when refresh fails", async () => {
  const staleBlocker = createBlocker("stale");
  const { cache, dependencies } = createCache({
    deserialize: vi.fn(() => staleBlocker),
    fromLists: vi.fn(async () => {
      throw new Error("private URL and request details");
    }),
    mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS,
  });

  const result = await cache.load();
  expect(result.blocker).toBe(staleBlocker);
  await expect(result.refresh).resolves.toBeUndefined();

  expect(dependencies.onError).toHaveBeenCalledOnce();
  expect(dependencies.onError).toHaveBeenCalledWith();
  expect(dependencies.writeFile).not.toHaveBeenCalled();
  expect(dependencies.rename).not.toHaveBeenCalled();
});

test("publishes a refreshed blocker from a stale cache load", async () => {
  const staleBlocker = createBlocker("stale");
  const refreshedBlocker = createBlocker("refreshed");
  const { cache } = createCache({
    deserialize: vi.fn(() => staleBlocker),
    fromLists: vi.fn(async () => refreshedBlocker),
    mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS,
  });

  const result = (await cache.load()) as unknown as ExpectedCacheResult;

  expect(result.blocker).toBe(staleBlocker);
  await expect(result.refresh).resolves.toEqual({
    blocker: refreshedBlocker,
    expiresAt: NOW + AD_BLOCKER_CACHE_MAX_AGE_MS,
  });
});

test("allows a later stale refresh attempt after one fails", async () => {
  const staleBlocker = createBlocker("stale");
  const refreshedBlocker = createBlocker("refreshed");
  const fromLists = vi
    .fn()
    .mockRejectedValueOnce(new Error("list unavailable"))
    .mockResolvedValueOnce(refreshedBlocker);
  const { cache } = createCache({
    deserialize: vi.fn(() => staleBlocker),
    fromLists,
    mtimeMs: NOW - AD_BLOCKER_CACHE_MAX_AGE_MS,
  });

  const firstResult = (await cache.load()) as unknown as ExpectedCacheResult;
  expect(firstResult.blocker).toBe(staleBlocker);
  await expect(firstResult.refresh).resolves.toBeUndefined();

  const laterResult = (await cache.load()) as unknown as ExpectedCacheResult;
  expect(laterResult.blocker).toBe(staleBlocker);
  await expect(laterResult.refresh).resolves.toEqual({
    blocker: refreshedBlocker,
    expiresAt: NOW + AD_BLOCKER_CACHE_MAX_AGE_MS,
  });
  expect(fromLists).toHaveBeenCalledTimes(2);
});

interface ExpectedCacheResult {
  blocker?: ReturnType<typeof createBlocker>;
  expiresAt: number;
  refresh?: Promise<
    | {
        blocker: ReturnType<typeof createBlocker>;
        expiresAt: number;
      }
    | undefined
  >;
}

function createBlocker(id: string) {
  return {
    id,
    serialize: vi.fn(() => new Uint8Array([4, 5, 6])),
  };
}

function createCache(
  overrides: Partial<AdBlockerCacheDependencies> & { mtimeMs?: number } = {},
) {
  const { mtimeMs = NOW, ...dependencyOverrides } = overrides;
  const dependencies = {
    clearTimeout,
    deserialize: vi.fn(() => createBlocker("deserialized")),
    fetch: vi.fn(),
    fromLists: vi.fn(async () => createBlocker("network")),
    mkdir: vi.fn(async () => undefined),
    now: vi.fn(() => NOW),
    onError: vi.fn(),
    readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
    rename: vi.fn(async () => undefined),
    setTimeout,
    stat: vi.fn(async () => ({ mtimeMs })),
    unlink: vi.fn(async () => undefined),
    writeFile: vi.fn(async () => undefined),
    ...dependencyOverrides,
  } as unknown as AdBlockerCacheDependencies & {
    unlink: ReturnType<typeof vi.fn>;
  };

  return {
    cache: new AdBlockerCache(CACHE_PATH, dependencies),
    dependencies,
  };
}
