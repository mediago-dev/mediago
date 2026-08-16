import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@mediago/shared-common",
        replacement: path.resolve(
          repositoryRoot,
          "packages/shared/common/src/index.ts",
        ),
      },
      {
        find: /^@\//,
        replacement: `${path.resolve(repositoryRoot, "apps/ui/src")}/`,
      },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 10_000,
    hookTimeout: 10_000,
    maxWorkers: 4,
    reporters: ["default"],
    include: [
      "apps/**/*.test.ts",
      "packages/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    exclude: [
      "**/node_modules/**",
      "**/build/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/release/**",
    ],
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage/ts",
      reporter: ["text", "html", "json-summary"],
      include: [
        "apps/**/*.{ts,tsx}",
        "packages/**/*.{ts,tsx}",
        "scripts/**/*.ts",
      ],
      exclude: [
        "**/*.d.ts",
        "**/*.test.ts",
        "**/i18n/resources/**",
        "**/{build,dist,release}/**",
      ],
    },
  },
});
