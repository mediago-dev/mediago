import { describe, expect, test } from "vitest";
import { startTestPage } from "./test-page.ts";

const SAMPLE_URL = "http://127.0.0.1:45678/v1/sample.mp4?fixture=neutral";

describe("loopback test page", () => {
  test("serves a neutral page without media capture inputs", async () => {
    const page = await startTestPage(SAMPLE_URL);
    try {
      const expectedBlankURL = new URL("/blank", page.url).toString();
      expect(page.blankURL).toBe(expectedBlankURL);

      const response = await fetch(page.blankURL);
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(body).not.toContain(SAMPLE_URL);
      expect(body).not.toContain("<script");
      expect(body).not.toContain("fixtureMediaLoaded");
    } finally {
      await page.close();
    }
  });

  test("preserves the media capture page", async () => {
    const page = await startTestPage(SAMPLE_URL);
    try {
      const mediaResponse = await fetch(page.url);
      const mediaBody = await mediaResponse.text();
      expect(mediaResponse.status).toBe(200);
      expect(mediaBody).toContain(SAMPLE_URL);
      expect(mediaBody).toContain("fixtureMediaLoaded");
    } finally {
      await page.close();
    }
  });

  test("returns 404 for an unknown path", async () => {
    const page = await startTestPage(SAMPLE_URL);
    try {
      const response = await fetch(new URL("/missing", page.url));
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not Found\n");
    } finally {
      await page.close();
    }
  });

  test("returns 404 for a non-GET request", async () => {
    const page = await startTestPage(SAMPLE_URL);
    try {
      const response = await fetch(new URL("/blank", page.url), {
        method: "POST",
      });
      expect(response.status).toBe(404);
      await expect(response.text()).resolves.toBe("Not Found\n");
    } finally {
      await page.close();
    }
  });
});
