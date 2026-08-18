import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  asRecord,
  createTaskFixture,
  runTaskFixture as runFixtureTask,
  stringArray,
  taskCommands as parseTaskCommands,
  taskDependencies as parseTaskDependencies,
  type TaskCommand,
  type TaskFixture,
} from "./taskfile-test-helpers.ts";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const taskfileSource = fs.readFileSync(
  path.join(repositoryRoot, "Taskfile.yml"),
  "utf8",
);
const taskfile = asRecord(parse(taskfileSource), "Taskfile.yml");
const tasks = asRecord(taskfile.tasks, "Taskfile.yml tasks");
const packageJson = JSON.parse(
  fs.readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
) as {
  devDependencies: Record<string, string>;
  scripts: Record<string, string>;
};

const publicTasks = [
  "doctor",
  "setup",
  "deps:node",
  "deps:runtime",
  "deps:media-integration",
  "deps:e2e",
  "dev:all",
  "dev:web",
  "dev:server",
  "dev:electron",
  "dev:extension",
  "docs:dev",
  "check",
  "test",
  "test:ts",
  "test:go",
  "test:integration",
  "test:e2e",
  "test:e2e:web",
  "test:e2e:electron",
  "test:e2e:extension",
  "build:web",
  "build:server",
  "build:electron",
  "build:extension",
  "build:docs",
  "build:docker",
  "pack:extension",
  "pack:electron",
  "release:electron",
  "ci:quality",
  "ci:test:ts",
  "ci:test:go",
  "ci:test:media",
  "ci:test:e2e",
  "ci:docs:build",
] as const;

const profileImplementations = {
  "internal:setup": "development",
  "internal:deps:media-integration": "test",
  "internal:deps:e2e": "test",
  "internal:dev:all": "development",
  "internal:dev:web": "development",
  "internal:dev:electron": "development",
  "internal:dev:extension": "development",
  "internal:docs:dev": "development",
  "internal:check": "test",
  "internal:test": "test",
  "internal:test:ts": "test",
  "internal:test:go": "test",
  "internal:test:integration": "test",
  "internal:test:e2e": "test",
  "internal:test:e2e:web": "test",
  "internal:test:e2e:electron": "test",
  "internal:test:e2e:extension": "test",
  "internal:test:e2e:build": "test",
  "internal:build:web": "production",
  "internal:build:server": "production",
  "internal:build:electron": "production",
  "internal:production:build:electron:validated": "production",
  "internal:build:extension": "production",
  "internal:build:docs": "production",
  "internal:build:docker": "production",
  "internal:pack:extension": "production",
  "internal:pack:electron": "production",
  "internal:production:pack:electron:validated": "production",
  "internal:release:electron": "production",
  "internal:production:release:electron:validated": "production",
  "internal:ci:test:e2e": "test",
} as const;

