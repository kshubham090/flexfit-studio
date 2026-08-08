import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15000,
    // Characterization tests share one SQLite file; keep runs sequential
    // to avoid write-lock contention/races between test files.
    fileParallelism: false,
    globalSetup: ["./src/test/global-setup.ts"],
    setupFiles: ["./src/test/setup-env.ts"],
  },
});
