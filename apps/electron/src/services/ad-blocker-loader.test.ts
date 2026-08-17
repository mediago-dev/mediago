import { expect, test, vi } from "vitest";
import { AdBlockerLoader } from "./ad-blocker-loader";

test("does not call the factory during construction", () => {
  const factory = vi.fn<() => Promise<string>>();

  new AdBlockerLoader(factory, vi.fn());

  expect(factory).not.toHaveBeenCalled();
});

test("memoizes one promise and value across concurrent and repeated loads", async () => {
  let resolveFactory: (value: string) => void = () => undefined;
  const factoryResult = new Promise<string>((resolve) => {
    resolveFactory = resolve;
  });
  const factory = vi.fn(() => factoryResult);
  const loader = new AdBlockerLoader(factory, vi.fn());

  const firstLoad = loader.load();
  const concurrentLoad = loader.load();

  expect(firstLoad).toBe(concurrentLoad);
  await Promise.resolve();
  expect(factory).toHaveBeenCalledTimes(1);

  resolveFactory("blocker");

  await expect(firstLoad).resolves.toBe("blocker");
  await expect(loader.load()).resolves.toBe("blocker");
  expect(factory).toHaveBeenCalledTimes(1);
});

test("contains a factory rejection and reports it only once", async () => {
  const rejection = new Error("list unavailable");
  const factory = vi.fn(() => Promise.reject(rejection));
  const onError = vi.fn();
  const loader = new AdBlockerLoader(factory, onError);

  const firstLoad = loader.load();
  const repeatedLoad = loader.load();

  await expect(firstLoad).resolves.toBeUndefined();
  await expect(repeatedLoad).resolves.toBeUndefined();
  await expect(loader.load()).resolves.toBeUndefined();
  expect(factory).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(rejection);
});

test("contains a synchronous factory error and memoizes undefined", async () => {
  const failure = new Error("factory failed synchronously");
  const factory = vi.fn(() => {
    throw failure;
  });
  const onError = vi.fn();
  const loader = new AdBlockerLoader<string>(factory, onError);
  let firstLoad: Promise<string | undefined> | undefined;

  expect(() => {
    firstLoad = loader.load();
  }).not.toThrow();

  const repeatedLoad = loader.load();

  expect(firstLoad).toBe(repeatedLoad);
  await expect(firstLoad).resolves.toBeUndefined();
  await expect(repeatedLoad).resolves.toBeUndefined();
  expect(factory).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(failure);
});

test("contains a throwing error reporter and memoizes undefined", async () => {
  const failure = new Error("list unavailable");
  const factory = vi.fn(() => Promise.reject(failure));
  const onError = vi.fn(() => {
    throw new Error("reporter failed");
  });
  const loader = new AdBlockerLoader(factory, onError);

  const firstLoad = loader.load();
  const repeatedLoad = loader.load();

  expect(firstLoad).toBe(repeatedLoad);
  await expect(firstLoad).resolves.toBeUndefined();
  await expect(repeatedLoad).resolves.toBeUndefined();
  expect(factory).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledOnce();
  expect(onError).toHaveBeenCalledWith(failure);
});