const implementationGraph = {
  "internal:setup": {
    deps: ["internal:deps:node", "internal:deps:runtime"],
    leaves: [],
  },
  "internal:deps:node": {
    deps: [],
    leaves: ["pnpm install --frozen-lockfile"],
  },
  "internal:deps:runtime": {
    deps: ["internal:deps:node"],
    leaves: [
      "pnpm deps:download:raw --tools ffmpeg,N_m3u8DL-RE,BBDown,aria2,yt-dlp,mediago",
    ],
  },
  "internal:deps:media-integration": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm deps:download:raw --tools aria2,N_m3u8DL-RE,ffmpeg,BBDown"],
  },
  "internal:deps:e2e": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm deps:download:raw --tools aria2"],
  },
  "internal:dev:all": {
    deps: [
      "internal:deps:node",
      "internal:deps:runtime",
      "internal:core:build",
      "internal:build:electron",
    ],
    leaves: ["pnpm dev:all:raw"],
  },
  "internal:dev:web": {
    deps: [
      "internal:deps:node",
      "internal:deps:runtime",
      "internal:core:build",
    ],
    leaves: ["pnpm dev:web:raw"],
  },
  "internal:dev:electron": {
    deps: [
      "internal:deps:node",
      "internal:deps:runtime",
      "internal:core:build",
      "internal:build:electron",
    ],
    leaves: ["pnpm start:electron"],
  },
  "internal:dev:extension": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm -F @mediago/extension run dev"],
  },
  "internal:docs:dev": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm -F @mediago/docs run docs:dev"],
  },
  "internal:check": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm lint", "pnpm format:check", "pnpm type:check"],
  },
  "internal:test": {
    deps: ["internal:deps:node", "internal:test:ts", "internal:test:go"],
    leaves: [],
  },
  "internal:test:ts": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm exec vitest run"],
  },
  "internal:test:go": { deps: [], leaves: ["go test ./..."] },
  "internal:test:integration": {
    deps: ["internal:deps:media-integration"],
    leaves: ["pnpm test:integration:media:run:raw"],
  },
  "internal:test:e2e": {
    deps: [
      "internal:deps:e2e",
      "internal:core:build",
      "internal:test:e2e:build",
      "internal:test:e2e:chromium",
    ],
    leaves: ["pnpm test:e2e:raw"],
  },
  "internal:test:e2e:web": {
    deps: [
      "internal:deps:e2e",
      "internal:core:build",
      "internal:test:e2e:build",
      "internal:test:e2e:chromium",
    ],
    leaves: ["pnpm test:e2e:web:raw"],
  },
  "internal:test:e2e:electron": {
    deps: [
      "internal:deps:e2e",
      "internal:core:build",
      "internal:test:e2e:build",
      "internal:test:e2e:chromium",
    ],
    leaves: ["pnpm test:e2e:electron:raw"],
  },
  "internal:test:e2e:extension": {
    deps: [
      "internal:deps:e2e",
      "internal:core:build",
      "internal:test:e2e:build",
      "internal:test:e2e:chromium",
    ],
    leaves: ["pnpm test:e2e:extension:raw"],
  },
  "internal:build:web": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm build:web:raw"],
  },
  "internal:build:server": {
    deps: ["internal:deps:node", "internal:core:build"],
    leaves: ["pnpm build:server:raw"],
  },
  "internal:build:electron": {
    deps: ["internal:deps:node", "internal:core:build"],
    leaves: ["pnpm build:electron:raw"],
  },
  "internal:build:extension": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm -F @mediago/extension run build"],
  },
  "internal:build:docs": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm -F @mediago/docs run docs:build"],
  },
  "internal:build:docker": {
    deps: ["internal:docker:daemon"],
    leaves: ["docker build -t mediago:local ."],
  },
  "internal:pack:extension": {
    deps: ["internal:build:extension"],
    leaves: ["pnpm exec tsx scripts/pack-extension.ts"],
  },
  "internal:pack:electron": {
    deps: [
      "internal:deps:runtime",
      "internal:core:build",
      "internal:build:electron",
    ],
    leaves: ["pnpm -F @mediago/electron run pack"],
  },
  "internal:release:electron": {
    deps: [
      "internal:deps:runtime",
      "internal:core:build",
      "internal:build:electron",
    ],
    leaves: ["pnpm -F @mediago/electron run release"],
  },
  "internal:ci:quality": {
    deps: ["internal:check"],
    leaves: [],
  },
  "internal:ci:test:ts": {
    deps: ["internal:test:ts"],
    leaves: [],
  },
  "internal:ci:test:go": {
    deps: ["internal:test:go"],
    leaves: [],
  },
  "internal:ci:test:media": {
    deps: ["internal:test:integration"],
    leaves: [],
  },
  "internal:ci:test:e2e": {
    deps: [
      "internal:deps:e2e",
      "internal:core:build",
      "internal:test:e2e:build",
    ],
    leaves: [
      "pnpm exec playwright install-deps chromium",
      "pnpm exec playwright install chromium",
      "pnpm type:check:e2e",
      "xvfb-run -a pnpm test:e2e:raw",
    ],
  },
  "internal:ci:docs:build": {
    deps: ["internal:build:docs"],
    leaves: [],
  },
} as const;

const prerequisiteGraph = {
  "internal:core:build": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm core:build"],
  },
  "internal:test:e2e:build": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm test:e2e:build:raw"],
  },
  "internal:test:e2e:chromium": {
    deps: ["internal:deps:node"],
    leaves: ["pnpm exec playwright install chromium"],
  },
  "internal:docker:daemon": { deps: [], leaves: [] },
} as const;

const productionEntryGraph = {
  "internal:production:build:electron": {
    implementation: "internal:build:electron",
    validated: "internal:production:build:electron:validated",
  },
  "internal:production:pack:electron": {
    implementation: "internal:pack:electron",
    validated: "internal:production:pack:electron:validated",
  },
  "internal:production:release:electron": {
    implementation: "internal:release:electron",
    validated: "internal:production:release:electron:validated",
  },
} as const;

