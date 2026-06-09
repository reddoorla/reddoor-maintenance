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

export const playwrightA11yConfig: PlaywrightTestConfig = defineConfig({
  testDir: "tests",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:5173",
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
    command: "npm run vite:dev",
    url: "http://localhost:5173/dev/a11y-fixtures",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
