import { constants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, test } from "vitest";
import { createFakeBilibiliDependencyLeaf } from "./fake-dependencies.ts";

const execFileAsync = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe.skipIf(process.platform !== "linux" || process.arch !== "x64")(
  "createFakeBilibiliDependencyLeaf",
  () => {
    test("creates executable aria2c and deterministic fake BBDown files", async () => {
      const { provisionedAria2Path, root } = await createIsolatedFixture();

      const leaf = await createFakeBilibiliDependencyLeaf(root, {
        provisionedAria2Path,
      });

      expect(leaf.depsDirectory).toBe(path.join(path.resolve(root), "deps"));
      expect(
        (await stat(path.join(leaf.depsDirectory, "aria2c"))).isFile(),
      ).toBe(true);
      expect(await readFile(path.join(leaf.depsDirectory, "aria2c"))).toEqual(
        await readFile(provisionedAria2Path),
      );
      await access(path.join(leaf.depsDirectory, "aria2c"), constants.X_OK);
      await access(path.join(leaf.depsDirectory, "BBDown"), constants.X_OK);
      expect(leaf.bbdownArgumentsPath).toBe(
        path.join(path.resolve(root), "bbdown-argv.jsonl"),
      );
    });

    test("records each invocation as JSON without shell interpolation", async () => {
      const { provisionedAria2Path, root } = await createIsolatedFixture();
      const leaf = await createFakeBilibiliDependencyLeaf(root, {
        provisionedAria2Path,
      });
      const executable = path.join(leaf.depsDirectory, "BBDown");
      const first = [
        "https://www.bilibili.com/video/BV1MediaGoFixture",
        "--cookie",
        "SESSDATA=space and 'quotes'; $(ignored)",
      ];
      const second = ["--work-dir", path.join(root, "download output")];

      await execFileAsync(executable, first);
      await execFileAsync(executable, second);

      const records = (await readFile(leaf.bbdownArgumentsPath, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as unknown);
      expect(records).toEqual([first, second]);
    });
  },
);

async function createIsolatedFixture(): Promise<{
  provisionedAria2Path: string;
  root: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "mediago fake dependencies "));
  roots.push(root);
  const provisionedAria2Path = path.join(root, "provisioned", "aria2c");
  await mkdir(path.dirname(provisionedAria2Path), { recursive: true });
  await writeFile(provisionedAria2Path, "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  });
  return { provisionedAria2Path, root };
}
