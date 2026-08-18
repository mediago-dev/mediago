import { describe, expect, test } from "vitest";
import {
  RUNTIME_TOOLS,
  dependencyExecutablePath,
} from "./dependency-layout.ts";
import type { DependencyReadiness } from "./download-deps-provisioner.ts";
import {
  collectDoctorDiagnostics,
  parsePackageManagerPnpmVersion,
  parsePnpmUserAgentVersion,
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
      npm_config_user_agent: "pnpm/10.14.0 npm/? node/v25.4.0 linux x64",
      UNRELATED_SECRET: "DOCTOR_SECRET_SENTINEL",
    },
    inspectRuntime: async () => readiness,
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "linux",
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
      npm_config_user_agent: "pnpm/10.15.0 npm/? node/v25.4.0 linux x64",
    },
    inspectRuntime: async () => readiness,
    nodeVersion: "v25.4.0",
    packageManager: "pnpm@10.15.0",
    platform: "linux",
  });

  expect(result.exitCode).toBe(0);
  expect(result.lines).toHaveLength(5 + RUNTIME_TOOLS.length);
});
