import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse, stringify } from "yaml";
import { expect, onTestFinished, test } from "vitest";
import { RUNTIME_TOOLS } from "./dependency-layout.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const rootTaskfilePath = path.join(repositoryRoot, "Taskfile.yml");

test.each(["development", "test", "production"])(
  "native Task profile validation accepts %s",
  (profile) => {
    const fixture = createProfileFixture();
    const result = runTask(fixture.taskfilePath, "profile", {
      MEDIAGO_PROFILE: profile,
      TASK_FIXTURE_WINNER: "process",
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain("PROFILE_LEAF_EXECUTED");
    expect(result.output).not.toContain("TASK_DOTENV_SECRET_SENTINEL");
  },
);

test("native Task profile validation rejects unsupported and metacharacter values before the leaf", () => {
  const fixture = createProfileFixture();
  const markerName = "TASK_PROFILE_INJECTION_SHOULD_NOT_EXIST";
  const markerPath = path.join(fixture.directory, markerName);
  const values = ["staging", `\`touch\${IFS}${markerName}\``];

  for (const profile of values) {
    const result = runTask(fixture.taskfilePath, "profile", {
      MEDIAGO_PROFILE: profile,
    });
    expect(result.status).not.toBe(0);
    expect(result.output).not.toContain("PROFILE_LEAF_EXECUTED");
  }
  expect(existsSync(markerPath)).toBe(false);
});

test("typed Task version mismatch blocks its implementation leaf", () => {
  const rootTaskfile = parse(readFileSync(rootTaskfilePath, "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
  };
  const realGate = rootTaskfile.tasks["internal:require-task-version"];
  expect(realGate).toBeDefined();
  const fixture = createFixture({
    version: "3",
    vars: { REQUIRED_TASK_VERSION: "3.51.1" },
    tasks: {
      entry: {
        cmds: [
          { task: "internal:require-task-version" },
          { task: "internal:leaf" },
        ],
      },
      "internal:require-task-version": {
        ...realGate,
        dir: repositoryRoot,
        env: {
          MEDIAGO_REQUIRED_TASK_VERSION: "3.51.1",
          MEDIAGO_TASK_VERSION: "3.50.0",
        },
      },
      "internal:leaf": {
        internal: true,
        cmds: ["echo VERSION_LEAF_EXECUTED"],
      },
    },
  });

  const result = runTask(fixture.taskfilePath, "entry");

  expect(result.status).not.toBe(0);
  expect(result.output).not.toContain("VERSION_LEAF_EXECUTED");
  expect(result.output).toMatch(/requires 3\.51\.1/i);
  expect(result.output).toMatch(/taskfile\.dev\/installation|mise use/i);
});

const doctorInjectionTest = process.platform === "win32" ? test.skip : test;

doctorInjectionTest(
  "doctor treats a metacharacter dependency root only as a path and aggregates safely",
  () => {
    const markerName = "TASK_DOCTOR_INJECTION_SHOULD_NOT_EXIST";
    const markerPath = path.join(repositoryRoot, markerName);
    rmSync(markerPath, { force: true });
    onTestFinished(() => rmSync(markerPath, { force: true }));
    const directory = createTemporaryDirectory();
    const depsRoot = path.join(
      directory,
      `deps-'"$\`touch\${IFS}${markerName}\``,
    );
    const result = runTask(rootTaskfilePath, "doctor", {
      MEDIAGO_DEPS_ROOT: depsRoot,
      TASK_DOCTOR_SECRET: "TASK_DOCTOR_SECRET_SENTINEL",
    });

    expect(existsSync(markerPath)).toBe(false);
    expect(result.status).not.toBe(0);
    expect(result.output).toContain("Task 3.51.1");
    expect(result.output).toMatch(/Node .*ready/i);
    expect(result.output).toMatch(/pnpm .*ready/i);
    expect(result.output).toMatch(/Go /i);
    expect(result.output).toMatch(/Docker /i);
    for (const toolName of RUNTIME_TOOLS) {
      expect(result.output).toContain(toolName);
    }
    expect(result.output).not.toContain("TASK_DOCTOR_SECRET_SENTINEL");
  },
);

function createProfileFixture(): ReturnType<typeof createFixture> {
  const rootTaskfile = parse(readFileSync(rootTaskfilePath, "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
  };
  const realProfile = rootTaskfile.tasks["internal:test:ts"];
  expect(realProfile).toBeDefined();
  const fixture = createFixture({
    version: "3",
    tasks: {
      profile: {
        ...realProfile,
        internal: false,
        cmds: [
          `node -e "process.exit(process.env.TASK_FIXTURE_WINNER === 'process' ? 0 : 17)"`,
          "echo PROFILE_LEAF_EXECUTED",
        ],
      },
    },
  });
  writeFileSync(
    path.join(fixture.directory, ".env.test"),
    [
      "TASK_FIXTURE_SECRET=TASK_DOTENV_SECRET_SENTINEL",
      "TASK_FIXTURE_WINNER=dotenv",
      "",
    ].join("\n"),
  );
  return fixture;
}

function createFixture(taskfile: unknown): {
  directory: string;
  taskfilePath: string;
} {
  const directory = createTemporaryDirectory();
  const taskfilePath = path.join(directory, "Taskfile.yml");
  writeFileSync(taskfilePath, stringify(taskfile), "utf8");
  return { directory, taskfilePath };
}

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "mediago-task-contract-"));
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function runTask(
  taskfilePath: string,
  taskName: string,
  overrides: NodeJS.ProcessEnv = {},
): { output: string; status: number | null } {
  const result = spawnSync(
    "task",
    ["--color=false", "--taskfile", taskfilePath, taskName],
    {
      cwd: path.dirname(taskfilePath),
      encoding: "utf8",
      env: sanitizedEnvironment(overrides),
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

function sanitizedEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    CI: "1",
    NO_COLOR: "1",
  };
  for (const name of [
    "COMSPEC",
    "HOME",
    "LOCALAPPDATA",
    "PATH",
    "PATHEXT",
    "PNPM_HOME",
    "SYSTEMROOT",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USERPROFILE",
    "XDG_CACHE_HOME",
    "XDG_CONFIG_HOME",
  ]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}