const runtimeConsumers = [
  "internal:deps:runtime",
  "internal:deps:media-integration",
  "internal:deps:e2e",
  "internal:dev:all",
  "internal:dev:web",
  "internal:dev:electron",
  "internal:test:integration",
  "internal:test:e2e",
  "internal:test:e2e:web",
  "internal:test:e2e:electron",
  "internal:test:e2e:extension",
  "internal:pack:electron",
  "internal:release:electron",
] as const;

const wrapperScripts = {
  "dev:all": "task dev:all",
  "dev:web": "task dev:web",
  "dev:server": "task dev:web",
  "dev:electron": "task dev:electron",
  "dev:extension": "task dev:extension",
  "docs:dev": "task docs:dev",
  check: "task check",
  test: "task test",
  "test:unit": "task test",
  "test:integration:media:setup": "task deps:media-integration",
  "test:integration:media:run": "task test:integration",
  "test:integration:media": "task test:integration",
  "test:integration": "task test:integration",
  "test:e2e": "task test:e2e",
  "test:e2e:web": "task test:e2e:web",
  "test:e2e:electron": "task test:e2e:electron",
  "test:e2e:extension": "task test:e2e:extension",
  "test:ci": "task test",
  "build:web": "task build:web",
  "build:server": "task build:server",
  "build:electron": "task build:electron",
  "build:extension": "task build:extension",
  "build:docker": "task build:docker",
  "docs:build": "task build:docs",
  "pack:extension": "task pack:extension",
  "pack:electron": "task pack:electron",
  "release:electron": "task release:electron",
  "deps:download": "task deps:runtime",
} as const;

const rawScriptBodies = {
  "dev:all:raw":
    'concurrently --kill-others-on-fail --names backend,electron-ui,server-ui "cross-env APP_TARGET=electron turbo run dev -F @mediago/server -F @mediago/electron" "cross-env APP_TARGET=electron pnpm -F @mediago/ui run dev" "cross-env APP_TARGET=server pnpm -F @mediago/ui run dev"',
  "dev:web:raw":
    "cross-env APP_TARGET=server NODE_ENV=development turbo run dev -F @mediago/server -F @mediago/ui",
  "build:web:raw":
    "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/ui",
  "build:server:raw":
    "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/server -F @mediago/ui",
  "build:electron:raw":
    "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/electron -F @mediago/ui -F @mediago/extension",
  "deps:download:raw": "tsx scripts/download-deps.ts",
  "test:integration:media:run:raw":
    "vitest run --config vitest.integration.config.ts",
  "test:e2e:build:raw":
    "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/server -F @mediago/electron -F @mediago/electron-preload -F @mediago/extension",
  "test:e2e:raw": "playwright test",
  "test:e2e:web:raw": "playwright test --project=web",
  "test:e2e:electron:raw": "playwright test --project=electron",
  "test:e2e:extension:raw": "playwright test --project=extension",
} as const;

function task(name: string): Record<string, unknown> {
  return asRecord(tasks[name], `task ${name}`);
}

function taskCommands(name: string): TaskCommand[] {
  return parseTaskCommands(tasks, name);
}

function taskDependencies(name: string): string[] {
  return parseTaskDependencies(tasks, name);
}

function terminalLeaves(name: string): string[] {
  return taskCommands(name).flatMap((command) => {
    if (command.kind === "task") return [];
    if (
      command.text.startsWith(`node -e "console.log('MEDIAGO_RUNTIME_READY'`) ||
      command.text === `node -e "console.log('MEDIAGO_DEV_PROCESSES_STARTING')"`
    ) {
      return [];
    }
    return [command.text];
  });
}

function requiredVariables(name: string): Array<Record<string, unknown>> {
  const requires = asRecord(task(name).requires, `${name} requires`);
  if (!Array.isArray(requires.vars)) {
    throw new Error(`${name} requires.vars must be an array`);
  }
  return requires.vars.map((entry, index) =>
    typeof entry === "string"
      ? { name: entry }
      : asRecord(entry, `${name} requires variable ${index + 1}`),
  );
}

