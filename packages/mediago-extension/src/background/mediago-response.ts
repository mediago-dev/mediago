function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function owns(record: object, property: PropertyKey): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(record, property);
  } catch {
    return false;
  }
}

function readOwn(
  record: Record<string, unknown>,
  property: string,
  invalidMessage: string,
): unknown {
  if (!owns(record, property)) throw new Error(invalidMessage);
  try {
    return record[property];
  } catch {
    throw new Error(invalidMessage);
  }
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
  if (!isPlainObject(response)) {
    throw new Error("Invalid download import response envelope");
  }
  const invalidEnvelope = "Invalid download import response envelope";
  const success = readOwn(response, "success", invalidEnvelope);
  const data = readOwn(response, "data", invalidEnvelope);
  if (success !== true || !Array.isArray(data)) {
    throw new Error(invalidEnvelope);
  }

  let dataLength: number;
  try {
    dataLength = data.length;
  } catch {
    throw new Error(invalidEnvelope);
  }
  if (dataLength !== requestedCount) {
    throw new Error(
      `Invalid download import response count: expected ${requestedCount}, received ${dataLength}`,
    );
  }

  const downloadIds: number[] = [];
  for (let index = 0; index < dataLength; index += 1) {
    if (!owns(data, index)) {
      throw new Error(
        `Invalid download import response item at index ${index}`,
      );
    }
    let item: unknown;
    try {
      item = data[index];
    } catch {
      throw new Error(
        `Invalid download import response item at index ${index}`,
      );
    }
    if (!isPlainObject(item)) {
      throw new Error(
        `Invalid download import response item at index ${index}`,
      );
    }
    const invalidID = `Invalid Download ID at index ${index}`;
    const id = readOwn(item, "id", invalidID);
    if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      throw new Error(invalidID);
    }
    downloadIds.push(id);
  }
  return downloadIds;
}
