import { resolve } from "node:path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * Builds the town view MCP App into one self-contained HTML file. The MCP server serves it as
 * `ui://overhearth/town.html`, so the output goes straight into the backend package.
 */
export default defineConfig({
  root: resolve(import.meta.dirname, "town"),
  plugins: [viteSingleFile()],
  build: {
    target: "es2022",
    outDir: resolve(import.meta.dirname, "../backend/src/overhearth/ui"),
    emptyOutDir: false,
    rollupOptions: { input: resolve(import.meta.dirname, "town/town.html") },
  },
});