function packagingRequirements(name: string): string[] {
  return requiredVariables(name)
    .map((requirement) => requirement.name)
    .filter(
      (variableName): variableName is string =>
        typeof variableName === "string" && variableName !== "MEDIAGO_PROFILE",
    );
}

function referencedRootScripts(body: string): string[] {
  const pnpmCommands = [...body.matchAll(/\bpnpm\s+([\w:@-]+)/g)].map(
    (match) => match[1],
  );
  const pnpmBuiltins = new Set(["-F", "--dir", "--filter", "exec", "install"]);
  return pnpmCommands.filter(
    (name): name is string => name !== undefined && !pnpmBuiltins.has(name),
  );
}

function bareBootstrapImports(entrypoint: string): string[] {
  const pending = [path.join(repositoryRoot, entrypoint)];
  const visited = new Set<string>();
  const bareImports: string[] = [];

  while (pending.length > 0) {
    const modulePath = pending.pop();
    if (modulePath === undefined || visited.has(modulePath)) continue;
    visited.add(modulePath);

    if (path.extname(modulePath) === ".json") continue;
    const source = fs.readFileSync(modulePath, "utf8");
    const imports = [
      ...source.matchAll(
        /\b(?:import|export)\s+(?:type\s+)?(?:[^;]*?\sfrom\s+)?["']([^"']+)["']/g,
      ),
    ];
    for (const match of imports) {
      const specifier = match[1];
      if (specifier === undefined || specifier.startsWith("node:")) continue;
      if (!specifier.startsWith(".")) {
        bareImports.push(
          `${path.relative(repositoryRoot, modulePath)}: ${specifier}`,
        );
        continue;
      }
      pending.push(path.resolve(path.dirname(modulePath), specifier));
    }
  }

  return bareImports;
}

describe("root Taskfile public API", () => {
  it("pins the parser and Task schema versions", () => {
    expect(packageJson.devDependencies.yaml).toBe("2.8.3");
    expect(taskfile.version).toBe("3");
    expect(asRecord(taskfile.vars, "Taskfile vars")).toMatchObject({
      MEDIAGO_DEPS_ROOT:
        '{{default (printf "%s/.deps" .ROOT_DIR) .MEDIAGO_DEPS_ROOT}}',
      REQUIRED_TASK_VERSION: "3.51.1",
    });
  });

  it("exports exactly the local public task API", () => {
    const actualPublicTasks = Object.entries(tasks)
      .filter(([, definition]) => {
        const taskDefinition = asRecord(definition, "task definition");
        return taskDefinition.internal !== true;
      })
      .map(([name]) => name)
      .toSorted();

    expect(actualPublicTasks).toEqual([...publicTasks].toSorted());
    for (const name of publicTasks) {
      expect(task(name).desc, `${name} must have a description`).toEqual(
        expect.any(String),
      );
      expect(String(task(name).desc).trim()).not.toBe("");
    }
  });

  it("marks every non-public task private", () => {
    const publicSet = new Set<string>(publicTasks);
    for (const [name, definition] of Object.entries(tasks)) {
      if (publicSet.has(name)) continue;
      expect(name).toMatch(/^internal:/);
      expect(asRecord(definition, `task ${name}`).internal).toBe(true);
    }
  });

  it.each(publicTasks.filter((name) => name !== "doctor"))(
    "%s checks Task before invoking one private implementation",
    (name) => {
      const implementation =
        name === "dev:server"
          ? "internal:dev:web"
          : Object.hasOwn(productionEntryGraph, `internal:production:${name}`)
            ? `internal:production:${name}`
            : `internal:${name}`;
      expect(taskCommands(name)).toEqual([
        { kind: "task", task: "internal:require-task-version" },
        { kind: "task", task: implementation },
      ]);
      expect(task(implementation).internal).toBe(true);
    },
  );
});

