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
const productionEntries = [
  {
    leaf: "pnpm build:electron:raw",
    required: ["APP_NAME"],
    task: "build:electron",
  },
  {
    leaf: "pnpm -F @mediago/electron run pack",
    required: ["APP_NAME", "APP_ID", "APP_COPYRIGHT"],
    task: "pack:electron",
  },
  {
    leaf: "pnpm -F @mediago/electron run release",
    required: ["APP_NAME", "APP_ID", "APP_COPYRIGHT"],
    task: "release:electron",
  },
] as const;
const blankMetadataSources = [
  "empty process environment",
  "whitespace-only process environment",
  "empty profile dotenv",
  "higher-priority empty profile dotenv",
] as const;

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

test("shared E2E build selects the test profile inside its production-mode raw leaf", () => {
  const fixture = createE2eBuildProfileFixture();
  const result = runTask(
    fixture.taskfilePath,
    "probe",
    {
      PATH: `${fixture.binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    },
    ["--force"],
  );

  expect(result.status).toBe(0);
  expect(result.output).toContain("E2E_BUILD_PROFILE_CAPTURED");
  const artifact = JSON.parse(readFileSync(fixture.artifactPath, "utf8")) as {
    appId?: string;
    profile?: string;
  };
  expect(artifact).toEqual({
    appId: "TASK_E2E_TEST_LOCAL_VALUE",
    profile: "test",
  });
  expect(JSON.stringify(artifact)).not.toContain(
    "TASK_E2E_PRODUCTION_SECRET_SENTINEL",
  );
  expect(result.output).not.toContain("TASK_E2E_PRODUCTION_SECRET_SENTINEL");
});

test.each(productionEntries)(
  "$task loads production metadata from profile dotenv after the public version gate",
  ({ leaf, task }) => {
    const result = runTask(rootTaskfilePath, task, {}, ["--force", "--dry"]);

    expect(result.status).toBe(0);
    const gateIndex = result.output.indexOf(
      "node scripts/task-version-gate.ts",
    );
    const leafIndex = result.output.indexOf(leaf);
    expect(gateIndex).toBeGreaterThanOrEqual(0);
    expect(leafIndex).toBeGreaterThan(gateIndex);
  },
);

test.each(
  productionEntries.flatMap(({ leaf, required, task }) =>
    required.map((missing) => ({ leaf, missing, required, task })),
  ),
)(
  "$task reports only missing production metadata $missing without leaking configured values",
  ({ leaf, missing, required, task }) => {
    const configured = Object.fromEntries(
      required
        .filter((name) => name !== missing)
        .map((name, index) => [
          name,
          `TASK_PRODUCTION_METADATA_SECRET_${index}_SENTINEL`,
        ]),
    );
    const fixture = createRepositoryTaskfileFixture(configured);

    const result = runTask(fixture.taskfilePath, task, {}, [
      "--force",
      "--dry",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(missing);
    for (const presentName of required) {
      if (presentName !== missing) {
        expect(result.output).not.toContain(presentName);
      }
    }
    expect(result.output).not.toContain("TASK_PRODUCTION_METADATA_SECRET_");
    expect(result.output).not.toContain(leaf);
  },
);

test.each(
  productionEntries.flatMap(({ leaf, required, task }) =>
    required.flatMap((missing) =>
      blankMetadataSources.map((source) => ({
        leaf,
        missing,
        required,
        source,
        task,
      })),
    ),
  ),
)(
  "$task treats $source $missing as missing before runtime and implementation leaves",
  ({ leaf, missing, required, source, task }) => {
    const configured = Object.fromEntries(
      required.map((name, index) => [
        name,
        `TASK_BLANK_METADATA_SECRET_${index}_SENTINEL`,
      ]),
    );
    const overrides: NodeJS.ProcessEnv = {};
    let fixture: ReturnType<typeof createFixture>;

    if (source === "empty process environment") {
      overrides[missing] = "";
      fixture = createRepositoryTaskfileFixture(configured);
    } else if (source === "whitespace-only process environment") {
      overrides[missing] = "  \t ";
      fixture = createRepositoryTaskfileFixture(configured);
    } else if (source === "empty profile dotenv") {
      configured[missing] = "";
      fixture = createRepositoryTaskfileFixture(configured);
    } else {
      fixture = createRepositoryTaskfileFixture(configured, {
        ".env.production.local": { [missing]: "" },
      });
    }

    const result = runTask(fixture.taskfilePath, task, overrides, [
      "--force",
      "--dry",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(missing);
    for (const presentName of required) {
      if (presentName !== missing) {
        expect(result.output).not.toContain(presentName);
      }
    }
    expect(result.output).not.toContain("TASK_BLANK_METADATA_SECRET_");
    expect(result.output).toContain("pnpm install --frozen-lockfile");
    for (const sideEffect of [
      "pnpm core:build",
      "pnpm deps:download:raw",
      "pnpm build:electron:raw",
      leaf,
    ]) {
      expect(result.output).not.toContain(sideEffect);
    }
  },
);

test.each(productionEntries)(
  "$task bootstraps node dependencies before validating production metadata in a clean clone",
  ({ leaf, required, task }) => {
    const missing = required[0];
    const configured = Object.fromEntries(
      required
        .filter((name) => name !== missing)
        .map((name, index) => [
          name,
          `TASK_CLEAN_CLONE_SECRET_${index}_SENTINEL`,
        ]),
    );
    const fixture = createCleanCloneProductionFixture(configured);

    expect(existsSync(path.join(fixture.directory, "node_modules"))).toBe(
      false,
    );

    const result = runTask(
      fixture.taskfilePath,
      task,
      {
        PATH: `${fixture.binDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
      },
      ["--force"],
    );

    expect(result.status).not.toBe(0);
    expect(readFileSync(fixture.pnpmLog, "utf8").trim()).toBe(
      "install --frozen-lockfile",
    );
    expect(result.output).toContain(missing);
    expect(result.output).not.toContain("ERR_MODULE_NOT_FOUND");
    expect(result.output).not.toContain("TASK_CLEAN_CLONE_SECRET_");
    for (const forbiddenLeaf of [
      "pnpm core:build",
      "pnpm deps:download:raw",
      "pnpm build:electron:raw",
      leaf,
    ]) {
      expect(result.output).not.toContain(forbiddenLeaf);
    }
  },
);

test.each(productionEntries)(
  "$task rejects an invalid profile without exposing profile or metadata values",
  ({ leaf, task }) => {
    const result = runTask(
      rootTaskfilePath,
      task,
      {
        APP_COPYRIGHT: "TASK_METADATA_COPYRIGHT_SECRET_SENTINEL",
        APP_ID: "TASK_METADATA_ID_SECRET_SENTINEL",
        APP_NAME: "TASK_METADATA_NAME_SECRET_SENTINEL",
        MEDIAGO_PROFILE: "TASK_PROFILE_SECRET_SENTINEL",
      },
      ["--force", "--dry"],
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toContain(
      "Production metadata validation could not load the selected profile. Set MEDIAGO_PROFILE to development, test, or production and check the matching dotenv files.",
    );
    expect(result.output).not.toContain("TASK_PROFILE_SECRET_SENTINEL");
    expect(result.output).not.toContain("TASK_METADATA_");
    expect(result.output).not.toMatch(
      /(?:Error: Unsupported|at loadProfileEnv|at file:|load-profile-env\.ts|node:internal)/,
    );
    expect(result.output).toContain("pnpm install --frozen-lockfile");
    for (const forbiddenLeaf of [
      "pnpm core:build",
      "pnpm deps:download:raw",
      "pnpm build:electron:raw",
      leaf,
    ]) {
      expect(result.output).not.toContain(forbiddenLeaf);
    }
  },
);

test.each(productionEntries)(
  "$task accepts nonblank production metadata with surrounding whitespace without logging it",
  ({ leaf, required, task }) => {
    const environment = Object.fromEntries(
      required.map((name, index) => [
        name,
        `  TASK_NONBLANK_METADATA_SECRET_${index}_SENTINEL  `,
      ]),
    );
    const fixture = createRepositoryTaskfileFixture({});

    const result = runTask(fixture.taskfilePath, task, environment, [
      "--force",
      "--dry",
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain(leaf);
    expect(result.output).not.toContain("TASK_NONBLANK_METADATA_SECRET_");
  },
);

test.each(productionEntries)(
  "$task version mismatch stops before production metadata and implementation leaves",
  ({ leaf, task }) => {
    const result = runTask(
      rootTaskfilePath,
      task,
      {
        APP_COPYRIGHT: "TASK_VERSION_SECRET_COPYRIGHT_SENTINEL",
        APP_ID: "TASK_VERSION_SECRET_ID_SENTINEL",
        APP_NAME: "TASK_VERSION_SECRET_NAME_SENTINEL",
      },
      ["REQUIRED_TASK_VERSION=0.0.0"],
    );

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(/version gate is misconfigured/i);
    expect(result.output).not.toContain("pnpm install --frozen-lockfile");
    expect(result.output).not.toContain(leaf);
    expect(result.output).not.toContain("TASK_VERSION_SECRET_");
  },
);

test.each([
  ["dev:electron", "pnpm start:electron"],
  ["dev:all", "pnpm dev:all:raw"],
] as const)(
  "%s reaches its development leaf without production metadata",
  (task, leaf) => {
    const fixture = createRepositoryTaskfileFixture({});
    const result = runTask(fixture.taskfilePath, task, {}, [
      "--force",
      "--dry",
    ]);

    expect(result.status).toBe(0);
    expect(result.output).toContain(leaf);
    expect(result.output).not.toMatch(/APP_(?:NAME|ID|COPYRIGHT)/);
  },
);

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

const nodePrerequisiteCases = [
  {
    expected: /Node 24\.14\.0 or newer.*mise use node@24\.14\.0/i,
    target: "doctor",
  },
  {
    expected: /Node 22\.18\.0 or newer.*validate the pinned Task version/i,
    target: "version gate",
  },
  {
    expected: /Node 24\.14\.0 or newer.*workspace dependencies/i,
    target: "node dependencies",
  },
] as const;

test.each(nodePrerequisiteCases)(
  "$target reports the Node prerequisite before its helper when Node is absent",
  ({ expected, target }) => {
    const fixture = createNodePrerequisiteFixture(target);
    const result = runTask(fixture.taskfilePath, fixture.taskName, {
      PATH: createTemporaryDirectory(),
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(expected);
    expect(result.output).not.toMatch(/(?:exit status|code) 127/i);
    expect(result.output).not.toContain(fixture.helperName);
  },
);

test.each(nodePrerequisiteCases)(
  "$target reports the Node prerequisite before its helper when Node is too old",
  ({ expected, target }) => {
    const fixture = createNodePrerequisiteFixture(target);
    const fakeNode = createFailingNodePath();
    const result = runTask(fixture.taskfilePath, fixture.taskName, {
      PATH: fakeNode.path,
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toMatch(expected);
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
  const { deps: _graphDependencies, ...isolatedProfile } = realProfile;
  const fixture = createFixture({
    version: "3",
    tasks: {
      profile: {
        ...isolatedProfile,
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

function createRepositoryTaskfileFixture(
  environment: Record<string, string>,
  additionalDotenvFiles: Record<string, Record<string, string>> = {},
): ReturnType<typeof createFixture> {
  const directory = createTemporaryDirectory();
  const taskfilePath = path.join(directory, "Taskfile.yml");
  copyFileSync(rootTaskfilePath, taskfilePath);
  symlinkSync(
    path.join(repositoryRoot, "scripts"),
    path.join(directory, "scripts"),
  );
  for (const [filename, values] of Object.entries({
    ".env": environment,
    ...additionalDotenvFiles,
  })) {
    writeFileSync(
      path.join(directory, filename),
      `${Object.entries(values)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n")}\n`,
    );
  }
  return { directory, taskfilePath };
}

function createE2eBuildProfileFixture(): ReturnType<typeof createFixture> & {
  artifactPath: string;
  binDirectory: string;
} {
  const rootTaskfile = parse(readFileSync(rootTaskfilePath, "utf8")) as {
    tasks: Record<string, Record<string, unknown>>;
  };
  const fixture = createFixture({
    version: "3",
    tasks: {
      probe: {
        deps: [{ task: "internal:test:e2e:build" }],
      },
      "internal:deps:node": {
        internal: true,
      },
      "internal:test:e2e:build": rootTaskfile.tasks["internal:test:e2e:build"],
    },
  });
  writeFileSync(
    path.join(fixture.directory, ".env.production"),
    "APP_TD_APPID=TASK_E2E_PRODUCTION_SECRET_SENTINEL\n",
  );
  writeFileSync(
    path.join(fixture.directory, ".env.test"),
    "APP_TD_APPID=TASK_E2E_TEST_VALUE\n",
  );
  writeFileSync(
    path.join(fixture.directory, ".env.test.local"),
    "APP_TD_APPID=TASK_E2E_TEST_LOCAL_VALUE\n",
  );

  const artifactPath = path.join(fixture.directory, "e2e-build-profile.json");
  const binDirectory = path.join(fixture.directory, "bin");
  const fakePnpmScript = path.join(binDirectory, "fake-pnpm.cjs");
  mkdirSync(binDirectory);
  writeFileSync(
    fakePnpmScript,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      `const artifactPath = ${JSON.stringify(artifactPath)};`,
      `const fixtureRoot = ${JSON.stringify(fixture.directory)};`,
      `const loaderUrl = ${JSON.stringify(new URL("./load-profile-env.ts", import.meta.url).href)};`,
      "(async () => {",
      '  if (process.argv.slice(2).join(" ") !== "test:e2e:build:raw") process.exit(91);',
      '  process.env.NODE_ENV = "production";',
      "  const { loadProfileEnv } = await import(loaderUrl);",
      "  loadProfileEnv(fixtureRoot);",
      "  fs.writeFileSync(artifactPath, JSON.stringify({ appId: process.env.APP_TD_APPID, profile: process.env.MEDIAGO_PROFILE }));",
      '  process.stdout.write("E2E_BUILD_PROFILE_CAPTURED\\n");',
      "})().catch((error) => {",
      "  process.stderr.write(`${String(error)}\\n`);",
      "  process.exitCode = 1;",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakePnpmScript, 0o755);
  if (process.platform === "win32") {
    writeFileSync(
      path.join(binDirectory, "pnpm.cmd"),
      `@echo off\r\n"${process.execPath}" "${fakePnpmScript}" %*\r\n`,
      "utf8",
    );
  } else {
    symlinkSync(fakePnpmScript, path.join(binDirectory, "pnpm"), "file");
  }

  return { artifactPath, binDirectory, ...fixture };
}

function createCleanCloneProductionFixture(
  environment: Record<string, string>,
): ReturnType<typeof createFixture> & {
  binDirectory: string;
  pnpmLog: string;
} {
  const directory = createTemporaryDirectory();
  const taskfilePath = path.join(directory, "Taskfile.yml");
  copyFileSync(rootTaskfilePath, taskfilePath);
  for (const filename of [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ]) {
    copyFileSync(
      path.join(repositoryRoot, filename),
      path.join(directory, filename),
    );
  }

  const scriptsDirectory = path.join(directory, "scripts");
  mkdirSync(scriptsDirectory);
  for (const filename of [
    "load-profile-env.ts",
    "task-production-metadata.ts",
    "task-version-gate.ts",
  ]) {
    copyFileSync(
      path.join(repositoryRoot, "scripts", filename),
      path.join(scriptsDirectory, filename),
    );
  }
  writeFileSync(
    path.join(directory, ".env"),
    `${Object.entries(environment)
      .map(([name, value]) => `${name}=${value}`)
      .join("\n")}\n`,
  );

  const binDirectory = path.join(directory, "bin");
  const pnpmLog = path.join(directory, "pnpm-invocations.log");
  const fakePnpmScript = path.join(binDirectory, "fake-pnpm.cjs");
  mkdirSync(binDirectory);
  writeFileSync(
    fakePnpmScript,
    [
      `#!${process.execPath}`,
      'const fs = require("node:fs");',
      'const path = require("node:path");',
      `const invocationLog = ${JSON.stringify(pnpmLog)};`,
      `const installedModules = ${JSON.stringify(path.join(repositoryRoot, "node_modules"))};`,
      `const fixtureRoot = ${JSON.stringify(directory)};`,
      'fs.appendFileSync(invocationLog, `${process.argv.slice(2).join(" ")}\\n`);',
      'if (process.argv.slice(2).join(" ") !== "install --frozen-lockfile") process.exit(91);',
      'fs.symlinkSync(installedModules, path.join(fixtureRoot, "node_modules"), "dir");',
      "",
    ].join("\n"),
    "utf8",
  );
  chmodSync(fakePnpmScript, 0o755);

  if (process.platform === "win32") {
    writeFileSync(
      path.join(binDirectory, "pnpm.cmd"),
      `@echo off\r\n"${process.execPath}" "${fakePnpmScript}" %*\r\n`,
      "utf8",
    );
  } else {
    symlinkSync(fakePnpmScript, path.join(binDirectory, "pnpm"), "file");
  }

  return { binDirectory, directory, pnpmLog, taskfilePath };
}

function createNodePrerequisiteFixture(
  target: "doctor" | "node dependencies" | "version gate",
): {
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

  if (target === "node dependencies") {
    return {
      ...createFixture({
        version: "3",
        vars: rootTaskfile.vars,
        tasks: {
          entry: { cmds: [{ task: "internal:deps:node" }] },
          "internal:deps:node": rootTaskfile.tasks["internal:deps:node"],
        },
      }),
      helperName: "pnpm install --frozen-lockfile",
      taskName: "entry",
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
  taskArguments: string[] = [],
): { output: string; status: number | null } {
  const result = spawnSync(
    taskExecutable,
    ["--color=false", "--taskfile", taskfilePath, ...taskArguments, taskName],
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
