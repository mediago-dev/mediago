import type { DownloadFailedEvent } from "@mediago/shared-common";
import { describe, expect, test, vi } from "vitest";
import { handleDownloadFailure } from "./download-failure-handler";

function failureEvent(data: DownloadFailedEvent["data"]): DownloadFailedEvent {
  return { type: "failed", data };
}

describe("handleDownloadFailure", () => {
  test("reports a named missing dependency and revalidates once", () => {
    const translate = vi.fn(
      (_key: string, options?: { dependency?: string }) =>
        `Missing ${options?.dependency}`,
    );
    const notify = vi.fn();
    const revalidate = vi.fn();
    const protocolWarning = vi.fn();

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "server detail",
        errorCode: "dependency_missing",
        dependency: "BBDown",
      }),
      { translate, notify, revalidate, protocolWarning },
    );

    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("dependencyMissing", {
      dependency: "BBDown",
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Missing BBDown");
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).not.toHaveBeenCalled();
  });

  test("reports the server message for a generic failure and revalidates once", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();
    const protocolWarning = vi.fn();

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "Download process exited unexpectedly",
        errorCode: "download_failed",
      }),
      { translate, notify, revalidate, protocolWarning },
    );

    expect(translate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Download process exited unexpectedly",
    );
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).not.toHaveBeenCalled();
  });

  test("uses the localized fallback when no safe server message exists", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();
    const protocolWarning = vi.fn();

    handleDownloadFailure(failureEvent({ id: 42, error: "" }), {
      translate,
      notify,
      revalidate,
      protocolWarning,
    });

    expect(translate).toHaveBeenCalledExactlyOnceWith("unknownError");
    expect(notify).toHaveBeenCalledExactlyOnceWith("Unknown error");
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).not.toHaveBeenCalled();
  });

  test("does not use the dependency template without a string dependency", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();
    const protocolWarning = vi.fn();

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "Dependency unavailable",
        errorCode: "dependency_missing",
      }),
      { translate, notify, revalidate, protocolWarning },
    );

    expect(translate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith("Dependency unavailable");
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).not.toHaveBeenCalled();
  });

  test("revalidates when notification throws and contains the failure", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn(() => {
      throw new Error("private notification detail");
    });
    const revalidate = vi.fn();
    const protocolWarning = vi.fn();

    expect(() =>
      handleDownloadFailure(
        failureEvent({ id: 42, error: "private server detail" }),
        { translate, notify, revalidate, protocolWarning },
      ),
    ).not.toThrow();

    expect(notify).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).toHaveBeenCalledExactlyOnceWith(
      "Download failure notification failed",
    );
    expect(JSON.stringify(protocolWarning.mock.calls)).not.toContain("private");
  });

  test("contains a synchronous revalidation failure", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn(() => {
      throw new Error("private revalidation detail");
    });
    const protocolWarning = vi.fn();

    expect(() =>
      handleDownloadFailure(
        failureEvent({ id: 42, error: "Download failed" }),
        { translate, notify, revalidate, protocolWarning },
      ),
    ).not.toThrow();

    expect(notify).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).toHaveBeenCalledExactlyOnceWith(
      "Download task revalidation failed",
    );
  });

  test("consumes an asynchronous revalidation rejection", async () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn(() =>
      Promise.reject(new Error("private async detail")),
    );
    const protocolWarning = vi.fn();

    const result = handleDownloadFailure(
      failureEvent({ id: 42, error: "Download failed" }),
      { translate, notify, revalidate, protocolWarning },
    );
    if (result instanceof Promise) await result.catch(() => undefined);
    await Promise.resolve();

    expect(result).toBeUndefined();
    expect(notify).toHaveBeenCalledOnce();
    expect(revalidate).toHaveBeenCalledOnce();
    expect(protocolWarning).toHaveBeenCalledExactlyOnceWith(
      "Download task revalidation failed",
    );
  });
});
