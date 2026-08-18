function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function owns(record: Record<string, unknown>, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, property);
}

/**
 * Validate the successful wire response returned by POST /api/downloads.
 *
 * Only numeric database IDs from the Core response are returned. Source IDs
 * and URLs are deliberately outside this contract and can never be used as a
 * substitute when the response is malformed.
 */
export function validateDownloadImportResponse(
  response: unknown,
  requestedCount: number,
): number[] {
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 0) {
    throw new Error("Requested count must be a non-negative safe integer");
  }
  if (
    !isPlainObject(response) ||
    !owns(response, "success") ||
    response.success !== true ||
    !owns(response, "data") ||
    !Array.isArray(response.data)
  ) {
    throw new Error("Invalid download import response envelope");
  }
  if (response.data.length !== requestedCount) {
    throw new Error(
      `Invalid download import response count: expected ${requestedCount}, received ${response.data.length}`,
    );
  }

  return response.data.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new Error(
        `Invalid download import response item at index ${index}`,
      );
    }
    if (
      !owns(item, "id") ||
      typeof item.id !== "number" ||
      !Number.isSafeInteger(item.id) ||
      item.id <= 0
    ) {
      throw new Error(`Invalid Download ID at index ${index}`);
    }
    return item.id;
  });
}
