import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveConfig } from "../docs/node_modules/vitepress/dist/node/index.js";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import {
  asRecord,
  createTaskFixture,
  dockerRepositoryCommands,
  migratedPnpmCommandsInCodeBlocks,
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

const normativeDocumentation = {
  "README.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: true,
    dependencyPolicy: /does not (?:automatically )?(?:upgrade|update)/i,
  },
  "README.zh.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: true,
    dependencyPolicy: /不会自动升级/,
  },
  "README.jp.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: true,
    dependencyPolicy: /自動(?:更新|アップグレード)されません/,
  },
  "README.it.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: true,
    dependencyPolicy: /non (?:si )?aggiorn\w* automaticamente/i,
  },
  "CONTRIBUTING.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: true,
    dependencyPolicy: /does not (?:automatically )?(?:upgrade|update)/i,
  },
  "apps/core/README.md": {
    tasks: ["setup", "dev:web", "check", "test"],
    installsTask: false,
  },
  "apps/electron/README.md": {
    tasks: ["setup", "dev:all", "dev:electron", "check", "test"],
    installsTask: false,
  },
  "apps/ui/README.md": {
    tasks: ["setup", "dev:all", "dev:web", "dev:electron", "check", "test"],
    installsTask: false,
  },
} as const;

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
  "ci:desktop:validate-request",
  "ci:desktop:verify-source",
  "ci:desktop:artifact-prefix",
  "ci:desktop:apply-version",
  "ci:desktop:release",
  "ci:docker:validate-inputs",
  "ci:docker:resolve-parameters",
  "ci:docker:verify-preview-private",
  "ci:docker:detect-dockerhub",
  "ci:docker:resolve-targets",
  "ci:docker:write-summary",
  "ci:release:validate-request",
  "ci:release:detect-release-state",
  "ci:release:calculate-version",
  "ci:release:commit-version",
  "ci:release:resolve-source",
  "ci:release:write-prepare-summary",
  "ci:release:collect-electron-artifacts",
  "ci:release:publish-desktop",
  "ci:release:write-desktop-summary",
  "ci:release:tag-docker-release",
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
  "internal:ci:desktop:release": "production",
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
  "internal:ci:desktop:validate-request": {
    deps: [],
    leaves: ["node scripts/ci/desktop-workflow.ts validate-request"],
  },
  "internal:ci:desktop:verify-source": {
    deps: [],
    leaves: ["node scripts/ci/desktop-workflow.ts verify-source"],
  },
  "internal:ci:desktop:artifact-prefix": {
    deps: [],
    leaves: ["node scripts/ci/desktop-workflow.ts artifact-prefix"],
  },
  "internal:ci:desktop:apply-version": {
    deps: [],
    leaves: ["node scripts/ci/desktop-workflow.ts apply-version"],
  },
  "internal:ci:desktop:release": {
    deps: [
      "internal:deps:node",
      "internal:deps:runtime",
      "internal:release:electron",
    ],
    leaves: [],
  },
  "internal:ci:docker:validate-inputs": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts validate-inputs"],
  },
  "internal:ci:docker:resolve-parameters": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts resolve-parameters"],
  },
  "internal:ci:docker:verify-preview-private": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts verify-preview-private"],
  },
  "internal:ci:docker:detect-dockerhub": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts detect-dockerhub"],
  },
  "internal:ci:docker:resolve-targets": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts resolve-targets"],
  },
  "internal:ci:docker:write-summary": {
    deps: [],
    leaves: ["node scripts/ci/docker-workflow.ts write-summary"],
  },
  "internal:ci:release:validate-request": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts validate-request"],
  },
  "internal:ci:release:detect-release-state": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts detect-release-state"],
  },
  "internal:ci:release:calculate-version": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts calculate-version"],
  },
  "internal:ci:release:commit-version": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts commit-version"],
  },
  "internal:ci:release:resolve-source": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts resolve-source"],
  },
  "internal:ci:release:write-prepare-summary": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts write-prepare-summary"],
  },
  "internal:ci:release:collect-electron-artifacts": {
    deps: [],
    leaves: [
      'node scripts/collect-electron-artifacts.ts electron-artifacts release-files "$VERSION" "$UPDATER_CHANNEL"',
    ],
  },
  "internal:ci:release:publish-desktop": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts publish-desktop"],
  },
  "internal:ci:release:write-desktop-summary": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts write-desktop-summary"],
  },
  "internal:ci:release:tag-docker-release": {
    deps: [],
    leaves: ["node scripts/ci/release-workflow.ts tag-docker-release"],
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
  "internal:ci:desktop:release",
] as const;

