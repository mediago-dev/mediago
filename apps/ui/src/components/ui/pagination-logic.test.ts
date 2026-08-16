import { expect, test } from "vitest";
import {
  getPageItems,
  getPaginationState,
  shouldCorrectPage,
} from "./pagination-logic";

test("does not correct the requested page while its data is loading", () => {
  const { safeCurrent } = getPaginationState(2, 20, 0);

  expect(safeCurrent).toBe(1);
  expect(shouldCorrectPage(2, safeCurrent, true)).toBe(false);
});

test("keeps a valid requested page after its data has loaded", () => {
  const { safeCurrent } = getPaginationState(2, 20, 45);

  expect(safeCurrent).toBe(2);
  expect(shouldCorrectPage(2, safeCurrent, false)).toBe(false);
});

test("corrects an out-of-range page after its data has loaded", () => {
  const { safeCurrent } = getPaginationState(3, 20, 35);

  expect(safeCurrent).toBe(2);
  expect(shouldCorrectPage(3, safeCurrent, false)).toBe(true);
});

test("builds stable page items around the current page", () => {
  expect(getPageItems(6, 12)).toStrictEqual([
    1,
    "ellipsis-start",
    5,
    6,
    7,
    "ellipsis-end",
    12,
  ]);
});
