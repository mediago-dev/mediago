import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { startCoreProcess } from "./core-process.ts";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("startCoreProcess dependency leaf", () => {
  test("reports an explicit missing aria2c before spawning Core", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "mediago-core-deps-test-"));
    roots.push(root);
    const depsDirectory = path.join(root, "missing dependencies");

    await expect(
      startCoreProcess({
        runtimeRoot: root,
        port: 39_718,
        depsDirectory,
      }),
    ).rejects.toThrow(
      `E2E aria2c is missing or not executable: ${path.join(depsDirectory, "aria2c")}`,
    );
  });
});
