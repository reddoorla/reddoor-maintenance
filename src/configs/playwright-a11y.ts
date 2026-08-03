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
    //
    // `--port ... --strictPort` in BOTH cases. It used to be applied only when
    // REDDOOR_SMOKE_PORT allocated one, on the reasoning that we should "fail
    // loudly rather than let vite drift to a free port the baseURL doesn't
    // point at" — but that argument covers the unset case just as well. 5173 is
    // equally a fixed port that `baseURL` and the readiness probe below are
    // pinned to, and vite left to itself drifts off it whenever something else
    // holds it.
    //
    // The symptom that exposed this: a non-vite process on 5173 sends vite to
    // 5174 while the probe keeps polling 5173, so the run dies on
    // "Timed out waiting 120000ms from config.webServer" — 120 seconds of
    // nothing, naming neither the port nor the squatter. With --strictPort it
    // is an immediate "Port 5173 is already in use".
    //
    // This does NOT overlap with `reuseExistingServer`: that check runs first,
    // so a dev server already serving the probe URL is still reused and the
    // command never executes. --strictPort only bites when 5173 is held by
    // something that is not the server under test, which is exactly the case
    // worth failing on.
    command: `npm run vite:dev -- --port ${port} --strictPort`,
    url: `http://localhost:${port}/dev/a11y-fixtures`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
