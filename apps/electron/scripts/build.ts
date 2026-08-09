import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import dotenvFlow from "dotenv-flow";
import { type Configuration, build } from "electron-builder";

const args = process.argv.slice(2);
const isDir = args.includes("--dir");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../..");
const appRoot = path.resolve(__dirname, "..");
const arch = process.arch === "arm64" ? "arm64" : "x64";

// Resolve electron-builder's bundled `app-builder` native helper
// (wraps rcedit, ships inside `app-builder-bin`). We use it from
// `afterAllArtifactBuild` below to rewrite the NSIS installer's
// FileDescription — see the hook for why. `app-builder-bin` is
// a transitive dep of electron-builder, not a direct one, so we
// resolve it via nested `createRequire` scoped to electron-builder's
// own location.
const execFileAsync = promisify(execFile);
const localRequire = createRequire(import.meta.url);
const electronBuilderRequire = createRequire(
  localRequire.resolve("electron-builder/package.json"),
);
const { appBuilderPath } = electronBuilderRequire("app-builder-bin") as {
  appBuilderPath: string;
};

dotenvFlow.config({
  path: projectRoot,
});

const pkg = JSON.parse(await fs.readFile("./app/package.json", "utf-8"));

function getReleaseConfig(): Configuration {
  return {
    asar: true,
    asarUnpack: [],
    productName: process.env.APP_NAME,
    buildVersion: pkg.version,
    appId: process.env.APP_ID,
    copyright: process.env.APP_COPYRIGHT,
    // Register the custom scheme at install/first-run time.
    // • macOS: electron-builder merges this into CFBundleURLTypes.
    // • Windows: runtime `app.setAsDefaultProtocolClient` in src/index.ts
    //   handles registry entries on first launch — electron-builder
    //   doesn't write these directly.
    // • Linux: runtime handler writes the .desktop file at first launch.
    protocols: [
      {
        name: "MediaGo URL Scheme",
        schemes: [process.env.APP_NAME as string],
      },
    ],
    artifactName:
      "${productName}-setup-${platform}-${arch}-${buildVersion}.${ext}",
    npmRebuild: true,
    directories: {
      output: "./release",
    },
    files: [
      {
        from: "./build/main",
        to: "./main",
      },
      {
        from: "./build/renderer",
        to: "./renderer",
      },
      {
        from: "./build/preload",
        to: "./preload",
      },
      "./package.json",
      "!**/node_modules/**",
      "**/node_modules/@mediago/electron-preload/**",
      "**/node_modules/@mediago/browser-extension/**",
      "**/node_modules/@ghostery/adblocker-electron-preload/**",
    ],
    extraResources: [
      {
        from: "./app/build/plugin",
        to: "plugin",
      },
      {
        from: "./app/build/bin",
        to: "bin",
      },
      {
        from: "./app/build/deps",
        to: "deps",
      },
      {
        // MediaGo browser extension (Manifest V3). Shipped unpacked
        // inside the installer's `resources/extension/` so users can
        // "Load unpacked" it from Chrome / Edge via the Settings page's
        // "Browser extension directory" button. The runtime path is
        // resolved by `resolveExtensionDir()` in binaryResolver.ts.
        from: "./app/build/extension",
        to: "extension",
      },
      {
        from: "../../THIRD_PARTY_NOTICES.md",
        to: "THIRD_PARTY_NOTICES.md",
      },
    ],
    win: {
      icon: "../assets/icon.ico",
      target: [
        {
          target: "nsis",
          arch,
        },
        {
          target: "portable",
          arch,
        },
      ],
    },
    portable: {
      artifactName:
        "${productName}-portable-${platform}-${arch}-${buildVersion}.${ext}",
    },
    dmg: {
      contents: [
        {
          x: 410,
          y: 150,
          type: "link",
          path: "/Applications",
        },
        {
          x: 130,
          y: 150,
          type: "file",
        },
      ],
    },
    mac: {
      icon: "../assets/icon.icns",
      identity: null,
      target: [
        {
          target: "dmg",
          arch,
        },
      ],
      extendInfo: {
        CFBundleURLTypes: [
          {
            CFBundleURLName: "MediaGo URL Scheme",
            // Must match `process.env.APP_NAME` in .env — the same
            // scheme used by src/index.ts's setAsDefaultProtocolClient
            // and by the browser extension's MEDIAGO_SCHEME.
            CFBundleURLSchemes: [process.env.APP_NAME as string],
          },
        ],
      },
    },
    linux: {
      category: "Utility",
      icon: "../assets/icon.icns",
      maintainer: "caorushizi <84996057@qq.com>",
      target: {
        target: "deb",
        arch,
      },
    },
    nsis: {
      oneClick: false,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      // Inject our customHeader macro to add the version to the
      // installer title bar. See comments in
      // `apps/electron/installer/installer.nsh`.
      include: "./installer/installer.nsh",
    },
    // Rewrite the NSIS installer's `FileDescription` after the fact.
    //
    // Why this isn't done in the .nsh header: electron-builder's
    // `NsisTarget.computeVersionKey()` unconditionally emits
    //   VIAddVersionKey /LANG=1033 "FileDescription" "${appInfo.description}"
    // into the generated .nsi — binding the installer's FileDescription
    // to the app binary's (both drawn from `app/package.json:description`).
    // Any customHeader `VIAddVersionKey` with the same LANG+key triggers
    // a hard NSIS "already defined!" error that `-WX` does not gate, and
    // a different LANG (e.g. 0) triggers `warning 9100: without standard
    // key FileVersion` which IS gated by `-WX`. There is no in-NSIS way
    // to override this cleanly.
    //
    // Inno Setup (used by VS Code, Chrome) gets this for free via a
    // default `VersionInfoDescription = "{AppName} Setup"`. NSIS has no
    // such default, so we post-process the artifact with the same
    // `app-builder rcedit` call electron-builder itself uses on
    // `mediago.exe` (see winPackager.js around line 185).
    afterAllArtifactBuild: async ({ artifactPaths }) => {
      // rcedit crashes when executed through Wine (per electron-builder's
      // own note in winPackager.js:183); skip on Linux. Windows installer
      // artifacts aren't produced on Linux builds anyway.
      if (process.platform !== "win32" && process.platform !== "darwin") {
        return [];
      }
      const installers = artifactPaths.filter((p) =>
        /-setup-win32-.*\.exe$/i.test(path.basename(p)),
      );
      for (const installer of installers) {
        await execFileAsync(appBuilderPath, [
          "rcedit",
          "--args",
          JSON.stringify([
            installer,
            "--set-version-string",
            "FileDescription",
            `${process.env.APP_NAME} installer`,
          ]),
        ]);
      }
      return [];
    },
  };
}

