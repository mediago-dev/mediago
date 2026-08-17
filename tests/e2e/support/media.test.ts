import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { loadMediaFixture, verifyFixtureCopy } from "./media.ts";

interface Manifest {
  files: Array<{ path: string; size: number; sha256: string }>;
}

const fixtureRoot = fileURLToPath(
  new URL("../../media-service/public/v1/", import.meta.url),
);
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "mediago-media-copy-test-"));
  roots.push(root);
  return root;
}

async function rejectionMessage(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    throw new Error("Expected action to reject");
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("committed media fixture", () => {
  test("starts the server and returns exact manifest metadata", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(fixtureRoot, "manifest.json"), "utf8"),
    ) as Manifest;
    const expected = manifest.files.find((file) => file.path === "sample.mp4");
    if (!expected) throw new Error("Committed manifest has no sample.mp4");
    const fixture = await loadMediaFixture();

    try {
      expect(fixture.baseURL).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/v1$/);
      expect(fixture.sampleURL).toBe(`${fixture.baseURL}/sample.mp4`);
      expect(fixture.sample).toEqual({
        size: expected.size,
        sha256: expected.sha256,
      });
    } finally {
      await fixture.close();
    }
  });

  test("recursively accepts the unique exact copy without assuming an extension", async () => {
    const root = await temporaryRoot();
    const nested = path.join(root, "nested");
    const copy = path.join(nested, "download-output");
    await mkdir(nested);
    await copyFile(path.join(fixtureRoot, "sample.mp4"), copy);

    await expect(verifyFixtureCopy(root)).resolves.toBe(copy);
  });

  test("rejects modified and zero-byte files", async () => {
    const root = await temporaryRoot();
    const modified = await readFile(path.join(fixtureRoot, "sample.mp4"));
    modified[0] ^= 0xff;
    await writeFile(path.join(root, "modified.bin"), modified);
    await writeFile(path.join(root, "empty"), "");

    await expect(verifyFixtureCopy(root)).rejects.toThrow(
      /no exact.*fixture|0 matches/i,
    );
  });

  test("rejects multiple copies with a bounded directory summary", async () => {
    const root = await temporaryRoot();
    const samplePath = path.join(fixtureRoot, "sample.mp4");
    await Promise.all([
      copyFile(samplePath, path.join(root, "first")),
      copyFile(samplePath, path.join(root, "second.weird")),
      ...Array.from({ length: 120 }, (_, index) =>
        writeFile(
          path.join(root, `unrelated-${String(index).padStart(3, "0")}`),
          "x",
        ),
      ),
    ]);

    const message = await rejectionMessage(verifyFixtureCopy(root));
    expect(message).toMatch(/multiple|2 matches/i);
    expect(message.length).toBeLessThanOrEqual(4_096);
  });
});
