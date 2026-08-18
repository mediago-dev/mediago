import type { DownloadFailedEvent } from "@mediago/shared-common";

export interface DownloadFailureCollaborators {
  translate: (
    key: "dependencyMissing" | "unknownError",
    options?: { dependency: string },
  ) => string;
  notify: (message: string) => void;
  revalidate: () => unknown;
}

export function handleDownloadFailure(
  event: DownloadFailedEvent,
  collaborators: DownloadFailureCollaborators,
): unknown {
  const { translate, notify, revalidate } = collaborators;
  const { dependency, error, errorCode } = event.data;
  const message =
    errorCode === "dependency_missing" && dependency
      ? translate("dependencyMissing", { dependency })
      : error.trim().length > 0
        ? error
        : translate("unknownError");

  notify(message);
  return revalidate();
}
