import { defineConfig } from "vite";

// Preact's JSX through esbuild's automatic runtime: no plugin needed.
export default defineConfig({
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  build: { target: "es2020" },
  server: { port: 5174 },
  preview: { port: 4174 },
});
