import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 120_000,
    reporters: ["default"],
    // Rebuild dist/ before the suite if src changed, so the CLI tests that exec
    // dist/cli/bin.js never run against stale output. See vitest.global-setup.ts.
    globalSetup: ["./vitest.global-setup.ts"],
  },
});
