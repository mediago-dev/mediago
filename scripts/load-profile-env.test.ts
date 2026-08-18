import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadProfileEnv } from "./load-profile-env.ts";

describe("loadProfileEnv", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let projectRoot: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "mediago-env-"));
  });

  afterEach(async () => {
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, originalEnv);
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  async function writeEnvFile(
    filename: string,
    values: Record<string, string>,
  ): Promise<void> {
    const contents = Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");
    await fs.writeFile(path.join(projectRoot, filename), `${contents}\n`);
  }

  it("preserves process variables over the complete production file cascade", async () => {
    await writeEnvFile(".env", {
      CHAIN: "base",
      BASE_ONLY: "base",
      BASE_TO_PROFILE: "base",
      BASE_TO_LOCAL: "base",
      BASE_TO_PROFILE_LOCAL: "base",
      CI_PRESET: "base",
    });
    await writeEnvFile(".env.production", {
      CHAIN: "profile",
      PROFILE_ONLY: "profile",
      BASE_TO_PROFILE: "profile",
      BASE_TO_LOCAL: "profile",
      BASE_TO_PROFILE_LOCAL: "profile",
      CI_PRESET: "profile",
    });
    await writeEnvFile(".env.local", {
      CHAIN: "local",
      LOCAL_ONLY: "local",
      BASE_TO_LOCAL: "local",
      BASE_TO_PROFILE_LOCAL: "local",
      CI_PRESET: "local",
    });
    await writeEnvFile(".env.production.local", {
      CHAIN: "profile-local",
      PROFILE_LOCAL_ONLY: "profile-local",
      BASE_TO_PROFILE_LOCAL: "profile-local",
      CI_PRESET: "profile-local",
    });
    process.env.MEDIAGO_PROFILE = "production";
    process.env.CI_PRESET = "ci";

    expect(loadProfileEnv(projectRoot)).toBe("production");

    expect(process.env).toMatchObject({
      CHAIN: "profile-local",
      BASE_ONLY: "base",
      PROFILE_ONLY: "profile",
      LOCAL_ONLY: "local",
      PROFILE_LOCAL_ONLY: "profile-local",
      BASE_TO_PROFILE: "profile",
      BASE_TO_LOCAL: "local",
      BASE_TO_PROFILE_LOCAL: "profile-local",
      CI_PRESET: "ci",
    });
  });

  it("defaults to the development profile", async () => {
    await writeEnvFile(".env.development", { DEFAULT_PROFILE: "development" });

    expect(loadProfileEnv(projectRoot)).toBe("development");
    expect(process.env.DEFAULT_PROFILE).toBe("development");
  });

  it("lets MEDIAGO_PROFILE override NODE_ENV", async () => {
    await writeEnvFile(".env.test", { SELECTED_PROFILE: "test" });
    await writeEnvFile(".env.production", {
      SELECTED_PROFILE: "production",
    });
    process.env.NODE_ENV = "test";
    process.env.MEDIAGO_PROFILE = "production";

    expect(loadProfileEnv(projectRoot)).toBe("production");
    expect(process.env.SELECTED_PROFILE).toBe("production");
  });

  it.each(["development", "test", "production"] as const)(
    "accepts the %s profile",
    async (profile) => {
      await writeEnvFile(`.env.${profile}`, { ALLOWED_PROFILE: profile });
      process.env.MEDIAGO_PROFILE = profile;

      expect(loadProfileEnv(projectRoot)).toBe(profile);
      expect(process.env.ALLOWED_PROFILE).toBe(profile);
    },
  );

  it("rejects unsupported profiles before loading files", async () => {
    await writeEnvFile(".env", { MUST_NOT_LOAD: "loaded" });
    process.env.MEDIAGO_PROFILE = "staging";

    expect(() => loadProfileEnv(projectRoot)).toThrow(
      'Unsupported MediaGo profile "staging"',
    );
    expect(process.env.MUST_NOT_LOAD).toBeUndefined();
  });

  it("propagates dotenv-flow loading errors", async () => {
    await fs.mkdir(path.join(projectRoot, ".env"));

    expect(() => loadProfileEnv(projectRoot)).toThrow();
  });
});
