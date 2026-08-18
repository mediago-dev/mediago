import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

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
  "internal:build:web": "production",
  "internal:build:server": "production",
  "internal:build:electron": "production",
  "internal:build:extension": "production",
  "internal:build:docs": "production",
  "internal:build:docker": "production",
  "internal:pack:extension": "production",
  "internal:pack:electron": "production",
  "internal:release:electron": "production",
} as const;

const implementationCommands = {
  "internal:setup": [
    { kind: "task", task: "internal:deps:node" },
    { kind: "task", task: "internal:deps:runtime" },
  ],
  "internal:deps:node": [
    { kind: "cmd", text: "pnpm install --frozen-lockfile" },
  ],
  "internal:deps:runtime": [
    {
      kind: "cmd",
      text: "pnpm deps:download:raw --tools ffmpeg,N_m3u8DL-RE,BBDown,aria2,yt-dlp,mediago",
    },
  ],
  "internal:deps:media-integration": [
    {
      kind: "cmd",
      text: "pnpm deps:download:raw --tools aria2,N_m3u8DL-RE,ffmpeg",
    },
  ],
  "internal:deps:e2e": [
    { kind: "cmd", text: "pnpm deps:download:raw --tools aria2" },
  ],
  "internal:dev:all": [{ kind: "cmd", text: "pnpm dev:all:raw" }],
  "internal:dev:web": [{ kind: "cmd", text: "pnpm dev:web:raw" }],
  "internal:dev:electron": [{ kind: "cmd", text: "pnpm dev:electron:raw" }],
  "internal:dev:extension": [{ kind: "cmd", text: "pnpm dev:extension:raw" }],
  "internal:docs:dev": [{ kind: "cmd", text: "pnpm docs:dev:raw" }],
  "internal:check": [{ kind: "cmd", text: "pnpm check:raw" }],
  "internal:test": [{ kind: "cmd", text: "pnpm test:raw" }],
  "internal:test:ts": [{ kind: "cmd", text: "pnpm test:ts:raw" }],
  "internal:test:go": [{ kind: "cmd", text: "pnpm test:go:raw" }],
  "internal:test:integration": [
    { kind: "cmd", text: "pnpm test:integration:raw" },
  ],
  "internal:test:e2e": [{ kind: "cmd", text: "pnpm test:e2e:raw" }],
  "internal:test:e2e:web": [{ kind: "cmd", text: "pnpm test:e2e:web:raw" }],
  "internal:test:e2e:electron": [
    { kind: "cmd", text: "pnpm test:e2e:electron:raw" },
  ],
  "internal:test:e2e:extension": [
    { kind: "cmd", text: "pnpm test:e2e:extension:raw" },
  ],
  "internal:build:web": [{ kind: "cmd", text: "pnpm build:web:raw" }],
  "internal:build:server": [{ kind: "cmd", text: "pnpm build:server:raw" }],
  "internal:build:electron": [{ kind: "cmd", text: "pnpm build:electron:raw" }],
  "internal:build:extension": [
    { kind: "cmd", text: "pnpm build:extension:raw" },
  ],
  "internal:build:docs": [{ kind: "cmd", text: "pnpm docs:build:raw" }],
  "internal:build:docker": [{ kind: "cmd", text: "pnpm build:docker:raw" }],
  "internal:pack:extension": [{ kind: "cmd", text: "pnpm pack:extension:raw" }],
  "internal:pack:electron": [{ kind: "cmd", text: "pnpm pack:electron:raw" }],
  "internal:release:electron": [
    { kind: "cmd", text: "pnpm release:electron:raw" },
  ],
} as const satisfies Record<string, readonly TaskCommand[]>;

const preservedScriptBodies = {
  "dev:electron":
    "pnpm core:build && cross-env APP_TARGET=electron NODE_ENV=development pnpm build:electron && pnpm start:electron",
  "build:electron":
    "cross-env APP_TARGET=electron NODE_ENV=production turbo run build -F @mediago/electron -F @mediago/ui -F @mediago/extension",
  "dev:server":
    "pnpm core:build && cross-env APP_TARGET=server NODE_ENV=development turbo run dev -F @mediago/server -F @mediago/ui",
  "build:web":
    "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/ui",
  "dev:extension": "pnpm -F @mediago/extension run dev",
  "build:extension": "turbo run build -F @mediago/extension",
  "dev:all":
    'pnpm core:build && pnpm build:electron && concurrently --kill-others-on-fail --names backend,electron-ui,server-ui "cross-env APP_TARGET=electron turbo run dev -F @mediago/server -F @mediago/electron" "cross-env APP_TARGET=electron pnpm -F @mediago/ui run dev" "cross-env APP_TARGET=server pnpm -F @mediago/ui run dev"',
  "pack:extension": "pnpm build:extension && tsx scripts/pack-extension.ts",
  check: "pnpm lint && pnpm format:check && pnpm type:check",
  test: "pnpm test:ts && pnpm test:go",
  "test:ts": "vitest run",
  "test:go": "cd apps/core && go test ./...",
  "test:integration": "pnpm test:integration:media",
  "test:e2e": "playwright test",
  "test:e2e:web": "playwright test --project=web",
  "test:e2e:electron": "playwright test --project=electron",
  "test:e2e:extension": "playwright test --project=extension",
  "pack:electron":
    "pnpm core:build && pnpm build:electron && pnpm -F @mediago/electron run pack",
  "release:electron":
    "pnpm core:build && pnpm build:electron && pnpm -F @mediago/electron run release",
  "build:docker": "docker build -t mediago:local .",
  "docs:dev": "pnpm -F @mediago/docs run docs:dev",
  "docs:build": "pnpm -F @mediago/docs run docs:build",
  "deps:download": "tsx scripts/download-deps.ts",
} as const;

