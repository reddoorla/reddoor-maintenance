import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export type A11yRoute = { path: string; name: string };

export const a11yRoutes: A11yRoute[] = [
  { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
  { path: "/dev/animate-in", name: "animate-in demo" },
];

// Routes smoke-loaded for client-side (hydration) errors only — NOT axe-scanned.
// Catches the class of bug where build + SSR succeed but client hydration throws
// and blanks the page (data-dynamiq 2026-06-09: a Svelte 4->5 `run()` referenced
// a `$state` declared after it → TDZ ReferenceError on hydrate). `/` is the one
// route every site has; real routes carry a11y debt we don't gate on here, so we
// assert only that they don't crash on hydrate.
export const smokeRoutes: A11yRoute[] = [{ path: "/", name: "home" }];

// R1.1 (health-gate): the central `smoke` audit (src/audits/smoke.ts) allocates
// a free port and passes it as REDDOOR_SMOKE_PORT so a zombie vite already
// squatting the default 5173 can't silently hijack the run and green a stale
// build. The per-site R1.1 config template honors it, but sites whose
// playwright.config.ts merely re-exports this shared base (pre-R1.1 adopters
// the smoke-suite recipe flags-but-never-rewrites) would otherwise ignore it —
// so honor it here too and every re-exporter inherits the port binding on its
// next package bump. Unset (local `pnpm test:smoke`) → the fixed 5173.
const smokePort = process.env.REDDOOR_SMOKE_PORT;
const port = smokePort || "5173";

// NOTE: default export only — sites consume this as `import base from
// "@reddoorla/maintenance/configs/playwright-a11y"` (or re-export the default).
// The old `playwrightA11yConfig` named alias had zero importers and was removed.
const playwrightA11yConfig: PlaywrightTestConfig = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Portable across pnpm and npm sites — pnpm respects `npm run` too.
    // `--strictPort` only when a port was explicitly allocated: fail loudly
    // rather than let vite drift to a free port the baseURL doesn't point at.
    command: smokePort
      ? `npm run vite:dev -- --port ${smokePort} --strictPort`
      : "npm run vite:dev",
    url: `http://localhost:${port}/dev/a11y-fixtures`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
