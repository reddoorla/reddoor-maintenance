import { describe, it, expect, vi, afterEach } from "vitest";
import playwrightA11yConfig, { a11yRoutes } from "../../src/configs/playwright-a11y.js";

// The config captures REDDOOR_SMOKE_PORT at import time (Playwright imports the
// config fresh per run), so the env-var behavior is only observable through a
// fresh dynamic import.
async function importWithSmokePort(port: string | undefined) {
  vi.resetModules();
  if (port === undefined) {
    vi.stubEnv("REDDOOR_SMOKE_PORT", "");
    delete process.env.REDDOOR_SMOKE_PORT;
  } else {
    vi.stubEnv("REDDOOR_SMOKE_PORT", port);
  }
  return await import("../../src/configs/playwright-a11y.js");
}

describe("configs/playwright-a11y", () => {
  it("exports the canonical starter routes", () => {
    expect(a11yRoutes).toEqual([
      { path: "/dev/a11y-fixtures", name: "a11y fixtures" },
      { path: "/dev/animate-in", name: "animate-in demo" },
    ]);
  });

  it("uses port 5173 and a portable webServer command", () => {
    expect(playwrightA11yConfig.use?.baseURL).toBe("http://localhost:5173");
    expect(playwrightA11yConfig.webServer).toMatchObject({
      // `npm run ...` works on both pnpm and npm sites.
      command: "npm run vite:dev -- --port 5173 --strictPort",
      url: "http://localhost:5173/dev/a11y-fixtures",
    });
  });

  it("runs the chromium project only (matches starter)", () => {
    expect(playwrightA11yConfig.projects).toHaveLength(1);
    expect(playwrightA11yConfig.projects?.[0]?.name).toBe("chromium");
  });

  // R1.1 health-gate reach: the central smoke audit allocates a free port and
  // passes REDDOOR_SMOKE_PORT. Sites whose playwright.config.ts merely
  // re-exports this shared base (pre-R1.1 adopters the smoke-suite recipe
  // flags but never rewrites) must inherit the port binding from the base
  // itself, or a vite squatting 5173 silently gets tested instead of the site
  // (observed live: caltex's suite ran against erp-industrial's dev server).
  describe("REDDOOR_SMOKE_PORT (R1.1 port binding)", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
    });

    it("binds baseURL, readiness probe, and --strictPort to the allocated port", async () => {
      const mod = await importWithSmokePort("41234");
      expect(mod.default.use?.baseURL).toBe("http://localhost:41234");
      expect(mod.default.webServer).toMatchObject({
        command: "npm run vite:dev -- --port 41234 --strictPort",
        url: "http://localhost:41234/dev/a11y-fixtures",
      });
    });

    it("falls back to the fixed 5173, still port-bound, when unset", async () => {
      const mod = await importWithSmokePort(undefined);
      expect(mod.default.use?.baseURL).toBe("http://localhost:5173");
      expect(mod.default.webServer).toMatchObject({
        command: "npm run vite:dev -- --port 5173 --strictPort",
        url: "http://localhost:5173/dev/a11y-fixtures",
      });
    });

    it("pins vite to whatever port the probe polls, allocated or not", async () => {
      // The bug this closes was the two drifting apart: the probe pinned to a
      // port while vite was free to pick another. Asserted as a relationship
      // rather than two literals, so a future edit cannot reintroduce the gap
      // by changing one side.
      for (const port of ["41234", undefined]) {
        const mod = await importWithSmokePort(port);
        const server = mod.default.webServer as {
          command: string;
          url: string;
        };
        const probed = new URL(server.url).port;
        expect(server.command).toContain(`--port ${probed}`);
        expect(server.command).toContain("--strictPort");
        expect(mod.default.use?.baseURL).toBe(`http://localhost:${probed}`);
      }
    });
  });
});
