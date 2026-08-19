import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createPnpmLauncher,
  createWindowsTreeKillCommand,
  filesContainingSentinel,
  probePnpmPath,
  resolvePnpmEntrypoint,
} from "./bundle-env-runtime.ts";

describe("bundle environment pnpm runtime", () => {
  it("uses an absolute regular JavaScript npm_execpath", async () => {
    const candidates: string[] = [];
    const entrypoint = await resolvePnpmEntrypoint({
      environment: { npm_execpath: "/opt/pnpm/bin/pnpm.cjs" },
      platform: "linux",
      probe: async (candidate) => {
        candidates.push(candidate);
        return candidate === "/opt/pnpm/bin/pnpm.cjs"
          ? { isFile: true, realPath: candidate }
          : undefined;
      },
    });

    expect(entrypoint).toBe("/opt/pnpm/bin/pnpm.cjs");
    expect(candidates).toEqual(["/opt/pnpm/bin/pnpm.cjs"]);
  });

  it("resolves a simulated Windows pnpm shim to an adjacent JavaScript entrypoint", async () => {
    const jsEntrypoint = "C:\\tools\\pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs";
    const entrypoint = await resolvePnpmEntrypoint({
      environment: {
        PATH: "C:\\Windows\\System32",
        PNPM_HOME: "C:\\tools\\pnpm",
      },
      platform: "win32",
      probe: async (candidate) => {
        if (candidate === "C:\\tools\\pnpm\\pnpm.cmd") {
          return { isFile: true, realPath: candidate };
        }
        if (candidate === jsEntrypoint) {
          return { isFile: true, realPath: candidate };
        }
        return undefined;
      },
    });

    expect(entrypoint).toBe(jsEntrypoint);
  });

  it("resolves a standard simulated Windows Corepack shim", async () => {
    const shim = "C:\\Program Files\\nodejs\\pnpm.cmd";
    const jsEntrypoint =
      "C:\\Program Files\\nodejs\\node_modules\\corepack\\dist\\pnpm.js";
    const entrypoint = await resolvePnpmEntrypoint({
      environment: { PATH: "C:\\Program Files\\nodejs" },
      platform: "win32",
      probe: async (candidate) => {
        if (candidate === shim || candidate === jsEntrypoint) {
          return { isFile: true, realPath: candidate };
        }
        return undefined;
      },
    });

    expect(entrypoint).toBe(jsEntrypoint);
  });

  it("prefers a PATH pnpm installation before a stale PNPM_HOME", async () => {
    const pathDirectory = "C:\\path-pnpm";
    const pathEntrypoint = `${pathDirectory}\\node_modules\\pnpm\\bin\\pnpm.cjs`;
    const staleHome = "C:\\stale-pnpm-home";
    const staleEntrypoint = `${staleHome}\\node_modules\\pnpm\\bin\\pnpm.cjs`;
    const probed: string[] = [];

    const entrypoint = await resolvePnpmEntrypoint({
      environment: { PATH: pathDirectory, PNPM_HOME: staleHome },
      platform: "win32",
      probe: async (candidate) => {
        probed.push(candidate);
        if (
          candidate === `${pathDirectory}\\pnpm.cmd` ||
          candidate === pathEntrypoint ||
          candidate === `${staleHome}\\pnpm.cmd` ||
          candidate === staleEntrypoint
        ) {
          return { isFile: true, realPath: candidate };
        }
        return undefined;
      },
    });

    expect(entrypoint).toBe(pathEntrypoint);
    expect(probed).not.toContain(`${staleHome}\\pnpm.cmd`);
  });

  it.each(["relative", "absolute"] as const)(
    "resolves the pnpm/action-setup v6 %s self-update shim target",
    async (targetKind) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-action-setup-pnpm-"),
      );
      const pnpmHome = path.join(root, "node_modules", ".bin");
      const shimDirectory = path.join(pnpmHome, "bin");
      const entrypoint = path.join(
        pnpmHome,
        ".tools",
        "pnpm",
        "10.15.0",
        "node_modules",
        "pnpm",
        "bin",
        "pnpm.cjs",
      );
      const shim = path.join(shimDirectory, "pnpm");
      const shimTarget =
        targetKind === "absolute"
          ? entrypoint
          : "../.tools/pnpm/10.15.0/node_modules/pnpm/bin/pnpm.cjs";
      try {
        await Promise.all([
          fs.mkdir(path.dirname(entrypoint), { recursive: true }),
          fs.mkdir(shimDirectory, { recursive: true }),
        ]);
        await Promise.all([
          fs.writeFile(entrypoint, "module.exports = {};\n"),
          fs.writeFile(
            shim,
            [
              "#!/bin/sh",
              `# cmd-shim-target=${shimTarget}`,
              'exec node "$(dirname "$0")/../.tools/pnpm/10.15.0/node_modules/pnpm/bin/pnpm.cjs" "$@"',
              "",
            ].join("\n"),
          ),
        ]);

        await expect(
          resolvePnpmEntrypoint({
            environment: { PATH: shimDirectory, PNPM_HOME: pnpmHome },
            platform: "linux",
            probe: probePnpmPath,
          }),
        ).resolves.toBe(entrypoint);
      } finally {
        await fs.rm(root, { force: true, recursive: true });
      }
    },
  );

  it("resolves the pnpm/action-setup v6 isolated global shim target", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "mediago-action-setup-global-pnpm-"),
    );
    const pnpmHome = path.join(root, "node_modules", ".bin");
    const shimDirectory = path.join(pnpmHome, "bin");
    const entrypoint = path.join(
      pnpmHome,
      "global",
      "v11",
      "2bf86f-1a0185ad03b-3b4011fc01e6c43b",
      "node_modules",
      "pnpm",
      "bin",
      "pnpm.cjs",
    );
    const storeEntrypoint = path.join(
      pnpmHome,
      "store",
      "v11",
      "links",
      "@",
      "pnpm",
      "10.15.0",
      "359dc289e609e4780d0691c6504a31a5071af210f72dae21e58856578c7ee4bf",
      "node_modules",
      "pnpm",
      "bin",
      "pnpm.cjs",
    );
    const shim = path.join(shimDirectory, "pnpm");
    try {
      await Promise.all([
        fs.mkdir(path.dirname(storeEntrypoint), { recursive: true }),
        fs.mkdir(path.dirname(path.dirname(path.dirname(entrypoint))), {
          recursive: true,
        }),
        fs.mkdir(shimDirectory, { recursive: true }),
      ]);
      await fs.symlink(
        path.dirname(path.dirname(storeEntrypoint)),
        path.dirname(path.dirname(entrypoint)),
      );
      await Promise.all([
        fs.writeFile(storeEntrypoint, "module.exports = {};\n"),
        fs.writeFile(
          shim,
          [
            "#!/bin/sh",
            `exec node "${entrypoint}" "$@"`,
            `# cmd-shim-target=${entrypoint}`,
            "",
          ].join("\n"),
        ),
      ]);

      await expect(
        resolvePnpmEntrypoint({
          environment: { PATH: shimDirectory, PNPM_HOME: pnpmHome },
          platform: "linux",
          probe: probePnpmPath,
        }),
      ).resolves.toBe(storeEntrypoint);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an isolated global pnpm shim whose entrypoint escapes through a symlink", async () => {
    const root = await fs.mkdtemp(
      path.join(os.tmpdir(), "mediago-untrusted-global-pnpm-shim-"),
    );
    const pnpmHome = path.join(root, "pnpm-home");
    const shimDirectory = path.join(pnpmHome, "bin");
    const declaredEntrypoint = path.join(
      pnpmHome,
      "global",
      "v11",
      "2bf86f-1a0185ad03b-3b4011fc01e6c43b",
      "node_modules",
      "pnpm",
      "bin",
      "pnpm.cjs",
    );
    const outsideEntrypoint = path.join(root, "payload.cjs");
    const shim = path.join(shimDirectory, "pnpm");
    try {
      await Promise.all([
        fs.mkdir(path.dirname(declaredEntrypoint), { recursive: true }),
        fs.mkdir(shimDirectory, { recursive: true }),
      ]);
      await fs.writeFile(outsideEntrypoint, "module.exports = {};\n");
      await fs.symlink(outsideEntrypoint, declaredEntrypoint);
      await fs.writeFile(
        shim,
        [
          "#!/bin/sh",
          `# cmd-shim-target=${declaredEntrypoint}`,
          "exit 0",
          "",
        ].join("\n"),
      );

      await expect(
        resolvePnpmEntrypoint({
          environment: { PATH: shimDirectory, PNPM_HOME: pnpmHome },
          platform: "linux",
          probe: probePnpmPath,
        }),
      ).rejects.toThrow(/Unable to resolve.*pnpm/i);
    } finally {
      await fs.rm(root, { force: true, recursive: true });
    }
  });

  it.each(["absolute", "relative"] as const)(
    "rejects a pnpm shim with an %s target outside its installation tree",
    async (targetKind) => {
      const root = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-untrusted-pnpm-shim-"),
      );
      const pnpmHome = path.join(root, "pnpm-home");
      const shimDirectory = path.join(pnpmHome, "bin");
      const shim = path.join(shimDirectory, "pnpm");
      const outsideEntrypoint = path.join(root, "payload.cjs");
      const shimTarget =
        targetKind === "absolute"
          ? outsideEntrypoint
          : path.relative(shimDirectory, outsideEntrypoint);
      try {
        await fs.mkdir(shimDirectory, { recursive: true });
        await Promise.all([
          fs.writeFile(outsideEntrypoint, "module.exports = {};\n"),
          fs.writeFile(
            shim,
            ["#!/bin/sh", `# cmd-shim-target=${shimTarget}`, "exit 0", ""].join(
              "\n",
            ),
          ),
        ]);

        await expect(
          resolvePnpmEntrypoint({
            environment: { PATH: shimDirectory, PNPM_HOME: pnpmHome },
            platform: "linux",
            probe: probePnpmPath,
          }),
        ).rejects.toThrow(/Unable to resolve.*pnpm/i);
      } finally {
        await fs.rm(root, { force: true, recursive: true });
      }
    },
  );

  it("constructs a Node-only launcher on simulated Windows", () => {
    expect(
      createPnpmLauncher({
        args: ["run", "build:electron", "--force"],
        entrypoint: "C:\\tools\\pnpm\\pnpm.cjs",
        nodeExecutable: "C:\\node\\node.exe",
        platform: "win32",
      }),
    ).toEqual({
      args: ["C:\\tools\\pnpm\\pnpm.cjs", "run", "build:electron", "--force"],
      command: "C:\\node\\node.exe",
    });
  });

  it("constructs a direct absolute Windows taskkill tree command", () => {
    expect(
      createWindowsTreeKillCommand({
        environment: { SystemRoot: "C:\\Windows" },
        pid: 4321,
      }),
    ).toEqual({
      args: ["/PID", "4321", "/T", "/F"],
      command: "C:\\Windows\\System32\\taskkill.exe",
    });
    expect(() =>
      createWindowsTreeKillCommand({
        environment: { SystemRoot: "Windows" },
        pid: 4321,
      }),
    ).toThrow(/absolute SystemRoot/i);
  });

  it.each([
    [
      "relative npm_execpath",
      { npm_execpath: "node_modules/pnpm/bin/pnpm.cjs" },
      "absolute",
    ],
    ["missing pnpm", { PATH: "/empty", PNPM_HOME: "/also-empty" }, "pnpm"],
  ] as const)("rejects %s actionably", async (_name, environment, message) => {
    await expect(
      resolvePnpmEntrypoint({
        environment,
        platform: "linux",
        probe: async () => undefined,
      }),
    ).rejects.toThrow(message);
  });

  it("finds a sentinel split across bounded stream chunks", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "mediago-bundle-scan-test-"),
    );
    const filename = path.join(directory, "chunked.js");
    try {
      await fs.writeFile(
        filename,
        `${"x".repeat(64 * 1024 - 12)}mediago_bundle_secret_sentinel_6f2e7c9a`,
      );
      expect(await filesContainingSentinel(directory)).toEqual([filename]);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  });

  it.each(["root", "nested"] as const)(
    "rejects a %s bundle-directory symlink",
    async (location) => {
      const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-bundle-symlink-test-"),
      );
      const externalDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "mediago-bundle-external-test-"),
      );
      try {
        await fs.writeFile(path.join(externalDirectory, "bundle.js"), "safe");
        const scanRoot =
          location === "root" ? path.join(directory, "root-link") : directory;
        await fs.symlink(
          externalDirectory,
          location === "root" ? scanRoot : path.join(directory, "nested-link"),
        );

        await expect(filesContainingSentinel(scanRoot)).rejects.toThrow(
          /symbolic link/i,
        );
      } finally {
        await Promise.all([
          fs.rm(directory, { force: true, recursive: true }),
          fs.rm(externalDirectory, { force: true, recursive: true }),
        ]);
      }
    },
  );
});
