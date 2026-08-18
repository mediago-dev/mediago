import { describe, expect, test, vi } from "vitest";
import {
  RUNTIME_TOOLS,
  dependencyExecutablePath,
} from "./dependency-layout.ts";
import type { DependencyReadiness } from "./download-deps-provisioner.ts";
import {
  collectDoctorDiagnostics,
  parsePackageManagerPnpmVersion,
  parsePnpmUserAgentVersion,
  probePnpmVersion,
  type DoctorCommandProbe,
} from "./task-doctor.ts";

const unavailableGoProbe: DoctorCommandProbe = (command) => {
  if (command === "go") return { ok: false, stdout: "GO_SECRET_SENTINEL" };
  if (command === "docker") {
    return { ok: true, stdout: "Docker version 29.4.0, build private" };
  }
  throw new Error(`unexpected command: ${command}`);
};

const availableSystemProbe: DoctorCommandProbe = (command) =>
  command === "go"
    ? { ok: true, stdout: "go version go1.25.6 linux/amd64" }
    : { ok: true, stdout: "Docker version 29.4.0, build ignored" };

describe("doctor version parsing", () => {
  test("reads the exact pnpm pin from packageManager", () => {
    expect(parsePackageManagerPnpmVersion("pnpm@10.15.0")).toBe("10.15.0");
    expect(parsePackageManagerPnpmVersion("npm@11.0.0")).toBeUndefined();
    expect(
      parsePackageManagerPnpmVersion("pnpm@10.15.0\nDO_NOT_PRINT"),
    ).toBeUndefined();
  });

  test("accepts only a validated pnpm user-agent version", () => {
    expect(
      parsePnpmUserAgentVersion("pnpm/10.15.0 npm/? node/v25.4.0 linux x64"),
    ).toBe("10.15.0");
    expect(
      parsePnpmUserAgentVersion("pnpm/not-a-version DOCTOR_SECRET_SENTINEL"),
    ).toBeUndefined();
  });
});

test("aggregates every diagnostic and never reflects unrelated environment", async () => {
  const statuses = [
    "ready",
    "missing",
    "stale",
    "corrupt",
    "not-executable",
    "manifest-incomplete",
  ] as const;
  const readiness = RUNTIME_TOOLS.map(
    (toolName, index): DependencyReadiness => ({
      executablePath: dependencyExecutablePath(
        "/validated/deps",
        "linux-x64",
        toolName,
      ),
      platformKey: "linux-x64",
      status: statuses[index] ?? "corrupt",
      toolName,
      version: `v${index + 1}.0.0`,
    }),
  );
  const result = await collectDoctorDiagnostics({
    architecture: "x64",
    commandProbe: unavailableGoProbe,
    environment: {
      MEDIAGO_DEPS_ROOT: "/validated/deps",
      MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
      MEDIAGO_TASK_VERSION: "3.50.0",
      npm_config_user_agent: "pnpm/10.15.0 npm/? node/v25.4.0 linux x64",
      UNRELATED_SECRET: "DOCTOR_SECRET_SENTINEL",
    },
    inspectRuntime: async () => readiness,
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "linux",
    pnpmProbe: async () => "10.14.0",
  });

  expect(result.exitCode).toBe(1);
  expect(result.lines.join("\n")).toMatch(/Task.*requires 3\.51\.1/i);
  expect(result.lines.join("\n")).toMatch(/Node 25\.4\.0.*ready/i);
  expect(result.lines.join("\n")).toMatch(
    /pnpm 10\.14\.0.*expected 10\.15\.0/i,
  );
  expect(result.lines.join("\n")).toMatch(/Go.*unavailable/i);
  expect(result.lines.join("\n")).toMatch(/Docker 29\.4\.0.*ready/i);
  for (const [index, toolName] of RUNTIME_TOOLS.entries()) {
    expect(result.lines.join("\n")).toContain(toolName);
    expect(result.lines.join("\n")).toContain(statuses[index]);
  }
  expect(result.lines.join("\n")).not.toContain("DOCTOR_SECRET_SENTINEL");
  expect(result.lines.join("\n")).not.toContain("GO_SECRET_SENTINEL");
  expect(result.lines.at(-1)).toMatch(/hint:.*task deps:runtime.*task doctor/i);
});

