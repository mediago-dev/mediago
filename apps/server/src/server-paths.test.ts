import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerPaths } from "./server-paths";

describe("resolveServerPaths", () => {
  it("keeps the existing home default", () => {
    expect(
      resolveServerPaths({ appName: "mediago", homeDir: "/home/test" }),
    ).toMatchObject({
      root: path.resolve("/home/test/.mediago-server"),
    });
  });

  it("places every persistent path under the explicit override", () => {
    expect(
      resolveServerPaths({
        appName: "mediago",
        homeDir: "/home/test",
        rootOverride: "/tmp/e2e-root",
      }),
    ).toEqual({
      root: path.resolve("/tmp/e2e-root"),
      data: path.resolve("/tmp/e2e-root/data"),
      logs: path.resolve("/tmp/e2e-root/logs"),
      downloads: path.resolve("/tmp/e2e-root/downloads"),
      database: path.resolve("/tmp/e2e-root/data/mediago.db"),
    });
  });

  it("preserves whitespace around a nonblank override", () => {
    const rootOverride = " /tmp/e2e-root ";

    expect(
      resolveServerPaths({
        appName: "mediago",
        homeDir: "/home/test",
        rootOverride,
      }),
    ).toMatchObject({
      root: path.resolve(rootOverride),
    });
  });

  it("treats a whitespace-only override as absent", () => {
    expect(
      resolveServerPaths({
        appName: "mediago",
        homeDir: "/home/test",
        rootOverride: "  \t ",
      }),
    ).toMatchObject({
      root: path.resolve("/home/test/.mediago-server"),
    });
  });
});
