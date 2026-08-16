import { expect, test } from "vitest";
import {
  createConfigWriteCoordinator,
  shouldApplyPersistedValue,
} from "./config-write-coordinator";

type TestConfig = {
  proxy: string;
  enabled: boolean;
};

const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

test("coalesces same-tick values into one latest-only batch", async () => {
  const writes: Array<Partial<TestConfig>> = [];
  const writer = createConfigWriteCoordinator<TestConfig>(async (values) => {
    writes.push(values);
  }, 0);

  const persistedValues = await Promise.all([
    writer.enqueue("proxy", "a"),
    writer.enqueue("proxy", "abc"),
    writer.enqueue("enabled", true),
  ]);

  expect(writes).toStrictEqual([{ proxy: "abc", enabled: true }]);
  expect(persistedValues).toStrictEqual(["abc", "abc", true]);
});

test("serializes batches and recognizes every local pending echo", async () => {
  const writes: Array<Partial<TestConfig>> = [];
  const releases: Array<() => void> = [];
  const writer = createConfigWriteCoordinator<TestConfig>(
    (values) =>
      new Promise<void>((resolve) => {
        writes.push(values);
        releases.push(resolve);
      }),
    0,
  );

  const first = writer.enqueue("enabled", true);
  await nextTask();
  expect(writes).toStrictEqual([{ enabled: true }]);

  const second = writer.enqueue("enabled", false);
  expect(writer.matchesPendingValue("enabled", true)).toBe(true);
  expect(writer.acknowledgeInFlightValue("enabled", false)).toBe(false);
  expect(writer.acknowledgeInFlightValue("enabled", true)).toBe(true);
  expect(writer.matchesPendingValue("enabled", false)).toBe(true);
  expect(writer.matchesPendingValue("proxy", "remote")).toBe(false);
  expect(writes.length).toBe(1);

  const flushing = writer.flush();
  releases[0]();
  const firstPersistedValue = await first;
  expect(firstPersistedValue).toBe(true);
  await nextTask();
  expect(writes).toStrictEqual([{ enabled: true }, { enabled: false }]);

  releases[1]();
  const [secondPersistedValue] = await Promise.all([second, flushing]);
  expect(secondPersistedValue).toBe(false);
  expect(writer.getPending("enabled")).toStrictEqual({ pending: false });
});

test("continues with a newer batch after a failed write", async () => {
  let attempt = 0;
  const writes: Array<Partial<TestConfig>> = [];
  let rejectFirst: ((error: Error) => void) | undefined;
  const writer = createConfigWriteCoordinator<TestConfig>((values) => {
    writes.push(values);
    attempt += 1;
    if (attempt === 1) {
      return new Promise<void>((_resolve, reject) => {
        rejectFirst = reject;
      });
    }
    return Promise.resolve();
  }, 0);

  const first = expect(writer.enqueue("proxy", "old")).rejects.toThrow(
    /disk full/,
  );
  await nextTask();
  const second = writer.enqueue("proxy", "latest");
  rejectFirst?.(new Error("disk full"));

  await first;
  const persistedValue = await second;
  expect(persistedValue).toBe("latest");
  expect(writes).toStrictEqual([{ proxy: "old" }, { proxy: "latest" }]);
});

test("clears pending before resolving a successful enqueue", async () => {
  let release: (() => void) | undefined;
  const writer = createConfigWriteCoordinator<TestConfig>(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    0,
  );

  const pendingWhenSettled = writer
    .enqueue("enabled", true)
    .then(() => writer.getPending("enabled"));
  await nextTask();
  expect(writer.getPending("enabled")).toStrictEqual({
    pending: true,
    value: true,
  });

  release?.();
  expect(await pendingWhenSettled).toStrictEqual({ pending: false });
});

test("clears pending before rejecting a failed enqueue", async () => {
  let fail: ((error: Error) => void) | undefined;
  const writer = createConfigWriteCoordinator<TestConfig>(
    () =>
      new Promise<void>((_resolve, reject) => {
        fail = reject;
      }),
    0,
  );

  const pendingWhenSettled = writer.enqueue("enabled", true).then(
    () => {
      throw new Error("write unexpectedly succeeded");
    },
    () => writer.getPending("enabled"),
  );
  await nextTask();
  expect(writer.getPending("enabled")).toStrictEqual({
    pending: true,
    value: true,
  });

  fail?.(new Error("disk full"));
  expect(await pendingWhenSettled).toStrictEqual({ pending: false });
});

test("keeps a newer pending batch when its value matches the failed batch", async () => {
  let attempt = 0;
  let failFirst: ((error: Error) => void) | undefined;
  const writes: Array<Partial<TestConfig>> = [];
  const writer = createConfigWriteCoordinator<TestConfig>((values) => {
    writes.push(values);
    attempt += 1;
    if (attempt === 1) {
      return new Promise<void>((_resolve, reject) => {
        failFirst = reject;
      });
    }
    return Promise.resolve();
  }, 0);

  const pendingAfterFailure = writer.enqueue("enabled", true).then(
    () => {
      throw new Error("write unexpectedly succeeded");
    },
    () => writer.getPending("enabled"),
  );
  await nextTask();

  const intermediate = writer.enqueue("enabled", false);
  const latest = writer.enqueue("enabled", true);
  failFirst?.(new Error("disk full"));

  expect(await pendingAfterFailure).toStrictEqual({
    pending: true,
    value: true,
  });
  const persisted = await Promise.all([intermediate, latest]);
  expect(persisted).toStrictEqual([true, true]);
  expect(writes).toStrictEqual([{ enabled: true }, { enabled: true }]);
});

test("treats an in-flight SSE acknowledgement as a committed write", async () => {
  let loseResponse: ((error: Error) => void) | undefined;
  const writer = createConfigWriteCoordinator<TestConfig>(
    () =>
      new Promise<void>((_resolve, reject) => {
        loseResponse = reject;
      }),
    0,
  );

  const persisted = writer.enqueue("enabled", true);
  await nextTask();
  writer.recordRemoteValue("enabled", true);
  loseResponse?.(new Error("response interrupted"));

  expect(await persisted).toBe(true);
  expect(writer.getPending("enabled")).toStrictEqual({ pending: false });
});

test("a newer conflicting remote value wins over a delayed local response", () => {
  const writer = createConfigWriteCoordinator<TestConfig>(async () => {}, 0);
  const versionAtWrite = writer.getRemoteValue("proxy").version;

  writer.recordRemoteValue("proxy", "local");
  expect(
    shouldApplyPersistedValue(
      versionAtWrite,
      writer.getRemoteValue("proxy"),
      "local",
    ),
  ).toBe(true);

  writer.recordRemoteValue("proxy", "newer-remote");
  expect(
    shouldApplyPersistedValue(
      versionAtWrite,
      writer.getRemoteValue("proxy"),
      "local",
    ),
  ).toBe(false);
});