test("returns success only when every exact tool and runtime check is ready", async () => {
  const readiness = RUNTIME_TOOLS.map(
    (toolName): DependencyReadiness => ({
      executablePath: dependencyExecutablePath(
        "/validated/deps",
        "linux-x64",
        toolName,
      ),
      platformKey: "linux-x64",
      status: "ready",
      toolName,
      version: "v1.0.0",
    }),
  );
  const result = await collectDoctorDiagnostics({
    architecture: "x64",
    commandProbe: availableSystemProbe,
    environment: {
      MEDIAGO_DEPS_ROOT: "/validated/deps",
      MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
      MEDIAGO_TASK_VERSION: "3.51.1",
      npm_config_user_agent: "pnpm/99.0.0 npm/? node/v25.4.0 linux x64",
    },
    inspectRuntime: async () => readiness,
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "linux",
    pnpmProbe: async () => "10.15.0",
  });

  expect(result.exitCode).toBe(0);
  expect(result.lines).toHaveLength(5 + RUNTIME_TOOLS.length);
});

test("does not trust a matching pnpm user agent when no executable resolves", async () => {
  const result = await collectDoctorDiagnostics({
    architecture: "x64",
    commandProbe: availableSystemProbe,
    environment: {
      MEDIAGO_DEPS_ROOT: "/validated/deps",
      MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
      MEDIAGO_TASK_VERSION: "3.51.1",
      npm_config_user_agent: "pnpm/10.15.0 npm/? node/v25.4.0 linux x64",
    },
    inspectRuntime: async () => readyReadiness("linux-x64"),
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "linux",
    pnpmProbe: async () => undefined,
  });

  expect(result.exitCode).toBe(1);
  expect(result.lines).toContain("error: pnpm version unavailable");
  expect(result.lines.join("\n")).not.toMatch(/ok: pnpm/i);
});

test("resolves and probes a simulated Windows pnpm.cmd through Node", async () => {
  const entrypoint = "C:\\tools\\pnpm\\node_modules\\pnpm\\bin\\pnpm.cjs";
  const environment = {
    PATH: "C:\\Windows\\System32",
    PNPM_HOME: "C:\\tools\\pnpm",
  };

  await expect(
    probePnpmVersion({
      environment,
      nodeExecutable: "C:\\node\\node.exe",
      platform: "win32",
      probePath: async (candidate) => {
        if (candidate === "C:\\tools\\pnpm\\pnpm.cmd") {
          return { isFile: true, realPath: candidate };
        }
        if (candidate === entrypoint) {
          return { isFile: true, realPath: candidate };
        }
        return undefined;
      },
      runLauncher: (launch) => {
        expect(launch).toEqual({
          args: [entrypoint, "--version"],
          command: "C:\\node\\node.exe",
          environment,
          shell: false,
        });
        return { ok: true, stdout: "10.15.0\n" };
      },
    }),
  ).resolves.toBe("10.15.0");
});

test("reports an unsupported runtime platform once without repair noise", async () => {
  const inspectRuntime = vi.fn();
  const result = await collectDoctorDiagnostics({
    architecture: "x64",
    commandProbe: availableSystemProbe,
    environment: {
      MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
      MEDIAGO_TASK_VERSION: "3.51.1",
    },
    inspectRuntime,
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "freebsd",
    pnpmProbe: async () => "10.15.0",
  });

  expect(result.exitCode).toBe(1);
  expect(result.lines).toContain(
    "error: current runtime platform is unsupported",
  );
  expect(result.lines.filter((line) => line.includes("runtime "))).toHaveLength(
    1,
  );
  expect(result.lines.join("\n")).not.toContain("task deps:runtime");
  expect(inspectRuntime).not.toHaveBeenCalled();
});

function readyReadiness(platformKey: "linux-x64"): DependencyReadiness[] {
  return RUNTIME_TOOLS.map(
    (toolName): DependencyReadiness => ({
      executablePath: dependencyExecutablePath(
        "/validated/deps",
        platformKey,
        toolName,
      ),
      platformKey,
      status: "ready",
      toolName,
      version: "v1.0.0",
    }),
  );
}
