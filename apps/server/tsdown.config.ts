import { type ChildProcessByStdio, spawn } from "node:child_process";
import path, { dirname } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";
import { loadProfileEnv } from "../../scripts/load-profile-env.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
loadProfileEnv(projectRoot);
const isDev = process.env.NODE_ENV === "development";

class NodeApp {
  process: ChildProcessByStdio<null, Readable, Readable> | null = null;

  start() {
    const args = [path.resolve(__dirname, "./build/index.js")];

    const child = spawn("node", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.process = child;

    child.stdout.on("data", (data) => {
      process.stdout.write(String(data));
    });

    child.stderr.on("data", (data) => {
      process.stderr.write(String(data));
    });
  }

  restart() {
    this.kill();
    this.start();
  }

  kill() {
    if (this.process?.pid) {
      if (process.platform === "win32") {
        process.kill(this.process.pid);
      } else {
        spawn("kill", ["-9", String(this.process.pid)]);
      }
      this.process = null;
    }
  }
}

const app = new NodeApp();

export default defineConfig({
  outDir: "build",
  dts: false,
  fixedExtension: false,
  shims: true,
  deps: {
    alwaysBundle: [/.*/],
    onlyBundle: false,
    neverBundle: ["@mediago/core", "@mediago/deps"],
  },
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV || "production",
    ),
    "process.env.APP_TARGET": JSON.stringify("server"),
  },
  hooks: {
    "build:done": () => {
      if (isDev) {
        app.restart();
      }
    },
  },
});
