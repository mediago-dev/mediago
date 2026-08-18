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

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "server detail",
        errorCode: "dependency_missing",
        dependency: "BBDown",
      }),
      { translate, notify, revalidate },
    );

    expect(translate).toHaveBeenCalledOnce();
    expect(translate).toHaveBeenCalledWith("dependencyMissing", {
      dependency: "BBDown",
    });
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("Missing BBDown");
    expect(revalidate).toHaveBeenCalledOnce();
  });

  test("reports the server message for a generic failure and revalidates once", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "Download process exited unexpectedly",
        errorCode: "download_failed",
      }),
      { translate, notify, revalidate },
    );

    expect(translate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith(
      "Download process exited unexpectedly",
    );
    expect(revalidate).toHaveBeenCalledOnce();
  });

  test("uses the localized fallback when no safe server message exists", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();

    handleDownloadFailure(failureEvent({ id: 42, error: "" }), {
      translate,
      notify,
      revalidate,
    });

    expect(translate).toHaveBeenCalledExactlyOnceWith("unknownError");
    expect(notify).toHaveBeenCalledExactlyOnceWith("Unknown error");
    expect(revalidate).toHaveBeenCalledOnce();
  });

  test("does not use the dependency template without a string dependency", () => {
    const translate = vi.fn(() => "Unknown error");
    const notify = vi.fn();
    const revalidate = vi.fn();

    handleDownloadFailure(
      failureEvent({
        id: 42,
        error: "Dependency unavailable",
        errorCode: "dependency_missing",
      }),
      { translate, notify, revalidate },
    );

    expect(translate).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledExactlyOnceWith("Dependency unavailable");
    expect(revalidate).toHaveBeenCalledOnce();
  });
});
