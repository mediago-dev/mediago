import "reflect-metadata";
import { buildProviderModule } from "@inversifyjs/binding-decorators";
import { app, protocol } from "electron";
import { Container } from "inversify";
import ElectronApp from "./app";
import { registerGracefulQuit } from "./lifecycle";
import { defaultScheme, noop } from "./utils";
import path from "node:path";

if (process.env.PORTABLE_EXECUTABLE_DIR) {
  app.setPath(
    "userData",
    path.join(process.env.PORTABLE_EXECUTABLE_DIR, "data"),
  );
}

const container = new Container({
  defaultScope: "Singleton",
});

const gotTheLock = app.requestSingleInstanceLock();
let mediagoApp: ElectronApp | null = null;
let mediagoReady = false;
const pendingCommandLines: string[][] = [process.argv];
const pendingProtocolUrls: string[] = [];

app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mediagoApp) {
    mediagoApp.handleExternalUrl(url, mediagoReady);
  } else {
    pendingProtocolUrls.push(url);
  }
});

app.on("second-instance", (_event, commandLine) => {
  if (mediagoApp) {
    mediagoApp.handleExternalCommandLine(commandLine, mediagoReady);
  } else {
    pendingCommandLines.push(commandLine);
  }
});

registerGracefulQuit(
  app,
  async () => mediagoApp?.shutdown(),
  (error) => console.error("Electron shutdown failed", error),
);

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(defaultScheme, process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient(defaultScheme);
}

const start = async (): Promise<void> => {
  if (!gotTheLock) {
    app.quit();
    return;
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: defaultScheme,
      privileges: {
        secure: true,
        standard: true,
      },
    },
  ]);
  await app.whenReady();
  await container.load(buildProviderModule());
  const initializedApp = container.get(ElectronApp);
  mediagoApp = initializedApp;
  pendingCommandLines
    .splice(0)
    .forEach((commandLine) =>
      initializedApp.handleExternalCommandLine(commandLine, false),
    );
  pendingProtocolUrls
    .splice(0)
    .forEach((url) => initializedApp.handleExternalUrl(url, false));
  await initializedApp.init();
  mediagoReady = true;
  initializedApp.presentPendingExternalInvocations();
  app.on("window-all-closed", noop);
};

void start();
