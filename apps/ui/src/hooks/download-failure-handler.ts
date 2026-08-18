import type { DownloadFailedEvent } from "@mediago/shared-common";

const NOTIFICATION_FAILURE_WARNING = "Download failure notification failed";
const REVALIDATION_FAILURE_WARNING = "Download task revalidation failed";

export interface DownloadFailureCollaborators {
  translate: (
    key: "dependencyMissing" | "unknownError",
    options?: { dependency: string },
  ) => string;
  notify: (message: string) => void;
  revalidate: () => unknown;
  protocolWarning: (message: string) => void;
}

export function handleDownloadFailure(
  event: DownloadFailedEvent,
  collaborators: DownloadFailureCollaborators,
): void {
  const { translate, notify, protocolWarning, revalidate } = collaborators;
  const { dependency, error, errorCode } = event.data;
  const message =
    errorCode === "dependency_missing" && dependency
      ? translate("dependencyMissing", { dependency })
      : error.trim().length > 0
        ? error
        : translate("unknownError");

  try {
    notify(message);
  } catch {
    protocolWarning(NOTIFICATION_FAILURE_WARNING);
  }

  try {
    Promise.resolve(revalidate()).catch(() => {
      protocolWarning(REVALIDATION_FAILURE_WARNING);
    });
  } catch {
    protocolWarning(REVALIDATION_FAILURE_WARNING);
  }
}
