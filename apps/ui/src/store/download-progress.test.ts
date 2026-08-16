import { expect, test } from "vitest";
import { normalizeDownloadPercent } from "./download-progress";

test("keeps Go Core's 0-100 percent scale", () => {
  expect(normalizeDownloadPercent("0.5")).toBe(0.5);
  expect(normalizeDownloadPercent("1")).toBe(1);
  expect(normalizeDownloadPercent(99.5)).toBe(99.5);
});

test("clamps and rejects invalid percent values", () => {
  expect(normalizeDownloadPercent(150)).toBe(100);
  expect(normalizeDownloadPercent(-1)).toBe(null);
  expect(normalizeDownloadPercent(undefined)).toBe(null);
});
