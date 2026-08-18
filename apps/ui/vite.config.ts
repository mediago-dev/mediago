import fs from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { loadProfileEnv } from "../../scripts/load-profile-env.ts";

const projectRoot = path.resolve(__dirname, "../..");
loadProfileEnv(projectRoot);
const appRoot = path.resolve(projectRoot, "apps/electron/app");
const isWeb = process.env.APP_TARGET === "server";

const packageJsonPath = path.resolve(appRoot, "package.json");
const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: isWeb ? "node_modules/.vite-server" : "node_modules/.vite-electron",
  server: {
    host: true,
    port: isWeb ? 8501 : 8500,
    strictPort: true,
  },
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.APP_TARGET": JSON.stringify(process.env.APP_TARGET),
    "import.meta.env.APP_TD_APPID": JSON.stringify(process.env.APP_TD_APPID),
  },
  plugins: [react(), tailwindcss()],
  envDir: projectRoot,
  envPrefix: [],
  build: {
    outDir: isWeb ? "build/server" : "build/electron",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("zustand") || id.includes("immer")) return "zustand";
          if (
            id.includes("react-dom") ||
            id.includes("react-router-dom") ||
            id.includes("react/")
          )
            return "vendor";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
