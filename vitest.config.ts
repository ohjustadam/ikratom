import { defineConfig } from "vitest/config";
import path from "node:path";
import { MEASURED, NOT_MEASURED } from "./scripts/lib/coverage-surface.mjs";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "src/**/__tests__/*.test.ts"],
    globals: false,
    pool: "forks",            // server actions touch fetch / process.env
    testTimeout: 15000,
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      // Off unless --coverage is passed, so `npm run verify` stays the ~9s
      // loop AGENTS.md tells contributors to use. `npm run coverage` opts in.
      provider: "v8",
      // text-summary for the log, json-summary for scripts/report-coverage.mjs.
      // No html: nobody opens it in CI and it writes hundreds of files.
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage",
      // The surface, declared once — see scripts/lib/coverage-surface.mjs for
      // why it is the logic layer and not the whole tree. Files matching
      // `include` are reported whether or not a test loaded them, so an
      // untouched module shows up at 0% instead of not showing up at all.
      include: MEASURED,
      exclude: NOT_MEASURED,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