const electronTask = [
  {
    src: "apps/electron/build",
    dest: "app/build/main",
  },
  {
    src: "apps/ui/build/electron",
    dest: "app/build/renderer",
  },
  {
    src: "packages/electron-preload/build",
    dest: "app/build/preload",
  },
  {
    src: "packages/browser-extension/build",
    dest: "app/build/plugin",
  },
  {
    // MediaGo browser extension dist — produced upstream by
    // `turbo run build -F @mediago/extension` (wired into
    // `pnpm build:electron` at the repo root). Gets zipped into the
    // installer via the `extraResources` entry above.
    src: "packages/mediago-extension/dist",
    dest: "app/build/extension",
  },
];

for (const task of electronTask) {
  await fs.cp(
    path.resolve(projectRoot, task.src),
    path.resolve(appRoot, task.dest),
    {
      recursive: true,
      force: true,
    },
  );
}

// Copy Go binaries to app/build/bin/ and app/build/deps/ for extraResources
const isWindows = os.platform() === "win32";
const ext = isWindows ? ".exe" : "";
const binDir = path.resolve(appRoot, "app/build/bin");
const depsDir = path.resolve(appRoot, "app/build/deps");

await fs.mkdir(binDir, { recursive: true });
await fs.mkdir(depsDir, { recursive: true });

// Copy mediago-core binary + config
await fs.copyFile(
  path.resolve(projectRoot, `apps/core/bin/mediago-core${ext}`),
  path.join(binDir, `mediago-core${ext}`),
);

// Copy dependency binaries (ffmpeg, N_m3u8DL-RE, BBDown, aria2c, yt-dlp)
const platformKey = `${os.platform()}-${os.arch()}`;
const localDepsDir = path.resolve(projectRoot, ".deps", platformKey);
try {
  await fs.cp(localDepsDir, depsDir, { recursive: true, force: true });
} catch {
  console.warn(`Warning: .deps/${platformKey} not found, skipping deps copy`);
}

const config = getReleaseConfig();
if (process.env.GH_TOKEN) {
  config.publish = {
    provider: "github",
    repo: "mediago",
    owner: "caorushizi",
    releaseType: "draft",
  };
}
await build({
  config,
  dir: isDir,
  // targets: Platform.WINDOWS.createTarget(["nsis", "portable"], Arch.x64),
});
