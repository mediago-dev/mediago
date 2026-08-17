import { describe, expect, it, vi } from "vitest";
import { registerGracefulQuit } from "./lifecycle";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createApp() {
  let beforeQuit:
    | ((event: { preventDefault: ReturnType<typeof vi.fn> }) => void)
    | undefined;
  return {
    app: {
      on: vi.fn((event, listener) => {
        if (event === "before-quit") beforeQuit = listener;
      }),
      quit: vi.fn(),
    },
    beforeQuit: (event: { preventDefault: ReturnType<typeof vi.fn> }) => {
      beforeQuit?.(event);
    },
  };
}

describe("registerGracefulQuit", () => {
  it("waits for one shutdown before quitting and allows the resumed quit", async () => {
    const shutdown = deferred();
    const runShutdown = vi.fn(() => shutdown.promise);
    const { app, beforeQuit } = createApp();

    registerGracefulQuit(app, runShutdown, vi.fn());

    const firstEvent = { preventDefault: vi.fn() };
    const repeatedEvent = { preventDefault: vi.fn() };
    beforeQuit(firstEvent);
    beforeQuit(repeatedEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(repeatedEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(runShutdown).toHaveBeenCalledOnce());
    expect(app.quit).not.toHaveBeenCalled();

    shutdown.resolve();
    await shutdown.promise;
    await vi.waitFor(() => expect(app.quit).toHaveBeenCalledOnce());

    const resumedEvent = { preventDefault: vi.fn() };
    beforeQuit(resumedEvent);

    expect(resumedEvent.preventDefault).not.toHaveBeenCalled();
  });

  it("reports a failed shutdown and resumes quitting", async () => {
    const shutdown = deferred();
    const onError = vi.fn();
    const { app, beforeQuit } = createApp();

    registerGracefulQuit(app, () => shutdown.promise, onError);

    beforeQuit({ preventDefault: vi.fn() });
    const error = new Error("stop failed");
    shutdown.reject(error);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("reports a synchronous shutdown failure and resumes quitting", async () => {
    const error = new Error("stop failed synchronously");
    const onError = vi.fn();
    const { app, beforeQuit } = createApp();

    registerGracefulQuit(
      app,
      () => {
        throw error;
      },
      onError,
    );

    expect(() => beforeQuit({ preventDefault: vi.fn() })).not.toThrow();
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));

    expect(onError).toHaveBeenCalledOnce();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
