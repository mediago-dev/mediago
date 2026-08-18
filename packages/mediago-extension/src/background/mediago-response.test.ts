import { describe, expect, test } from "vitest";
import { validateDownloadImportResponse } from "./mediago-response.ts";

describe("validateDownloadImportResponse", () => {
  test("returns positive numeric Download IDs from a compatible success envelope", () => {
    expect(
      validateDownloadImportResponse(
        {
          success: true,
          code: 200,
          message: "OK",
          data: [
            { id: 17, name: "first" },
            { id: 23, url: "https://example.test/second" },
          ],
        },
        2,
      ),
    ).toEqual([17, 23]);
  });

  test("accepts an empty response only when zero rows were requested", () => {
    expect(
      validateDownloadImportResponse({ success: true, data: [] }, 0),
    ).toEqual([]);
  });

  test.each([
    ["negative", -1],
    ["fractional", 1.5],
    ["unsafe", Number.MAX_SAFE_INTEGER + 1],
    ["NaN", Number.NaN],
    ["infinite", Number.POSITIVE_INFINITY],
  ])("rejects a %s requested count", (_label, requestedCount) => {
    expect(() =>
      validateDownloadImportResponse(
        { success: true, data: [] },
        requestedCount,
      ),
    ).toThrow(/requested count/i);
  });

  test.each([
    ["null", null],
    ["an array", []],
    ["a primitive", "success"],
    ["a Date", new Date()],
    ["success false", { success: false, data: [] }],
    ["success missing", { data: [] }],
    ["data missing", { success: true }],
    ["data null", { success: true, data: null }],
    ["data object", { success: true, data: {} }],
  ])("rejects %s as a response envelope", (_label, response) => {
    expect(() => validateDownloadImportResponse(response, 0)).toThrow(
      /response/i,
    );
  });

  test("rejects response fields inherited through a prototype", () => {
    const response = Object.create({ success: true, data: [] }) as unknown;
    expect(() => validateDownloadImportResponse(response, 0)).toThrow(
      /response/i,
    );
  });

  test.each([
    ["missing rows", [{ id: 1 }], 2],
    ["extra rows", [{ id: 1 }, { id: 2 }], 1],
  ])("rejects %s", (_label, data, requestedCount) => {
    expect(() =>
      validateDownloadImportResponse({ success: true, data }, requestedCount),
    ).toThrow(/count/i);
  });

  test.each([
    ["a missing id", {}],
    ["a string id", { id: "1" }],
    ["a zero id", { id: 0 }],
    ["a negative id", { id: -1 }],
    ["a fractional id", { id: 1.5 }],
    ["an unsafe id", { id: Number.MAX_SAFE_INTEGER + 1 }],
    ["a NaN id", { id: Number.NaN }],
    ["an infinite id", { id: Number.POSITIVE_INFINITY }],
    ["a null row", null],
    ["an array row", [{ id: 1 }]],
  ])("rejects %s", (_label, row) => {
    expect(() =>
      validateDownloadImportResponse({ success: true, data: [row] }, 1),
    ).toThrow(/id|item/i);
  });

  test("rejects an id inherited through a prototype", () => {
    const row = Object.create({ id: 1 }) as unknown;
    expect(() =>
      validateDownloadImportResponse({ success: true, data: [row] }, 1),
    ).toThrow(/id/i);
  });
});
