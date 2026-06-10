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
    coverage: {
      // Run via `pnpm test:coverage` (the CI gate); plain `pnpm test` stays fast.
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text-summary"],
      // A regression FLOOR a few points under the current numbers (S 81 / B 70 /
      // F 81 / L 84, 2026-06-10) — headroom for normal refactoring, but a large
      // untested addition trips it. The CLI layer is smoke-tested via subprocess
      // exec (not counted by in-process coverage), so these global numbers run
      // lower than the core's real coverage; raise the floor as it climbs.
      thresholds: {
        statements: 78,
        branches: 67,
        functions: 76,
        lines: 80,
      },
    },
  },
});
