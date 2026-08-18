import path from "node:path";
import { describe, expect, test } from "vitest";
import manifestJson from "./deps-versions.json" with { type: "json" };
import {
  E2E_TOOLS,
  MEDIA_INTEGRATION_TOOLS,
  RUNTIME_TOOLS,
  SUPPORTED_RUNTIME_PLATFORMS,
  dependencyExecutableName,
  dependencyExecutablePath,
  isWindowsPlatformKey,
  platformDepsDir,
  platformKeyFor,
  preflightToolAssets,
  resolveDepsRoot,
  selectedToolNames,
  type DependencyToolName,
  type DependencyManifest,
  type PinnedDependencyManifest,
  type RuntimePlatform,
} from "./dependency-layout.ts";

const manifest: PinnedDependencyManifest = manifestJson;
const completeRuntimePlatforms: readonly RuntimePlatform[] = [
  "darwin-arm64",
  "darwin-x64",
  "linux-arm64",
  "linux-x64",
  "win32-x64",
];

describe("dependency layout", () => {
  test("defines the complete pinned runtime tool groups", () => {
    expect(RUNTIME_TOOLS).toEqual([
      "ffmpeg",
      "N_m3u8DL-RE",
      "BBDown",
      "aria2",
      "yt-dlp",
      "mediago",
    ]);
    expect(MEDIA_INTEGRATION_TOOLS).toEqual([
      "aria2",
      "N_m3u8DL-RE",
      "ffmpeg",
      "BBDown",
    ]);
    expect(E2E_TOOLS).toEqual(["aria2"]);
  });

  test("lists only platforms with complete runtime assets as supported", () => {
    expect(SUPPORTED_RUNTIME_PLATFORMS).toEqual([
      "darwin-x64",
      "darwin-arm64",
      "linux-x64",
      "linux-arm64",
      "win32-x64",
    ]);
  });

  test.each([
    ["darwin", "arm64", "darwin-arm64"],
    ["darwin", "x64", "darwin-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["linux", "x64", "linux-x64"],
    ["win32", "arm64", "win32-arm64"],
    ["win32", "x64", "win32-x64"],
  ] as const)("maps Node %s/%s to %s", (platform, arch, expected) => {
    expect(platformKeyFor(platform, arch)).toBe(expected);
  });

  test("rejects unsupported Node platform and architecture pairs", () => {
    expect(() => platformKeyFor("linux", "riscv64")).toThrow(
      /Unsupported runtime platform: linux-riscv64.*Selectable runtime platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-arm64, win32-x64/i,
    );
  });

  test("uses MEDIAGO_DEPS_ROOT ahead of the repository default", () => {
    expect(
      resolveDepsRoot("/repo", {
        MEDIAGO_DEPS_ROOT: "/tmp/mediago-deps",
      }),
    ).toBe(path.resolve("/tmp/mediago-deps"));
    expect(resolveDepsRoot("/repo", {})).toBe(path.resolve("/repo/.deps"));
  });

  test("never accepts a poisoned MEDIAGO_DEPS_DIR as the root", () => {
    expect(
      resolveDepsRoot("/repo", {
        MEDIAGO_DEPS_DIR: "/tmp/runtime-leaf",
      }),
    ).toBe(path.resolve("/repo/.deps"));
  });

  test("constructs canonical platform leaf and executable paths", () => {
    expect(platformDepsDir("/tmp/deps", "linux-x64")).toBe(
      path.join("/tmp/deps", "linux-x64"),
    );
    expect(dependencyExecutablePath("/tmp/deps", "linux-x64", "ffmpeg")).toBe(
      path.join("/tmp/deps", "linux-x64", "ffmpeg"),
    );
    expect(dependencyExecutablePath("/tmp/deps", "win32-x64", "ffmpeg")).toBe(
      path.join("/tmp/deps", "win32-x64", "ffmpeg.exe"),
    );
  });

  test.each([
    ["ffmpeg", "ffmpeg", "ffmpeg.exe"],
    ["N_m3u8DL-RE", "N_m3u8DL-RE", "N_m3u8DL-RE.exe"],
    ["BBDown", "BBDown", "BBDown.exe"],
    ["aria2", "aria2c", "aria2c.exe"],
    ["yt-dlp", "yt-dlp", "yt-dlp.exe"],
    ["mediago", "mediago", "mediago.exe"],
  ] as const)(
    "maps %s to its Unix and Windows executable names",
    (toolName, unixName, windowsName) => {
      expect(dependencyExecutableName(toolName, "linux-x64")).toBe(unixName);
      expect(dependencyExecutableName(toolName, "win32-arm64")).toBe(
        windowsName,
      );
    },
  );

  test("recognizes Windows platform keys", () => {
    expect(isWindowsPlatformKey("win32-arm64")).toBe(true);
    expect(isWindowsPlatformKey("win32-x64")).toBe(true);
    expect(isWindowsPlatformKey("darwin-x64")).toBe(false);
    expect(isWindowsPlatformKey("linux-x64")).toBe(false);
  });

  test("selects all or requested tools in manifest order", () => {
    const allTools = Object.keys(manifest) as DependencyToolName[];
    expect(selectedToolNames(manifest)).toEqual(allTools);
    expect(selectedToolNames(manifest, ["aria2", "BBDown", "aria2"])).toEqual([
      "BBDown",
      "aria2",
    ]);
    expect(() => selectedToolNames(manifest, ["missing"])).toThrow(
      /Unknown dependency tool "missing".*ffmpeg.*BBDown.*mediago/i,
    );
  });

  test("proves complete pinned manifest support for the five complete platforms", () => {
    expect(() =>
      preflightToolAssets(
        selectedToolNames(manifest),
        manifest,
        completeRuntimePlatforms,
        "/tmp/mediago-deps",
      ),
    ).not.toThrow();
  });

  test("fails complete win32-arm64 preflight before I/O with actionable context", () => {
    expect(() =>
      preflightToolAssets(
        selectedToolNames(manifest),
        manifest,
        ["win32-arm64"],
        "/tmp/mediago-deps",
      ),
    ).toThrow(
      /ffmpeg.*b6\.0.*win32-arm64.*[\\/]tmp[\\/]mediago-deps[\\/]win32-arm64[\\/]ffmpeg\.exe.*pnpm deps:download:raw --tools ffmpeg --platform win32-arm64/is,
    );
  });

  test("uses the canonical executable name in preflight diagnostics", () => {
    const poisonedManifest: PinnedDependencyManifest = {
      ...manifest,
      ffmpeg: {
        ...manifest.ffmpeg,
        binaryName: { default: "poisoned", win32: "poisoned.exe" },
      },
    };

    let diagnostic = "";
    try {
      preflightToolAssets(
        ["ffmpeg"],
        poisonedManifest,
        ["win32-arm64"],
        "/tmp/mediago-deps",
      );
    } catch (error) {
      diagnostic = String(error);
    }
    expect(diagnostic).toContain(path.join("win32-arm64", "ffmpeg.exe"));
    expect(diagnostic).not.toContain("poisoned.exe");
  });

  test("permits selective BBDown provisioning on win32-arm64", () => {
    expect(() =>
      preflightToolAssets(
        ["BBDown"],
        manifest,
        ["win32-arm64"],
        "/tmp/mediago-deps",
      ),
    ).not.toThrow();
  });

  test("aggregates missing assets in manifest order", () => {
    const incompleteManifest: DependencyManifest = {
      ...manifest,
      ffmpeg: { ...manifest.ffmpeg, assets: {} },
      BBDown: { ...manifest.BBDown, assets: {} },
    };

    let diagnostic = "";
    try {
      preflightToolAssets(
        ["BBDown", "ffmpeg"],
        incompleteManifest,
        ["linux-x64", "win32-x64"],
        "/tmp/aggregate",
      );
    } catch (error) {
      diagnostic = String(error);
    }

    expect(diagnostic).toContain("ffmpeg");
    expect(diagnostic).toContain("BBDown");
    expect(diagnostic.indexOf("ffmpeg")).toBeLessThan(
      diagnostic.indexOf("BBDown"),
    );
    expect(diagnostic.match(/has no pinned asset/g)).toHaveLength(4);
  });
});
