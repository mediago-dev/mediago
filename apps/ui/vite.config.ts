import fs from "node:fs/promises";
import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

const projectRoot = path.resolve(__dirname, "../..");
const appRoot = path.resolve(projectRoot, "apps/electron/app");
const isWeb = process.env.APP_TARGET === "server";

const packageJsonPath = path.resolve(appRoot, "package.json");
const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf-8"));

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    host: true,
    port: 8500,
    strictPort: true,
  },
  define: {
    "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    "import.meta.env.APP_TARGET": JSON.stringify(process.env.APP_TARGET),
  },
  plugins: [react(), tailwindcss()],
  envDir: projectRoot,
  envPrefix: "APP",
  build: {
    outDir: isWeb ? "build/server" : "build/electron",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("antd") || id.includes("@ant-design")) return "antd";
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
