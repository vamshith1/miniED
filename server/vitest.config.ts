import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Prepares a separate test database (migrations + an empty set of tables) once per run.
    globalSetup: ["tests/global-setup.ts"],
    // Sets the environment before any app module is imported.
    setupFiles: ["tests/setup-env.ts"],
    // Every test file shares one database, so run files one after another.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
