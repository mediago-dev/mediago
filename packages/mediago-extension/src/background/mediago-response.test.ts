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

  test("snapshots the own data property exactly once", () => {
    let reads = 0;
    const oneRow = [{ id: 31 }];
    const twoRows = [{ id: 31 }, { id: 32 }];
    const response = {
      success: true,
      get data() {
        reads += 1;
        return reads < 3 ? oneRow : twoRows;
      },
    };

    expect(validateDownloadImportResponse(response, 1)).toEqual([31]);
    expect(reads).toBe(1);
  });

  test("snapshots the own success property exactly once", () => {
    let reads = 0;
    const response = {
      get success() {
        reads += 1;
        return reads === 1;
      },
      data: [{ id: 36 }],
    };

    expect(validateDownloadImportResponse(response, 1)).toEqual([36]);
    expect(reads).toBe(1);
  });

  test("snapshots each own id exactly once", () => {
    let reads = 0;
    const row = {
      get id(): number | string {
        reads += 1;
        return reads === 1 ? 41 : "41";
      },
    };

    expect(
      validateDownloadImportResponse({ success: true, data: [row] }, 1),
    ).toEqual([41]);
    expect(reads).toBe(1);
  });

  test.each([
    ["a secret string", "SENSITIVE_LENGTH_VALUE"],
    ["a negative number", -1],
    ["a fractional number", 1.5],
    ["an unsafe number", Number.MAX_SAFE_INTEGER + 1],
  ])("rejects %s returned by the data length getter", (_label, length) => {
    const data = new Proxy([], {
      get(target, property, receiver) {
        if (property === "length") return length;
        return Reflect.get(target, property, receiver);
      },
    });

    let message = "";
    try {
      validateDownloadImportResponse({ success: true, data }, 0);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toBe("Invalid download import response array length");
    expect(message).not.toContain(String(length));
  });

  test.each([
    ["zero", [], 0, []],
    ["positive", [{ id: 47 }], 1, [47]],
  ])(
    "snapshots a valid %s data length exactly once",
    (_label, rows, requestedCount, expectedIds) => {
      let reads = 0;
      const data = new Proxy(rows, {
        get(target, property, receiver) {
          if (property === "length") reads += 1;
          return Reflect.get(target, property, receiver);
        },
      });

      expect(
        validateDownloadImportResponse({ success: true, data }, requestedCount),
      ).toEqual(expectedIds);
      expect(reads).toBe(1);
    },
  );

  test("rejects sparse arrays instead of accepting missing rows", () => {
    const data: unknown[] = [];
    data.length = 2;
    expect(() =>
      validateDownloadImportResponse({ success: true, data }, 2),
    ).toThrow(/item/i);
  });

  test("rejects array rows inherited through a custom prototype", () => {
    const data: unknown[] = [];
    data.length = 1;
    const prototype = Object.create(Array.prototype) as Record<number, unknown>;
    prototype[0] = { id: 51 };
    Object.setPrototypeOf(data, prototype);

    expect(() =>
      validateDownloadImportResponse({ success: true, data }, 1),
    ).toThrow(/item/i);
  });

  test.each(["success", "data", "id"])(
    "turns a throwing %s getter into a stable non-secret validation error",
    (property) => {
      const secret = `secret-from-${property}-getter`;
      const throwingGetter = {
        get() {
          throw new Error(secret);
        },
        enumerable: true,
      };
      const row = { id: 1 };
      const response: Record<string, unknown> = {
        success: true,
        data: [row],
      };
      if (property === "id") {
        Object.defineProperty(row, property, throwingGetter);
      } else {
        Object.defineProperty(response, property, throwingGetter);
      }

      let message = "";
      try {
        validateDownloadImportResponse(response, 1);
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toMatch(/invalid/i);
      expect(message).not.toContain(secret);
    },
  );
});