describe("Task version gate and doctor", () => {
  const doctorNodePrerequisite = {
    sh: `node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 24 || (major === 24 && minor >= 14) ? 0 : 1)"`,
    msg: "Node 24.14.0 or newer is MediaGo's bootstrap prerequisite. Without a usable Node runtime, doctor cannot aggregate the remaining diagnostics. Install or switch Node (for example, mise use node@24.14.0), then retry.",
  };
  const dependencyNodePrerequisite = {
    sh: doctorNodePrerequisite.sh,
    msg: "Node 24.14.0 or newer is required to install MediaGo's workspace dependencies. Install or switch Node (for example, mise use node@24.14.0), then retry.",
  };
  const gateNodePrerequisite = {
    sh: `node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)"`,
    msg: "Node 22.18.0 or newer is required to validate the pinned Task version. Install or switch Node, then retry.",
  };

  it("contains exactly one typed 3.51.1 gate with environment-only inputs", () => {
    const gates = Object.keys(tasks).filter(
      (name) => name === "internal:require-task-version",
    );

    expect(gates).toEqual(["internal:require-task-version"]);
    const gateCommands = taskCommands("internal:require-task-version");
    expect(gateCommands).toEqual([
      { kind: "cmd", text: "node scripts/task-version-gate.ts" },
    ]);
    expect(
      gateCommands
        .filter((command) => command.kind === "cmd")
        .map((command) => command.text)
        .join("\n"),
    ).not.toMatch(/\b(?:pnpm|tsx)\b/);
    expect(task("internal:require-task-version").env).toEqual({
      MEDIAGO_REQUIRED_TASK_VERSION: "{{.REQUIRED_TASK_VERSION}}",
      MEDIAGO_TASK_VERSION: "{{.TASK_VERSION}}",
    });
  });

  it("keeps root, doctor, and the version gate dotenv-free", () => {
    expect(taskfile).not.toHaveProperty("dotenv");
    expect(task("doctor")).not.toHaveProperty("dotenv");
    expect(task("internal:require-task-version")).not.toHaveProperty("dotenv");
  });

  it("uses the minimum static Node prerequisite for each typed boundary", () => {
    expect(task("doctor").desc).toBe(
      "Diagnose the local MediaGo toolchain and runtime dependencies; Node >=24.14.0 is required to aggregate checks",
    );
    for (const [name, prerequisite] of [
      ["doctor", doctorNodePrerequisite],
      ["internal:require-task-version", gateNodePrerequisite],
      ["internal:deps:node", dependencyNodePrerequisite],
    ] as const) {
      expect(task(name).preconditions).toEqual([prerequisite]);
      expect(JSON.stringify(task(name).preconditions)).not.toContain("{{");
    }
  });

  it("runs doctor through one static typed entrypoint", () => {
    expect(taskCommands("doctor")).toEqual([
      { kind: "cmd", text: "node scripts/task-doctor.ts" },
    ]);
    expect(task("doctor").env).toEqual({
      MEDIAGO_DEPS_ROOT: "{{.MEDIAGO_DEPS_ROOT}}",
      MEDIAGO_REQUIRED_TASK_VERSION: "{{.REQUIRED_TASK_VERSION}}",
      MEDIAGO_TASK_VERSION: "{{.TASK_VERSION}}",
    });
  });

  it("keeps both bootstrap helpers independent of node_modules", () => {
    expect(bareBootstrapImports("scripts/task-version-gate.ts")).toEqual([]);
    expect(bareBootstrapImports("scripts/task-doctor.ts")).toEqual([]);
  });

  it("never interpolates caller-controlled values into shell commands", () => {
    for (const name of Object.keys(tasks)) {
      for (const command of taskCommands(name)) {
        if (command.kind !== "cmd") continue;
        expect(
          command.text,
          `${name} command contains shell interpolation`,
        ).not.toMatch(
          /\{\{\.(?:MEDIAGO_PROFILE|MEDIAGO_DEPS_ROOT|MEDIAGO_DEPS_DIR|MEDIAGO_PLATFORM_KEY|APP_NAME|APP_ID|APP_COPYRIGHT|TASK_VERSION|REQUIRED_TASK_VERSION)\}\}/,
        );
      }
    }
  });

  it("defaults the dependency root to the repository and preserves a caller override", () => {
    const defaultFixture = createDependencyRootFixture();
    expect(
      runFixtureTask(defaultFixture, {
        EXPECTED_DEPS_ROOT: path.join(defaultFixture.directory, ".deps"),
      }).status,
    ).toBe(0);

    const overrideFixture = createDependencyRootFixture();
    const callerRoot = path.join(
      overrideFixture.directory,
      "caller-selected-deps",
    );
    expect(
      runFixtureTask(overrideFixture, {
        EXPECTED_DEPS_ROOT: callerRoot,
        MEDIAGO_DEPS_ROOT: callerRoot,
      }).status,
    ).toBe(0);
  });
});

