import { expect, test } from "vitest";
import {
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_SNAP_THRESHOLD,
  clampSidebarExpandedWidth,
  resolveSidebarResize,
} from "./sidebar-sizing";

test("sidebar collapses below the midpoint snap threshold", () => {
  expect(resolveSidebarResize(SIDEBAR_SNAP_THRESHOLD - 1)).toStrictEqual({
    collapsed: true,
    width: SIDEBAR_COLLAPSED_WIDTH,
  });
});

test("sidebar snaps open at the midpoint threshold", () => {
  expect(resolveSidebarResize(SIDEBAR_SNAP_THRESHOLD)).toStrictEqual({
    collapsed: false,
    width: SIDEBAR_MIN_WIDTH,
  });
});

test("sidebar holds its minimum width inside the snap gap", () => {
  expect(resolveSidebarResize(SIDEBAR_MIN_WIDTH - 1)).toStrictEqual({
    collapsed: false,
    width: SIDEBAR_MIN_WIDTH,
  });
});

test("sidebar clamps widths above its maximum", () => {
  expect(resolveSidebarResize(SIDEBAR_MAX_WIDTH + 100)).toStrictEqual({
    collapsed: false,
    width: SIDEBAR_MAX_WIDTH,
  });
});

test("invalid persisted widths fall back to the default", () => {
  expect(clampSidebarExpandedWidth(Number.NaN)).toBe(SIDEBAR_DEFAULT_WIDTH);
});