const rawScriptSources = {
  "dev:electron:raw": "dev:electron",
  "build:electron:raw": "build:electron",
  "dev:web:raw": "dev:server",
  "build:web:raw": "build:web",
  "dev:extension:raw": "dev:extension",
  "build:extension:raw": "build:extension",
  "dev:all:raw": "dev:all",
  "pack:extension:raw": "pack:extension",
  "check:raw": "check",
  "test:raw": "test",
  "test:ts:raw": "test:ts",
  "test:go:raw": "test:go",
  "test:integration:raw": "test:integration",
  "test:e2e:raw": "test:e2e",
  "test:e2e:web:raw": "test:e2e:web",
  "test:e2e:electron:raw": "test:e2e:electron",
  "test:e2e:extension:raw": "test:e2e:extension",
  "pack:electron:raw": "pack:electron",
  "release:electron:raw": "release:electron",
  "build:docker:raw": "build:docker",
  "docs:dev:raw": "docs:dev",
  "docs:build:raw": "docs:build",
  "deps:download:raw": "deps:download",
} as const satisfies Record<string, keyof typeof preservedScriptBodies>;

const newRawScriptBodies = {
  "build:server:raw":
    "cross-env APP_TARGET=server NODE_ENV=production turbo run build -F @mediago/server -F @mediago/ui",
} as const;

type TaskCommand =
  | { kind: "cmd"; text: string }
  | { kind: "task"; task: string };

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

function task(name: string): Record<string, unknown> {
  return asRecord(tasks[name], `task ${name}`);
}

function taskCommands(name: string): TaskCommand[] {
  const commands = task(name).cmds;
  if (!Array.isArray(commands)) {
    throw new Error(`task ${name} must declare a cmds array`);
  }
  return commands.map((command, index) => {
    if (typeof command === "string") return { kind: "cmd", text: command };

    const mapping = asRecord(command, `task ${name} command ${index + 1}`);
    if (typeof mapping.task === "string") {
      return { kind: "task", task: mapping.task };
    }
    if (typeof mapping.cmd === "string") {
      return { kind: "cmd", text: mapping.cmd };
    }
    throw new Error(
      `task ${name} command ${index + 1} must contain cmd or task`,
    );
  });
}

function stringArray(value: unknown, context: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${context} must be a string array`);
  }
  return value as string[];
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
        name === "dev:server" ? "internal:dev:web" : `internal:${name}`;
      expect(taskCommands(name)).toEqual([
        { kind: "task", task: "internal:require-task-version" },
        { kind: "task", task: implementation },
      ]);
      expect(task(implementation).internal).toBe(true);
    },
  );
});

describe("Task version gate and doctor", () => {
  const nodePrerequisite = {
    sh: `node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 24 || (major === 24 && minor >= 14) ? 0 : 1)"`,
    msg: "Node 24.14.0 or newer is required to run MediaGo tasks. Install or switch Node (for example, mise use node@24.14.0), then retry.",
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

  it("checks the static Node prerequisite before either typed helper", () => {
    for (const name of ["doctor", "internal:require-task-version"]) {
      expect(task(name).preconditions).toEqual([nodePrerequisite]);
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
          /\{\{\.(?:MEDIAGO_PROFILE|MEDIAGO_DEPS_ROOT|TASK_VERSION|REQUIRED_TASK_VERSION)\}\}/,
        );
      }
    }
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
      expect(definition.requires).toEqual({
        vars: [
          {
            name: "MEDIAGO_PROFILE",
            enum: ["development", "test", "production"],
          },
        ],
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
  it("locks every private implementation to its exact Task 3 commands", () => {
    const actualImplementations = Object.keys(tasks)
      .filter(
        (name) =>
          name.startsWith("internal:") &&
          name !== "internal:require-task-version",
      )
      .toSorted();
    expect(actualImplementations).toEqual(
      Object.keys(implementationCommands).toSorted(),
    );

    for (const [name, expectedCommands] of Object.entries(
      implementationCommands,
    )) {
      expect(taskCommands(name)).toEqual(expectedCommands);
    }
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
        ).not.toMatch(/(?:&&|\|\||[;|]|\n)/);
        expect(command.text, `${name} has an unsafe leaf command`).toMatch(
          /^(?:node\s+scripts\/task-(?:version-gate|doctor)\.ts|pnpm\s+[\w:-]+:raw(?:\s+[^;&|\n]+)?|pnpm\s+(?:-F|--filter)\s+\S+\s+run\s+\S+|pnpm\s+install(?:\s+[^;&|\n]+)?|pnpm\s+exec(?:\s+[^;&|\n]+)?|pnpm\s+start:electron|go\s+[^;&|\n]+|docker\s+[^;&|\n]+)$/,
        );
      }
    }
  });

  it("keeps historical entrypoints and their raw copies byte-for-byte", () => {
    for (const [name, expectedBody] of Object.entries(preservedScriptBodies)) {
      expect(packageJson.scripts[name], `${name} changed at Task 3`).toBe(
        expectedBody,
      );
    }
    for (const [rawName, sourceName] of Object.entries(rawScriptSources)) {
      expect(
        packageJson.scripts[rawName],
        `${rawName} is not an exact copy`,
      ).toBe(preservedScriptBodies[sourceName]);
    }
    for (const [name, expectedBody] of Object.entries(newRawScriptBodies)) {
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