describe("profile loading", () => {
  const dotenvOrder = [
    ".env.{{.MEDIAGO_PROFILE}}.local",
    ".env.local",
    ".env.{{.MEDIAGO_PROFILE}}",
    ".env",
  ];

  it.each(Object.entries(profileImplementations))(
    "%s defaults to and validates the %s profile",
    (name, profile) => {
      const definition = task(name);
      const variables = asRecord(definition.vars, `${name} vars`);
      const environment = asRecord(definition.env, `${name} env`);
      expect(variables.MEDIAGO_PROFILE).toBe(
        `{{default "${profile}" .MEDIAGO_PROFILE}}`,
      );
      expect(environment.MEDIAGO_PROFILE).toBe("{{.MEDIAGO_PROFILE}}");
      expect(stringArray(definition.dotenv, `${name} dotenv`)).toEqual(
        dotenvOrder,
      );
      expect(definition).not.toHaveProperty("preconditions");
      expect(requiredVariables(name)[0]).toEqual({
        name: "MEDIAGO_PROFILE",
        enum: ["development", "test", "production"],
      });
    },
  );

  it("limits dotenv to profile-loading private implementations", () => {
    const tasksWithDotenv = Object.entries(tasks)
      .filter(([, definition]) =>
        Object.hasOwn(asRecord(definition, "task definition"), "dotenv"),
      )
      .map(([name]) => name)
      .toSorted();
    expect(tasksWithDotenv).toEqual(
      Object.keys(profileImplementations).toSorted(),
    );
  });
});

