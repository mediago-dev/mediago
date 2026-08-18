import { expect, test, vi } from "vitest";
import {
  REQUIRED_TASK_VERSION,
  evaluateTaskVersion,
  runTaskVersionGate,
} from "./task-version-gate.ts";

test("accepts only the exact pinned Task version", () => {
  expect(REQUIRED_TASK_VERSION).toBe("3.51.1");
  expect(evaluateTaskVersion("3.51.1", "3.51.1")).toEqual({
    exitCode: 0,
  });
});

test("rejects a different validated version with an actionable switch hint", () => {
  const result = evaluateTaskVersion("3.50.0", "3.51.1");

  expect(result.exitCode).toBe(1);
  if (result.exitCode === 0) throw new Error("expected version rejection");
  expect(result.message).toMatch(/Task 3\.50\.0.*requires 3\.51\.1/i);
  expect(result.message).toMatch(
    /taskfile\.dev\/installation|mise use.*task@3\.51\.1/i,
  );
});

test("fails closed without reflecting unvalidated environment values", () => {
  const sentinel = "TASK_VERSION_SECRET_SENTINEL";
  const result = evaluateTaskVersion(`3.51.1\n${sentinel}`, "3.51.1");

  expect(result).toMatchObject({ exitCode: 1 });
  if (result.exitCode === 0) throw new Error("expected version rejection");
  expect(result.message).toMatch(/invalid Task version/i);
  expect(result.message).not.toContain(sentinel);
});

test("rejects a required-version configuration other than the repository pin", () => {
  const result = evaluateTaskVersion("3.51.1", "3.50.0");

  expect(result).toMatchObject({ exitCode: 1 });
  if (result.exitCode === 0) throw new Error("expected version rejection");
  expect(result.message).toMatch(/version gate is misconfigured/i);
  expect(result.message).not.toContain("3.50.0");
});

test("CLI adapter reads only the dedicated environment contract", () => {
  const writeError = vi.fn();

  expect(
    runTaskVersionGate(
      {
        MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
        MEDIAGO_TASK_VERSION: "3.50.0",
        UNRELATED_SECRET: "VERSION_GATE_MUST_NOT_PRINT_THIS",
      },
      writeError,
    ),
  ).toBe(1);
  expect(writeError).toHaveBeenCalledOnce();
  expect(writeError.mock.calls.join("\n")).not.toContain(
    "VERSION_GATE_MUST_NOT_PRINT_THIS",
  );
});
