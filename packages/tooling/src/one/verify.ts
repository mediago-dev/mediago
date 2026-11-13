import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const executable = process.env.MEDIAGO_ONE_BIN || "one";

type Plan = {
  schema: string;
  entries: string[];
  tasks: { name: string; directory: string; run?: string; depends: string[] }[];
};

function one(args: string[]): unknown {
  const result = spawnSync(executable, [...args, "-o", "json"], {
    cwd: root,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `one ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout) as unknown;
}

function verifyPlan(name: string, command: string, project?: string): void {
  const args = ["run", name, "--dry-run"];
  if (project) args.push("-p", project);
  const plan = one(args) as Plan;
  assert.equal(plan.schema, "one-cli/task-plan/v1");
  const entry = `//:${project ? `${project}:` : ""}${name}`;
  assert.deepEqual(plan.entries, [entry]);
  const task = plan.tasks.find((item) => item.name === entry);
  assert.ok(task, `Missing entry ${entry}`);
  assert.equal(task.run, command, `${entry} bypasses its MediaGo workflow`);
  assert.deepEqual(
    task.depends,
    [],
    `${entry} would run duplicate preparation`,
  );
  assert.equal(plan.tasks.length, 1, `${entry} would launch extra processes`);
  assert.ok(fs.statSync(task.directory).isDirectory());
}

const taskfile = parse(
  fs.readFileSync(path.join(root, "Taskfile.yml"), "utf8"),
) as {
  tasks: Record<string, { internal?: boolean }>;
};
let count = 0;
for (const [name, task] of Object.entries(taskfile.tasks)) {
  if (task.internal) continue;
  verifyPlan(
    name,
    name === "docs:dev" ? "task --dir .. docs:dev" : `task ${name}`,
  );
  count++;
}

verifyPlan("dev", "task dev:all");
verifyPlan("build", "task build:electron");
for (const [name, command, project] of [
  ["dev", "task --dir ../.. dev:electron", "electron"],
  ["build", "task --dir ../.. build:electron", "electron"],
  ["pack", "task --dir ../.. pack:electron", "electron"],
  ["release", "task --dir ../.. release:electron", "electron"],
  ["build", "pnpm --dir ../.. core:build", "core"],
  ["build", "task --dir ../.. build:extension", "extension"],
  ["dev", "task --dir .. docs:dev", "docs"],
  ["build", "task --dir .. build:docs", "docs"],
]) {
  verifyPlan(name, command, project);
  count++;
}

const synchronization = one(["init", "mise", "--dry-run"]) as {
  changes: unknown[];
};
assert.deepEqual(
  synchronization.changes,
  [],
  "Run one init mise and review the configuration changes",
);
process.stdout.write(
  `Verified ${count + 2} One task plans and an unchanged mise synchronization.\n`,
);