describe("Task command leaves", () => {
  it("locks the complete ordered local dependency graph and terminal leaves", () => {
    const actualImplementations = Object.keys(tasks)
      .filter(
        (name) =>
          name.startsWith("internal:") &&
          name !== "internal:require-task-version",
      )
      .toSorted();
    expect(actualImplementations).toEqual(
      [
        ...Object.keys(implementationGraph),
        ...Object.keys(prerequisiteGraph),
        ...Object.keys(productionEntryGraph),
        ...Object.values(productionEntryGraph).map(
          ({ validated }) => validated,
        ),
      ].toSorted(),
    );

    for (const [name, expected] of Object.entries(implementationGraph)) {
      expect(taskDependencies(name), `${name} prerequisites`).toEqual(
        expected.deps,
      );
      expect(terminalLeaves(name), `${name} leaves`).toEqual(expected.leaves);
    }
    for (const [name, expected] of Object.entries(prerequisiteGraph)) {
      expect(taskDependencies(name), `${name} prerequisites`).toEqual(
        expected.deps,
      );
      expect(terminalLeaves(name), `${name} leaves`).toEqual(expected.leaves);
    }
    for (const [name, { implementation, validated }] of Object.entries(
      productionEntryGraph,
    )) {
      expect(taskDependencies(name), `${name} prerequisites`).toEqual([
        "internal:deps:node",
      ]);
      expect(taskCommands(name), `${name} implementation sequence`).toEqual([
        { kind: "task", task: validated },
      ]);
      expect(taskDependencies(validated), `${validated} prerequisites`).toEqual(
        [],
      );
      expect(
        taskCommands(validated),
        `${validated} implementation sequence`,
      ).toEqual([{ kind: "task", task: implementation }]);
    }
    expect(task("internal:test:go").dir).toBe("apps/core");

    const visited = new Set<string>();
    const active = new Set<string>();
    const visit = (name: string) => {
      expect(active.has(name), `Task dependency cycle through ${name}`).toBe(
        false,
      );
      if (visited.has(name)) return;
      active.add(name);
      for (const dependency of taskDependencies(name)) visit(dependency);
      active.delete(name);
      visited.add(name);
    };
    for (const name of Object.keys(tasks)) visit(name);
  });

  it("tracks every workspace manifest for the pnpm install marker", () => {
    expect(task("internal:deps:node").method).toBe("timestamp");
    expect(
      stringArray(task("internal:deps:node").sources, "deps:node sources"),
    ).toEqual([
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "docs/package.json",
      "apps/*/package.json",
      "apps/*/app/package.json",
      "packages/*/package.json",
      "packages/*/*/package.json",
    ]);
    expect(
      stringArray(task("internal:deps:node").generates, "deps:node generates"),
    ).toEqual(["node_modules/.pnpm/lock.yaml"]);
  });

  it("runs shared mutating prerequisites only once per invocation graph", () => {
    expect(task("internal:deps:node").run).toBe("once");
    expect(task("internal:core:build").run).toBe("once");
  });

  it("gives only the environment-consuming shared E2E build its own test profile", () => {
    for (const name of [
      "internal:test:e2e",
      "internal:test:e2e:web",
      "internal:test:e2e:electron",
      "internal:test:e2e:extension",
    ]) {
      expect(taskDependencies(name)).toContain("internal:test:e2e:build");
    }
    for (const property of ["vars", "env", "dotenv", "requires"]) {
      expect(task("internal:core:build")).not.toHaveProperty(property);
    }
  });

  it("ignores Task's reproducible local timestamp cache", () => {
    const ignored = spawnSync(
      "git",
      ["check-ignore", ".task/timestamp/internal-deps-node"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );

    expect(ignored.error).toBeUndefined();
    expect(ignored.status).toBe(0);
    expect(ignored.stdout.trim()).toBe(".task/timestamp/internal-deps-node");
  });

  it("uses a native Docker daemon precondition", () => {
    expect(task("internal:docker:daemon").preconditions).toEqual([
      {
        sh: "docker info >/dev/null 2>&1",
        msg: "Docker daemon is unavailable. Start Docker and retry task build:docker.",
      },
    ]);
  });

  it("passes the canonical dependency root and current-platform leaf safely", () => {
    for (const name of runtimeConsumers) {
      const variables = asRecord(task(name).vars, `${name} vars`);
      const platform = asRecord(
        variables.MEDIAGO_PLATFORM_KEY,
        `${name} platform variable`,
      );
      const environment = asRecord(task(name).env, `${name} env`);
      expect(platform).toEqual({ sh: "node scripts/print-platform-key.ts" });
      expect(environment.MEDIAGO_DEPS_ROOT).toBe("{{.MEDIAGO_DEPS_ROOT}}");
      expect(environment.MEDIAGO_DEPS_DIR).toBe(
        "{{.MEDIAGO_DEPS_ROOT}}/{{.MEDIAGO_PLATFORM_KEY}}",
      );
      expect(String(environment.MEDIAGO_DEPS_ROOT)).not.toContain(
        "MEDIAGO_PLATFORM_KEY",
      );
    }
  });

  it("prints stable readiness boundaries without shell-rendering dependency paths", () => {
    for (const name of [
      "internal:deps:runtime",
      "internal:deps:media-integration",
      "internal:deps:e2e",
    ]) {
      expect(taskCommands(name).at(-1)).toEqual({
        kind: "cmd",
        text: `node -e "console.log('MEDIAGO_RUNTIME_READY', process.env.MEDIAGO_DEPS_DIR)"`,
      });
    }
    expect(taskCommands("internal:dev:all").slice(-2)).toEqual([
      {
        kind: "cmd",
        text: `node -e "console.log('MEDIAGO_DEV_PROCESSES_STARTING')"`,
      },
      { kind: "cmd", text: "pnpm dev:all:raw" },
    ]);
  });

  it("uses only approved command classes", () => {
    for (const name of Object.keys(tasks)) {
      for (const command of taskCommands(name)) {
        if (command.kind === "task") {
          expect(command.task, `${name} must invoke an internal task`).toMatch(
            /^internal:/,
          );
          continue;
        }

        expect(
          command.text,
          `${name} must not compose leaf commands`,
        ).not.toMatch(/(?:&&|\|\||[|]|\n)/);
        expect(command.text, `${name} has an unsafe leaf command`).toMatch(
          /^(?:node\s+scripts\/task-(?:version-gate|doctor)\.ts|node -e "console\.log\('MEDIAGO_(?:RUNTIME_READY', process\.env\.MEDIAGO_DEPS_DIR|DEV_PROCESSES_STARTING')\)"|pnpm\s+[\w:-]+(?::raw)?(?:\s+[^;&|\n]+)?|pnpm\s+(?:-F|--filter)\s+\S+\s+run\s+\S+|pnpm\s+install(?:\s+[^;&|\n]+)?|pnpm\s+exec(?:\s+[^;&|\n]+)?|xvfb-run -a pnpm test:e2e:raw|go\s+[^;&|\n]+|docker\s+[^;&|\n]+)$/,
        );
      }
    }
  });

  it("routes historical orchestrators to public Tasks and preserves exact leaves", () => {
    for (const [name, expectedBody] of Object.entries(wrapperScripts)) {
      expect(packageJson.scripts[name], `${name} is not a Task wrapper`).toBe(
        expectedBody,
      );
    }
    for (const [name, expectedBody] of Object.entries(rawScriptBodies)) {
      expect(packageJson.scripts[name]).toBe(expectedBody);
    }
  });

  it("calls only reachable package leaves that do not re-enter Task", () => {
    const rootScriptCalls = Object.keys(tasks).flatMap((name) =>
      taskCommands(name).flatMap((command) => {
        if (command.kind !== "cmd") return [];
        const match = command.text.match(/^pnpm\s+([\w:-]+)(?:\s|$)/);
        if (!match || ["exec", "install"].includes(match[1] ?? "")) return [];
        return match[1] === "-F" || match[1] === "--filter" ? [] : [match[1]];
      }),
    );

    const pending = [...new Set(rootScriptCalls)];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const scriptName = pending.shift();
      expect(scriptName).toEqual(expect.any(String));
      if (scriptName === undefined || visited.has(scriptName)) continue;
      visited.add(scriptName);

      const body = packageJson.scripts[scriptName];
      expect(body, `missing package script ${scriptName}`).toEqual(
        expect.any(String),
      );
      expect(body, `${scriptName} must not wrap back into Task`).not.toMatch(
        /\btask(?:\.exe)?\s+/,
      );
      for (const referencedScript of referencedRootScripts(body)) {
        expect(
          packageJson.scripts[referencedScript],
          `${scriptName} calls missing package script ${referencedScript}`,
        ).toEqual(expect.any(String));
        pending.push(referencedScript);
      }
    }
  });
});

