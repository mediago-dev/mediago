import { describe, expect, test } from "vitest";
import { parseDownloadEventPayload } from "./download-event-payload";

describe("parseDownloadEventPayload", () => {
  test.each(["1", "42"])(
    "accepts positive safe-integer decimal ID %s",
    (id) => {
      expect(parseDownloadEventPayload("start", { id })).toEqual({
        type: "start",
        data: { id: Number(id) },
      });
    },
  );

  test.each([
    ["zero", "0"],
    ["negative", "-1"],
    ["leading whitespace", " 1"],
    ["trailing whitespace", "1 "],
    ["decimal", "1.5"],
    ["exponent", "1e2"],
    ["UUID", "123e4567-e89b-12d3-a456-426614174000"],
    ["empty string", ""],
    ["leading zero", "01"],
    ["above safe integer", "9007199254740992"],
    ["null", null],
    ["undefined", undefined],
    ["number", 42],
    ["Number object", new Number(42)],
    ["bigint", 42n],
  ])("rejects a %s ID", (_description, id) => {
    expect(parseDownloadEventPayload("start", { id })).toBeNull();
  });

  test("rejects non-object payloads", () => {
    for (const payload of [null, undefined, "42", 42, [], true]) {
      expect(parseDownloadEventPayload("success", payload)).toBeNull();
    }
  });

  test("preserves type-safe failure details", () => {
    expect(
      parseDownloadEventPayload("failed", {
        id: "42",
        error: "BBDown was not found",
        errorCode: "dependency_missing",
        dependency: "BBDown",
      }),
    ).toEqual({
      type: "failed",
      data: {
        id: 42,
        error: "BBDown was not found",
        errorCode: "dependency_missing",
        dependency: "BBDown",
      },
    });
  });

  test("drops untrusted optional failure fields without coercion", () => {
    expect(
      parseDownloadEventPayload("failed", {
        id: "42",
        error: { message: "secret" },
        errorCode: "unexpected_code",
        dependency: 123,
      }),
    ).toEqual({
      type: "failed",
      data: { id: 42, error: "" },
    });
  });

  test.each(["dependency_missing", "download_failed"])(
    "keeps supported failure code %s",
    (errorCode) => {
      expect(
        parseDownloadEventPayload("failed", {
          id: "1",
          error: "failed",
          errorCode,
        }),
      ).toMatchObject({ data: { errorCode } });
    },
  );
});
