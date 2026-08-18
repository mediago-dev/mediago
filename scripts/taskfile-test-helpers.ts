import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { onTestFinished } from "vitest";

export type TaskCommand =
  | { kind: "cmd"; text: string }
  | { kind: "task"; task: string };

export interface TaskFixture {
  directory: string;
  taskfilePath: string;
  taskName: string;
}

export function asRecord(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a mapping`);
  }
  return value as Record<string, unknown>;
}

export function taskCommands(
  tasks: Record<string, unknown>,
  name: string,
): TaskCommand[] {
  const commands = task(tasks, name).cmds;
  if (commands === undefined) return [];
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

export function taskDependencies(
  tasks: Record<string, unknown>,
  name: string,
): string[] {
  const dependencies = task(tasks, name).deps;
  if (dependencies === undefined) return [];
  if (!Array.isArray(dependencies)) {
    throw new Error(`task ${name} must declare a deps array`);
  }
  return dependencies.map((dependency, index) => {
    if (typeof dependency === "string") return dependency;
    const mapping = asRecord(
      dependency,
      `task ${name} dependency ${index + 1}`,
    );
    if (typeof mapping.task !== "string") {
      throw new Error(`task ${name} dependency ${index + 1} must name a task`);
    }
    return mapping.task;
  });
}

export function stringArray(value: unknown, context: string): string[] {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error(`${context} must be a string array`);
  }
  return value as string[];
}

export function createTaskFixture(contents: unknown): TaskFixture {
  const directory = fs.mkdtempSync(path.join(tmpdir(), "mediago-task-graph-"));
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }));
  const taskfilePath = path.join(directory, "Taskfile.yml");
  fs.writeFileSync(taskfilePath, stringify(contents), "utf8");
  return { directory, taskfilePath, taskName: "probe" };
}

export function runTaskFixture(
  fixture: TaskFixture,
  environment: NodeJS.ProcessEnv,
  dry = false,
): { output: string; status: number | null } {
  const result = spawnSync(
    "task",
    [
      "--color=false",
      ...(dry ? ["--dry"] : []),
      "--taskfile",
      fixture.taskfilePath,
      fixture.taskName,
    ],
    {
      cwd: fixture.directory,
      encoding: "utf8",
      env: sanitizedEnvironment(environment),
      timeout: 30_000,
    },
  );
  if (result.error) throw result.error;
  return {
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

function task(
  tasks: Record<string, unknown>,
  name: string,
): Record<string, unknown> {
  return asRecord(tasks[name], `task ${name}`);
}

function sanitizedEnvironment(overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ["HOME", "PATH", "PATHEXT", "SystemRoot", "TEMP", "TMP"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}
