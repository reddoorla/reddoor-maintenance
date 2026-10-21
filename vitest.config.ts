import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { coverageConfigDefaults, defineConfig } from "vitest/config";

/**
 * Every core on a CI runner, vitest's default elsewhere. In run mode vitest
 * starts `availableParallelism() - 1` workers, which is 3 on the 4-core
 * ubuntu-latest runner, and the suite is throughput-bound: on 2026-10-19 the
 * coverage run on 4 cores took 205–229 s with 3 workers and 167–170 s with 4
 * (#1507). A laptop keeps the default, because other sessions share its cores.
 */
export function maxWorkersFor(env: NodeJS.ProcessEnv): number | undefined {
  return env.CI ? availableParallelism() : undefined;
}

const workers = maxWorkersFor(process.env);

// The cockpit's projects run Svelte without SvelteKit's plugin, so `$app/*`
// resolves to test stand-ins (#1589).
const appAlias = {
  "$app/navigation": fileURLToPath(
    new URL("./cockpit/tests/_helpers/app-navigation.ts", import.meta.url),
  ),
};

export default defineConfig({
  test: {
    // The cockpit (#582) gets two projects of its own, so its Svelte compile
    // and browser resolution never reach the rest of the suite. `*.ssr.test.ts`
    // server-renders pages in node, as SvelteKit serves them. `*.dom.test.ts`
    // mounts them in happy-dom under the "browser" export condition, which is
    // where Svelte's `mount` lives; that condition would hand libsql,
    // node-html-parser and the rest their browser builds.
    projects: [
      { extends: true, test: { name: "node", include: ["tests/**/*.test.ts"] } },
      {
        extends: true,
        plugins: [svelte({ configFile: false })],
        resolve: { alias: appAlias },
        test: { name: "cockpit-ssr", include: ["cockpit/tests/**/*.ssr.test.ts"] },
      },
      {
        extends: true,
        plugins: [svelte({ configFile: false })],
        resolve: { conditions: ["browser"], alias: appAlias },
        test: {
          name: "cockpit-dom",
          include: ["cockpit/tests/**/*.dom.test.ts"],
          environment: "happy-dom",
        },
      },
    ],
    environment: "node",
    testTimeout: 120_000,
    ...(workers === undefined ? {} : { maxWorkers: workers }),
    // Hooks default to 10 s: on 2026-09-15 two local workers sharing 8 CPUs with CI lost whole files to a beforeAll timeout.
    hookTimeout: 120_000,
    reporters: ["default"],
    // Rebuild dist/ before the suite if src changed, so the CLI tests that exec
    // dist/cli/bin.js never run against stale output. See vitest.global-setup.ts.
    globalSetup: ["./vitest.global-setup.ts"],
    // Opt-in only: with REDDOOR_TIME_TRAVEL_DAYS set, the whole suite runs on a clock
    // shifted that far forward, so a test that secretly depends on "today" fails in the
    // scheduled time-travel run instead of rotting into a red `main`. Absent the env var
    // this list is empty and `pnpm test` behaves exactly as before.
    // See vitest.time-travel-setup.ts and .github/workflows/time-travel.yml.
    // `!== undefined`, deliberately, not truthiness: setting the var AT ALL means you meant
    // to time-travel, so an empty or malformed value must reach the setup file and throw.
    // Gating on truthiness instead would let `REDDOOR_TIME_TRAVEL_DAYS=""` skip the shim and
    // report a green run on the real clock — the hollow green this whole guard exists to
    // prevent, arriving through the guard itself.
    setupFiles: [
      "./vitest.no-credentials-setup.ts",
      ...(process.env.REDDOOR_TIME_TRAVEL_DAYS !== undefined
        ? ["./vitest.time-travel-setup.ts"]
        : []),
    ],
    coverage: {
      // Run via `pnpm test:coverage` (the CI gate); plain `pnpm test` stays fast.
      provider: "v8",
      // `include` makes vitest 4 count EVERY matching src file — even ones no
      // test imports (they score 0%) — by default (the old `all` flag is gone).
      // So a new untested file pulls the global number down and trips the floor;
      // the floor isn't limited to the test import graph. (Verified: the number
      // is identical with/without forcing all, i.e. all src is already counted.)
      include: ["src/**/*.ts"],
      // The gated live Prismic runner is pure I/O against the Migration API —
      // no unit test can exercise it, so keep it out of the coverage graph.
      exclude: [...coverageConfigDefaults.exclude, "src/blux/emit/run-migration.ts"],
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
