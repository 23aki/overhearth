import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: { port: 5173 },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        watch: resolve(import.meta.dirname, "watch.html"),
      },
    },
  },
});
