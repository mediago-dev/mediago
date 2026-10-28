import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, test } from "vitest";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
const workflow = parse(read(".github/workflows/windows-test-signing.yml"));
const action = parse(read(".github/actions/signpath-test-file/action.yml"));

describe("test signing workflow safety", () => {
  test("never handles untrusted PR events or production publication", () => {
    expect(Object.keys(workflow.on).sort()).toEqual([
      "push",
      "workflow_dispatch",
    ]);
    expect(workflow.on.push.branches).toEqual(["codex/signpath-test-signing"]);
    expect(workflow.permissions).toEqual({ contents: "read" });
    const job = workflow.jobs["windows-test-signing"];
    expect(job["runs-on"]).toBe("windows-latest");
    expect(job.permissions).toEqual({ contents: "read", actions: "read" });
    expect(job.env.BUILD_VERSION).toContain("-test.");
    expect(read(".github/workflows/windows-test-signing.yml")).not.toMatch(
      /release-signing|gh release|gh workflow|git push/,
    );
  });
  test("signs every packaging checkpoint and always cleans up test trust", () => {
    const steps = workflow.jobs["windows-test-signing"].steps;
    expect(
      steps
        .filter(
          (step: { uses?: string }) =>
            step.uses === "./.github/actions/signpath-test-file",
        )
        .map((step: { with: { phase: string } }) => step.with.phase),
    ).toEqual(["app", "uninstaller", "installer", "portable"]);
    const cleanup = steps.find(
      (step: { name: string }) => step.name === "Remove test certificate trust",
    );
    expect(cleanup.if).toBe("always()");
    expect(cleanup.run).toContain("-Operation remove");
    expect(cleanup.env).toBeUndefined();
  });
  test("bounds both temporary certificate trust operations", () => {
    const steps = workflow.jobs["windows-test-signing"].steps;
    for (const name of [
      "Trust only the pinned test certificate on this disposable runner",
      "Remove test certificate trust",
    ]) {
      expect(
        steps.find((step: { name: string }) => step.name === name)[
          "timeout-minutes"
        ],
      ).toBe(2);
    }
  });
  test.runIf(process.platform === "win32")(
    "rejects unsafe trust contexts before opening any certificate store",
    () => {
      const executable = path.join(
        process.env.SystemRoot!,
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      );
      const environment = {
        ...process.env,
        GITHUB_ACTIONS: "true",
        RUNNER_ENVIRONMENT: "github-hosted",
        MEDIAGO_SIGNPATH_TEST: "1",
        GITHUB_REPOSITORY: "mediago-dev/mediago",
        RUNNER_OS: "Windows",
        BUILD_VERSION: "3.6.0-test.1",
        SIGNPATH_TEST_CERTIFICATE_BASE64: "",
      };
      for (const invalid of [
        { GITHUB_REPOSITORY: "fork/mediago" },
        { BUILD_VERSION: "3.6.0-beta.1" },
        { RUNNER_ENVIRONMENT: "self-hosted" },
      ]) {
        const result = spawnSync(
          executable,
          [
            "-NoProfile",
            "-NonInteractive",
            "-File",
            path.join(
              root,
              "packages/tooling/src/electron/windows-test-trust.ps1",
            ),
            "-Operation",
            "install",
          ],
          {
            env: { ...environment, ...invalid },
            encoding: "utf8",
            timeout: 10_000,
            windowsHide: true,
          },
        );
        expect(result.error).toBeUndefined();
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain("Test certificate trust is restricted");
      }
    },
  );
  test("uploads a single explicit executable and invokes a fixed official test policy", () => {
    const upload = action.runs.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("actions/upload-artifact@"),
    );
    expect(upload.with.path).toBe(
      ".task/signpath/${{ inputs.phase }}/unsigned/mediago.exe",
    );
    expect(upload.with["include-hidden-files"]).toBe(true);
    const submit = action.runs.steps.find((step: { uses?: string }) =>
      step.uses?.startsWith("signpath/"),
    );
    expect(submit.uses).toMatch(
      /^signpath\/github-action-submit-signing-request@[0-9a-f]{40}$/,
    );
    expect(submit.with["signing-policy-slug"]).toBe("test-signing");
    expect(submit.with["artifact-configuration-slug"]).toBe(
      "mediago-windows-test",
    );
  });
  test("artifact rules bind product name and version and cannot sweep third-party files", () => {
    const xml = read(".github/signpath/windows-test.xml");
    expect(xml).toContain("<zip-file>");
    expect(xml).toContain('name="version" required="true"');
    expect(xml).toContain(
      'path="mediago.exe" product-name="mediago" product-version="${version}"',
    );
    expect(xml).not.toMatch(/file-set|directory|\*/);
  });
});

test("official desktop packaging explicitly enables the production signature gate", () => {
  const desktop = parse(read(".github/workflows/build-electron.yml"));
  const release = desktop.jobs.build_release.steps.find(
    (step: { name: string }) => step.name === "Build desktop artifacts",
  );
  const preview = desktop.jobs.build_test.steps.find(
    (step: { name: string }) => step.name === "Build private desktop artifacts",
  );
  expect(release.env.RUN_MODE).toBe("release");
  expect(preview.env.RUN_MODE).toBe("test");
  const build = read("packages/tooling/src/electron/build.ts");
  expect(build.indexOf("verifyWindowsReleaseArtifacts({")).toBeGreaterThan(
    build.indexOf("const artifacts ="),
  );
  expect(build).toContain("runMode: process.env.RUN_MODE");
});
