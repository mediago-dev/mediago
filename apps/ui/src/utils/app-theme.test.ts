import { AppTheme } from "@mediago/shared-common";
import { expect, test } from "vitest";
import { resolveAppTheme } from "./app-theme";

test("resolves explicit and system themes", () => {
  expect(resolveAppTheme(AppTheme.System, true)).toBe("dark");
  expect(resolveAppTheme(AppTheme.System, false)).toBe("light");
  expect(resolveAppTheme(AppTheme.Dark, false)).toBe("dark");
  expect(resolveAppTheme(AppTheme.Light, true)).toBe("light");
});
