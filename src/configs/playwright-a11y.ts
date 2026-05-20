import { defineConfig, devices, type PlaywrightTestConfig } from "@playwright/test";

export type A11yRoute = { path: string; name: string };

export const a11yRoutes: A11yRoute[] = [
  { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
  { path: "/dev/animate-in", name: "animate-in demo" },
];

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
    command: "pnpm vite:dev",
    url: "http://localhost:5173/dev/a11y-fixtures",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

export default playwrightA11yConfig;
