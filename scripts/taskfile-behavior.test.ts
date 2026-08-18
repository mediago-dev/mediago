import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
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
const taskExecutable = resolveExecutable("task");

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

test("setup version gate runs without pnpm, tsx, package metadata, or node_modules", () => {
  const rootTaskfile = parse(readFileSync(rootTaskfilePath, "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
  };
  const fixture = createFixture({
    version: "3",
    vars: { REQUIRED_TASK_VERSION: "3.51.1" },
    tasks: {
      setup: rootTaskfile.tasks.setup,
      "internal:require-task-version":
        rootTaskfile.tasks["internal:require-task-version"],
      "internal:setup": {
        internal: true,
        cmds: ["echo SETUP_LEAF_EXECUTED"],
      },
    },
  });
  const scriptsDirectory = path.join(fixture.directory, "scripts");
  mkdirSync(scriptsDirectory);
  copyFileSync(
    path.join(repositoryRoot, "scripts/task-version-gate.ts"),
    path.join(scriptsDirectory, "task-version-gate.ts"),
  );

  expect(existsSync(path.join(fixture.directory, "package.json"))).toBe(false);
  expect(existsSync(path.join(fixture.directory, "node_modules"))).toBe(false);

  const result = runTask(fixture.taskfilePath, "setup", {
    PATH: createNodeOnlyPath(),
  });

  expect(result.status).toBe(0);
  expect(result.output).toContain("SETUP_LEAF_EXECUTED");
  expect(result.output).not.toMatch(/\b(?:pnpm|tsx)\b/i);
});

test.each(["doctor", "version gate"] as const)(
  "%s reports the Node prerequisite before its helper when Node is absent",
  (target) => {
    const fixture = createNodePrerequisiteFixture(target);
    const result = runTask(fixture.taskfilePath, fixture.taskName, {
      PATH: createTemporaryDirectory(),
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(
      /Node 24\.14\.0 or newer.*mise use node@24\.14\.0/i,
    );
    expect(result.output).not.toMatch(/(?:exit status|code) 127/i);
    expect(result.output).not.toContain(fixture.helperName);
  },
);

test.each(["doctor", "version gate"] as const)(
  "%s reports the Node prerequisite before its helper when Node is too old",
  (target) => {
    const fixture = createNodePrerequisiteFixture(target);
    const fakeNode = createFailingNodePath();
    const result = runTask(fixture.taskfilePath, fixture.taskName, {
      PATH: fakeNode.path,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(
      /Node 24\.14\.0 or newer.*mise use node@24\.14\.0/i,
    );
    expect(result.output).not.toMatch(/(?:exit status|code) 127/i);
    expect(result.output).not.toContain(fixture.helperName);
    expect(readFileSync(fakeNode.log, "utf8")).not.toContain(
      fixture.helperName,
    );
  },
);

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

test("doctor continues every diagnostic when pnpm is unavailable", () => {
  const result = runTask(rootTaskfilePath, "doctor", {
    MEDIAGO_DEPS_ROOT: createTemporaryDirectory(),
    PATH: createNodeOnlyPath(),
  });

  expect(result.status).not.toBe(0);
  expect(result.output).toContain("Task 3.51.1");
  expect(result.output).toMatch(/Node .*ready/i);
  expect(result.output).toMatch(/pnpm version unavailable/i);
  expect(result.output).toMatch(/Go unavailable/i);
  expect(result.output).toMatch(/Docker unavailable/i);
  for (const toolName of RUNTIME_TOOLS) {
    expect(result.output).toContain(toolName);
  }
  expect(result.output).toMatch(/hint:.*task deps:runtime.*task doctor/i);
  expect(result.output).not.toMatch(/(?:exit status|code) 127/i);
  expect(result.output.match(/exit status [1-9]\d*/g)).toEqual([
    "exit status 1",
  ]);
});

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

function createNodePrerequisiteFixture(target: "doctor" | "version gate"): {
  directory: string;
  helperName: string;
  taskfilePath: string;
  taskName: string;
} {
  const rootTaskfile = parse(readFileSync(rootTaskfilePath, "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
    vars: Record<string, unknown>;
  };
  if (target === "doctor") {
    return {
      ...createFixture({
        version: "3",
        vars: rootTaskfile.vars,
        tasks: { doctor: rootTaskfile.tasks.doctor },
      }),
      helperName: "scripts/task-doctor.ts",
      taskName: "doctor",
    };
  }

  return {
    ...createFixture({
      version: "3",
      vars: rootTaskfile.vars,
      tasks: {
        entry: { cmds: [{ task: "internal:require-task-version" }] },
        "internal:require-task-version":
          rootTaskfile.tasks["internal:require-task-version"],
      },
    }),
    helperName: "scripts/task-version-gate.ts",
    taskName: "entry",
  };
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
    taskExecutable,
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

function createNodeOnlyPath(): string {
  const directory = createTemporaryDirectory();
  const executableName = process.platform === "win32" ? "node.exe" : "node";
  const destination = path.join(directory, executableName);
  try {
    symlinkSync(process.execPath, destination, "file");
  } catch {
    copyFileSync(process.execPath, destination);
  }
  return directory;
}

function createFailingNodePath(): { log: string; path: string } {
  const directory = createTemporaryDirectory();
  const log = path.join(directory, "node-invocations.log");
  const executableName = process.platform === "win32" ? "node.cmd" : "node";
  const executable = path.join(directory, executableName);
  const contents =
    process.platform === "win32"
      ? `@echo off\r\necho %*>>"${log}"\r\nexit /b 1\r\n`
      : `#!/bin/sh\nprintf '%s\\n' "$*" >> '${log}'\nexit 1\n`;
  writeFileSync(executable, contents, "utf8");
  if (process.platform !== "win32") chmodSync(executable, 0o755);
  return { log, path: directory };
}

function resolveExecutable(name: string): string {
  const extensions =
    process.platform === "win32"
      ? (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")
      : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${name}${extension}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  throw new Error(`Required executable not found on PATH: ${name}`);
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