const metadataWorkflowTasks = [
  "internal:ci:desktop:validate-request",
  "internal:ci:desktop:verify-source",
  "internal:ci:desktop:artifact-prefix",
  "internal:ci:desktop:apply-version",
  "internal:ci:docker:validate-inputs",
  "internal:ci:docker:resolve-parameters",
  "internal:ci:docker:verify-preview-private",
  "internal:ci:docker:detect-dockerhub",
  "internal:ci:docker:resolve-targets",
  "internal:ci:docker:write-summary",
  "internal:ci:release:validate-request",
  "internal:ci:release:detect-release-state",
  "internal:ci:release:calculate-version",
  "internal:ci:release:commit-version",
  "internal:ci:release:resolve-source",
  "internal:ci:release:write-prepare-summary",
  "internal:ci:release:collect-electron-artifacts",
  "internal:ci:release:publish-desktop",
  "internal:ci:release:write-desktop-summary",
  "internal:ci:release:tag-docker-release",
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
    expect(task("internal:deps:runtime").run).toBe("once");
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
          /^(?:node\s+scripts\/task-(?:version-gate|doctor)\.ts|node scripts\/ci\/(?:desktop|docker|release)-workflow\.ts [\w-]+|node scripts\/collect-electron-artifacts\.ts electron-artifacts release-files "\$VERSION" "\$UPDATER_CHANNEL"|node -e "console\.log\('MEDIAGO_(?:RUNTIME_READY', process\.env\.MEDIAGO_DEPS_DIR|DEV_PROCESSES_STARTING')\)"|pnpm\s+[\w:-]+(?::raw)?(?:\s+[^;&|\n]+)?|pnpm\s+(?:-F|--filter)\s+\S+\s+run\s+\S+|pnpm\s+install(?:\s+[^;&|\n]+)?|pnpm\s+exec(?:\s+[^;&|\n]+)?|xvfb-run -a pnpm test:e2e:raw|go\s+[^;&|\n]+|docker\s+[^;&|\n]+)$/,
        );
      }
    }
  });

  it("keeps workflow metadata and publication leaves environment-transparent", () => {
    for (const name of metadataWorkflowTasks) {
      const definition = task(name);
      expect(definition.internal).toBe(true);
      expect(definition).not.toHaveProperty("vars");
      expect(definition).not.toHaveProperty("env");
      expect(definition).not.toHaveProperty("dotenv");
      expect(definition).not.toHaveProperty("requires");
      expect(taskDependencies(name)).toEqual([]);
      expect(taskCommands(name)).toHaveLength(1);
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

describe("Docker repository command contract", () => {
  const dockerfileSource = fs.readFileSync(
    path.join(repositoryRoot, "Dockerfile"),
    "utf8",
  );

  it("keeps Task out of the image and uses only exact repository leaves", () => {
    expect(dockerRepositoryCommands(dockerfileSource)).toEqual([
      "pnpm install --frozen-lockfile",
      "pnpm --filter @mediago/player-ui run build",
      "pnpm build:web:raw",
      'pnpm deps:download:raw --platform "$(cat /tmp/deps-platform)"',
    ]);
    expect(dockerfileSource).not.toMatch(
      /(?:COPY\s+Taskfile\.yml|go-task|RUN\s+task(?:\.exe)?\s)/i,
    );
  });

  it("preserves the build-platform dependency mapping", () => {
    expect(
      dockerfileSource.match(/FROM --platform=\$BUILDPLATFORM/g),
    ).toHaveLength(2);
    expect(dockerfileSource).toContain('if [ "$TARGETARCH" = "amd64" ]');
    expect(dockerfileSource).toContain('echo "linux-x64" > /tmp/deps-platform');
    expect(dockerfileSource).toContain(
      'echo "linux-${TARGETARCH}" > /tmp/deps-platform',
    );
  });

  it("exposes wrapped Docker invocations instead of treating them as approved leaves", () => {
    expect(
      dockerRepositoryCommands(`
RUN env APP_TARGET=server pnpm build:web:raw
RUN cd /src && \\
    pnpm deps:download:raw --platform linux-x64
`),
    ).toEqual([
      "env APP_TARGET=server pnpm build:web:raw",
      "cd /src && pnpm deps:download:raw --platform linux-x64",
    ]);
  });
});

describe("normative documentation Task contract", () => {
  it("excludes internal implementation plans from the public docs source", async () => {
    const docsConfig = await resolveConfig(
      path.join(repositoryRoot, "docs"),
      "build",
      "production",
    );
    expect(docsConfig.userConfig.srcExclude).toEqual(["superpowers/**"]);
    expect(
      docsConfig.pages.filter((page) => page.startsWith("superpowers/")),
    ).toEqual([]);
    expect(docsConfig.pages).toContain("index.md");
    expect(docsConfig.pages).toContain("en/index.md");
  });

  it.each(Object.entries(normativeDocumentation))(
    "%s recommends only canonical repository orchestration",
    (filename, requirements) => {
      const source = fs.readFileSync(
        path.join(repositoryRoot, filename),
        "utf8",
      );

      expect(source).toContain("3.51.1");
      expect(source).toContain("task --version");
      for (const taskName of requirements.tasks) {
        expect(source, `${filename} task ${taskName}`).toContain(
          `task ${taskName}`,
        );
      }
      expect(migratedPnpmCommandsInCodeBlocks(source), filename).toEqual([]);

      if (requirements.installsTask) {
        expect(source).toContain("macOS");
        expect(source).toContain("Linux");
        expect(source).toContain("Windows");
        expect(source).toContain(
          "go install github.com/go-task/task/v3/cmd/task@v3.51.1",
        );
        expect(
          source.indexOf("task setup"),
          `${filename} setup order`,
        ).toBeLessThan(source.indexOf("task dev:all"));
        expect(source).toContain("scripts/deps-versions.json");
        expect(source).toContain("pnpm install");
        expect(source).toContain("BBDown");
        expect(source).toContain("dev:server");
        expect(source).toMatch(requirements.dependencyPolicy);
      }
    },
  );

  it("rejects migrated pnpm startup/build commands without matching substrings broadly", () => {
    expect(
      migratedPnpmCommandsInCodeBlocks(`
\`\`\`shell
pnpm dev:web
pnpm build:web --mode production
env NODE_ENV=test pnpm run dev:electron
cd mediago && pnpm build:web:raw
\`\`\`
`),
    ).toEqual([
      "pnpm dev:web",
      "pnpm build:web --mode production",
      "env NODE_ENV=test pnpm run dev:electron",
      "pnpm build:web:raw",
    ]);

    expect(
      migratedPnpmCommandsInCodeBlocks(`
\`pnpm dev:web\` is historical prose, not a recommendation block.

\`\`\`shell
pnpm install --frozen-lockfile
pnpm --filter @mediago/player-ui run build
pnpm add @mediago/core
pnpm run npm:build
docker run --name mediago example/mediago
\`\`\`
`),
    ).toEqual([]);
  });

  it("rejects migrated pnpm commands split across POSIX and Windows continuations", () => {
    expect(
      migratedPnpmCommandsInCodeBlocks(`
\`\`\`shell
pnpm \\
  dev:web
pnpm run \\
  build:electron
\`\`\`
`),
    ).toEqual(["pnpm dev:web", "pnpm run build:electron"]);

    expect(
      migratedPnpmCommandsInCodeBlocks(
        "```shell\r\npnpm \\\r\n  dev:electron\r\n```\r\n",
      ),
    ).toEqual(["pnpm dev:electron"]);

    expect(
      migratedPnpmCommandsInCodeBlocks(`
\`\`\`shell
pnpm install \\
  --frozen-lockfile
pnpm --filter \\
  @mediago/player-ui run build
pnpm run \\
  npm:build
\`\`\`
`),
    ).toEqual([]);
  });

  it.each([
    [
      "PowerShell LF continuation",
      "```powershell\npnpm `\n  dev:web\n```",
      ["pnpm dev:web"],
    ],
    [
      "PowerShell CRLF continuation",
      "```powershell\r\npnpm `\r\n  run build:electron\r\n```",
      ["pnpm run build:electron"],
    ],
    [
      "CMD LF continuation",
      "```bat\npnpm ^\n  dev:electron\n```",
      ["pnpm dev:electron"],
    ],
    [
      "CMD CRLF continuation",
      "```bat\r\npnpm run ^\r\n  build:web\r\n```",
      ["pnpm run build:web"],
    ],
    [
      "pnpm global no-argument option",
      "```shell\npnpm --silent dev:web\n```",
      ["pnpm --silent dev:web"],
    ],
    [
      "pnpm directory option",
      "```shell\npnpm -C . build:web\n```",
      ["pnpm -C . build:web"],
    ],
    [
      "leading environment assignment",
      "~~~shell\nNODE_ENV=test pnpm dev:web\n~~~",
      ["NODE_ENV=test pnpm dev:web"],
    ],
    [
      "Markdown indented code",
      "Commands:\n\n    pnpm run dev:electron\n",
      ["pnpm run dev:electron"],
    ],
    [
      "HTML pre/code with entities",
      '<pre class="example"><code class="language-shell"><span>cd</span> mediago &amp;&amp; pnpm --silent build:web</code></pre>',
      ["pnpm --silent build:web"],
    ],
    [
      "repository root shorthand",
      "```shell\npnpm -w run build\n```",
      ["pnpm -w run build"],
    ],
    [
      "repository root long option",
      "```shell\npnpm --workspace-root run test\n```",
      ["pnpm --workspace-root run test"],
    ],
    [
      "repository root long option after another global option",
      "```shell\npnpm --silent --workspace-root run test\n```",
      ["pnpm --silent --workspace-root run test"],
    ],
    [
      "repository root option before another global option",
      "```shell\npnpm --workspace-root --silent run check\n```",
      ["pnpm --workspace-root --silent run check"],
    ],
    [
      "lexical dot-slash repository directory",
      "```shell\npnpm --silent -C ./ run build:web\n```",
      ["pnpm --silent -C ./ run build:web"],
    ],
    [
      "lexical backslash repository directory",
      "```powershell\npnpm --dir '.\\' run dev\n```",
      ["pnpm --dir '.\\' run dev"],
    ],
    [
      "blockquote fenced code",
      "> ```shell\n> pnpm dev:web\n> ```\n",
      ["pnpm dev:web"],
    ],
    [
      "sudo wrapper",
      "```shell\nsudo pnpm dev:electron\n```",
      ["sudo pnpm dev:electron"],
    ],
    [
      "command wrapper",
      "```shell\ncommand pnpm run build\n```",
      ["command pnpm run build"],
    ],
    [
      "HTML attributes containing greater-than signs",
      `<pre title="a > b"><code data-example='c > d'>pnpm build:web</code></pre>`,
      ["pnpm build:web"],
    ],
  ])("detects %s", (_name, source, expected) => {
    expect(migratedPnpmCommandsInCodeBlocks(source)).toEqual(expected);
  });

  it.each([
    ["echo arguments", "```shell\necho pnpm dev:web\n```"],
    ["ordinary prose", "Use pnpm dev:web only in historical examples."],
    ["three-space indentation", "   pnpm dev:web\n"],
    ["canonical Task", "```shell\ntask dev:web\n```"],
    ["workspace filter", "```shell\npnpm --filter @mediago/ui run build\n```"],
    ["workspace shorthand", "```shell\npnpm -F @mediago/ui run dev\n```"],
    [
      "named project filter",
      "```shell\npnpm --filter @mediago/project run build:web\n```",
    ],
    ["component directory", "```shell\npnpm -C apps/ui run build\n```"],
    [
      "component directory long option",
      "```shell\npnpm --dir apps/electron run dev\n```",
    ],
    [
      "component directory with global options",
      "```shell\npnpm --silent --dir apps/electron run dev\n```",
    ],
    [
      "component directory before a global option",
      "```shell\npnpm --dir apps/electron --silent run dev\n```",
    ],
    [
      "workspace filter before a global option",
      "```shell\npnpm --filter @mediago/project --silent run build:web\n```",
    ],
    [
      "package install",
      "<pre><code>pnpm install &amp;&amp; pnpm add yaml</code></pre>",
    ],
    ["component script", "    pnpm run npm:build\n"],
  ])("allows %s without a migrated repository invocation", (_name, source) => {
    expect(migratedPnpmCommandsInCodeBlocks(source)).toEqual([]);
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
