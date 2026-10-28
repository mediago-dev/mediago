import { NsisUpdater, type UpdateDownloadedEvent } from "electron-updater";
import {
  assertWindowsUpdateSignature,
  verifyWindowsUpdateSignature,
} from "./windows-signature";

export default class VerifiedNsisUpdater extends NsisUpdater {
  constructor() {
    super();
    this.verifyUpdateCodeSignature = (_publishers, file) =>
      verifyWindowsUpdateSignature(file);
  }

  protected override dispatchUpdateDownloaded(
    event: UpdateDownloadedEvent,
  ): void {
    // This also runs for cached downloads and configurations without publisherName.
    assertWindowsUpdateSignature(event.downloadedFile);
    super.dispatchUpdateDownloaded(event);
  }

  protected override doInstall(options: {
    isSilent: boolean;
    isForceRunAfter: boolean;
    isAdminRightsRequired: boolean;
  }): boolean {
    // Both explicit installation and install-on-quit pass through this entry.
    if (!this.installerPath)
      throw new Error("The Windows installer is missing");
    assertWindowsUpdateSignature(this.installerPath);
    return super.doInstall(options);
  }
}
