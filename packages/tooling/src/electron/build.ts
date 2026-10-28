import { execFileSync } from "node:child_process";
import {
  configureInstallerMetadata,
  getApplicationCopyright,
} from "./installer-metadata.ts";
import { withAppleNetworkRetry } from "./macos-network-retry.ts";
import {
  getWindowsTestVersion,
  signWindowsTestFile,
  verifyWindowsReleaseArtifacts,
} from "./windows-signing.ts";
import { SIGNPATH_PUBLISHER_DN } from "../../../../apps/electron/src/vendor/windows-signature.ts";
import fs from "node:fs/promises";
import os from "node:os";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadProfileEnv } from "@mediago/tooling/env";
import { type Configuration, build } from "electron-builder";
import {
  resolveMacOSSigningSettings,
  verifyMacOSDistributionArtifacts,
} from "./macos-signing.ts";

const args = process.argv.slice(2);
const isDir = args.includes("--dir");

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "../../../..");
const appRoot = path.resolve(projectRoot, "apps/electron");
const arch = process.arch === "arm64" ? "arm64" : "x64";
const [repositoryOwner, repositoryName] = (
  process.env.GITHUB_REPOSITORY ?? "mediago-dev/mediago"
).split("/");

if (!repositoryOwner || !repositoryName) {
  throw new Error(
    `Invalid GITHUB_REPOSITORY value: ${process.env.GITHUB_REPOSITORY}`,
  );
}

loadProfileEnv(projectRoot);

const macOSSigning = resolveMacOSSigningSettings({
  platform: process.platform,
  isDir,
});

const pkg = JSON.parse(
  await fs.readFile(path.resolve(appRoot, "app/package.json"), "utf-8"),
);

function getUpdateChannel(
  version: unknown,
): "alpha" | "beta" | "latest" | "test" {
  if (typeof version !== "string") {
    throw new Error("Electron application version must be a string");
  }
  if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) {
    return "latest";
  }
  const prerelease =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)-(alpha|beta|test)\.(0|[1-9]\d*)$/.exec(
      version,
    );
  if (!prerelease) {
    throw new Error(`Unsupported Electron release version: ${version}`);
  }
  return prerelease[4] as "alpha" | "beta" | "test";
}

const updateChannel = getUpdateChannel(pkg.version);

function getReleaseConfig(): Configuration {
  return {
    asar: true,
    asarUnpack: [],
    productName: process.env.APP_NAME,
    buildVersion: pkg.version,
    ...(process.env.MEDIAGO_SIGNPATH_TEST === "1"
      ? { buildNumber: getWindowsTestVersion(pkg.version).buildNumber }
      : {}),
    appId: process.env.APP_ID,
    copyright: getApplicationCopyright(process.env.APP_COPYRIGHT),
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
    artifactName: "mediago-setup-${platform}-${arch}-${buildVersion}.${ext}",
    npmRebuild: true,
    directories: {
      output: "./release",
    },
    // Always generate updater metadata, but never let the platform matrix
    // publish on its own. The release workflow uploads every platform from a
    // single job after all required builds have succeeded.
    publish: {
      provider: "github",
      owner: repositoryOwner,
      repo: repositoryName,
      channel: updateChannel,
      releaseType: "draft",
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
      signtoolOptions: {
        publisherName: SIGNPATH_PUBLISHER_DN,
        ...(process.env.MEDIAGO_SIGNPATH_TEST === "1"
          ? {
              signingHashAlgorithms: ["sha256"] as const,
              sign: signWindowsTestFile,
            }
          : {}),
      },
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
        "mediago-portable-${platform}-${arch}-${buildVersion}.${ext}",
    },
    dmg: {
      background: "../assets/dmg-background.png",
      sign: macOSSigning.signDmg,
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
      forceCodeSigning: macOSSigning.forceCodeSigning,
      hardenedRuntime: macOSSigning.hardenedRuntime,
      notarize: macOSSigning.notarize,
      target: [
        {
          target: "dmg",
          arch,
        },
        // electron-updater's macOS updater downloads ZIP archives. Keep the
        // DMG for manual installs and publish both architectures' ZIP files.
        {
          target: "zip",
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
      icon: "../assets/icons/linux",
      maintainer: "caorushizi <84996057@qq.com>",
      target: {
        target: "deb",
        arch,
      },
    },
    nsis: {
      uninstallDisplayName: "${productName}",
      oneClick: false,
      displayLanguageSelector: true,
      allowElevation: true,
      allowToChangeInstallationDirectory: true,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      // Inject our customHeader macro to add the version to the
      // installer title bar. See comments in
      // `apps/electron/installer/installer.nsh`.
      include: "./installer/installer.nsh",
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

await fs.rm(path.resolve(appRoot, "app/build"), {
  recursive: true,
  force: true,
});

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

// Copy the core service and user-facing CLI into resources/bin.
await Promise.all([
  fs.copyFile(
    path.resolve(projectRoot, `apps/core/bin/mediago-core${ext}`),
    path.join(binDir, `mediago-core${ext}`),
  ),
  fs.copyFile(
    path.resolve(projectRoot, `apps/core/bin/mediago${ext}`),
    path.join(binDir, `mediago${ext}`),
  ),
]);

// Copy dependency binaries (ffmpeg, N_m3u8DL-RE, BBDown, aria2c, yt-dlp, Deno)
const platformKey = `${os.platform()}-${os.arch()}`;
const configuredDepsDir = process.env.MEDIAGO_DEPS_DIR?.trim();
const localDepsDir = configuredDepsDir
  ? path.resolve(configuredDepsDir)
  : path.resolve(projectRoot, ".deps", platformKey);
const dependencyDirectory = await fs.stat(localDepsDir).catch(() => undefined);
if (!dependencyDirectory?.isDirectory()) {
  throw new Error(
    `Runtime dependency directory is missing or invalid: ${localDepsDir}. Run task deps:runtime before packaging.`,
  );
}
await fs.cp(localDepsDir, depsDir, { recursive: true, force: true });
// Rebuild the external engine; copying its old release binary retains Go CVEs.
execFileSync(
  "go",
  [
    "run",
    path.resolve(
      projectRoot,
      "packages/tooling/src/runtime-deps/rebuild-mediago.go",
    ),
    "--output",
    path.join(depsDir, `mediago${ext}`),
    "--platform",
    platformKey,
  ],
  {
    stdio: "inherit",
    env: { ...process.env, GOWORK: "off", GOTOOLCHAIN: "go1.27.3" },
  },
);

const config = getReleaseConfig();
const packageArtifacts = () =>
  build({
    config,
    dir: isDir,
    publish: "never",
    effectiveOptionComputed: configureInstallerMetadata,
  });
const artifacts = macOSSigning.enabled
  ? await withAppleNetworkRetry(packageArtifacts, {
      label: "signed macOS packaging",
      attempts: 3,
    })
  : await packageArtifacts();

verifyWindowsReleaseArtifacts({
  platform: process.platform,
  runMode: process.env.RUN_MODE,
  isDir,
  releaseDirectory: path.resolve(appRoot, "release"),
  version: pkg.version,
  arch,
});
if (macOSSigning.enabled) {
  await verifyMacOSDistributionArtifacts({
    releaseDirectory: path.resolve(appRoot, "release"),
    artifacts,
  });
}