describe("production variable requirements", () => {
  const expectedPackagingRequirements = {
    "build:electron": ["APP_NAME"],
    "pack:electron": ["APP_NAME", "APP_ID", "APP_COPYRIGHT"],
    "release:electron": ["APP_NAME", "APP_ID", "APP_COPYRIGHT"],
  } as const;

  it("keeps public wrappers and reusable implementations metadata-free", () => {
    for (const name of Object.keys(expectedPackagingRequirements)) {
      expect(task(name)).not.toHaveProperty("requires");
    }
    for (const name of [
      "internal:build:electron",
      "internal:pack:electron",
      "internal:release:electron",
    ]) {
      expect(packagingRequirements(name)).toEqual([]);
    }
  });

  it.each(Object.entries(expectedPackagingRequirements))(
    "%s validates exactly %s in its production profile entry",
    (name, expected) => {
      const bootstrapName = `internal:production:${name}`;
      const entryName = `${bootstrapName}:validated`;
      expect(task(bootstrapName)).not.toHaveProperty("requires");
      expect(task(bootstrapName)).not.toHaveProperty("dotenv");
      const variables = asRecord(task(entryName).vars, `${entryName} vars`);
      expect(packagingRequirements(entryName)).toEqual(expected);
      for (const variableName of expected) {
        expect(variables[variableName]).toEqual({
          sh: `node scripts/task-production-metadata.ts ${variableName}`,
        });
        expect(
          requiredVariables(entryName).find(
            (requirement) => requirement.name === variableName,
          ),
        ).toEqual({ name: variableName, enum: ["present"] });
      }
    },
  );

  it("loads the final production metadata value through the canonical profile loader", () => {
    const source = fs.readFileSync(
      path.join(repositoryRoot, "scripts/task-production-metadata.ts"),
      "utf8",
    );
    expect(source).toContain(
      'import { loadProfileEnv } from "./load-profile-env.ts";',
    );
    expect(source).toContain("loadProfileEnv(process.cwd());");
    expect(source).not.toMatch(/DOTENV_FILES|readFileSync|new RegExp/);
  });
});

function createDependencyRootFixture(): TaskFixture {
  return createTaskFixture({
    version: "3",
    vars: taskfile.vars,
    tasks: {
      probe: {
        env: { MEDIAGO_DEPS_ROOT: "{{.MEDIAGO_DEPS_ROOT}}" },
        cmds: [
          `node -e "process.exit(process.env.MEDIAGO_DEPS_ROOT === process.env.EXPECTED_DEPS_ROOT ? 0 : 17)"`,
        ],
      },
    },
  });
}
