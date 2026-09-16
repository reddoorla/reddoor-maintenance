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

  it("uses a portable webServer command bound to the config's own port", () => {
    const server = playwrightA11yConfig.webServer as { command: string; url: string };
    const port = new URL(server.url).port;
    // `npm run ...` works on both pnpm and npm sites.
    expect(server.command).toBe(`npm run vite:dev -- --port ${port} --strictPort`);
    expect(playwrightA11yConfig.use?.baseURL).toBe(`http://localhost:${port}`);
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

    it("allocates its OWN free port when unset, never the shared default 5173", async () => {
      // #524: locally REDDOOR_SMOKE_PORT is unset, and the old code fell back to
      // the fixed 5173 — the same port a dev server sits on. Combined with
      // reuseExistingServer that silently tested whatever was already there.
      const mod = await importWithSmokePort(undefined);
      const server = mod.default.webServer as { command: string; url: string };
      const port = Number(new URL(server.url).port);
      expect(port).not.toBe(5173);
      expect(port).toBeGreaterThan(1023);
      expect(port).toBeLessThan(65536);
      expect(server.command).toBe(`npm run vite:dev -- --port ${port} --strictPort`);
      expect(mod.default.use?.baseURL).toBe(`http://localhost:${port}`);
    });

    // #524: the actual defect. `reuseExistingServer: !process.env.CI` made a
    // LOCAL run reuse anything answering the probe URL — a dev server left open,
    // or one whose working tree changed under it after a checkout. The probe asks
    // "does this URL respond?", never "is this the code I am about to test?", so
    // it fails both directions: false red against a stale server (beachfront
    // 2026-08-12, misdiagnosed as a macOS-vs-Linux difference) and false green
    // when a passing run was served by an old build.
    it("never reuses an already-running server, even outside CI", async () => {
      const prevCi = process.env.CI;
      delete process.env.CI;
      try {
        const mod = await importWithSmokePort(undefined);
        expect(
          (mod.default.webServer as { reuseExistingServer: boolean }).reuseExistingServer,
        ).toBe(false);
        const withPort = await importWithSmokePort("41234");
        expect(
          (withPort.default.webServer as { reuseExistingServer: boolean }).reuseExistingServer,
        ).toBe(false);
      } finally {
        if (prevCi !== undefined) process.env.CI = prevCi;
      }
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

  it("emulates reduced motion so scroll-driven actionability checks don't flake", async () => {
    // Upstreamed from reddoor-starter's local override (2026-09-01): every site
    // gates scroll-behavior on prefers-reduced-motion, so a smooth-scrolling
    // test run is a fleet-wide flake source, not a per-site quirk.
    const mod = await import("../../src/configs/playwright-a11y.js");
    // Under contextOptions, not top-level `use` — see the config comment.
    expect(mod.default.use?.contextOptions?.reducedMotion).toBe("reduce");
  });
});

/**
 * gateServer (#700). This config starts the system under test for every site
 * smoke suite in the fleet, and it started `npm run vite:dev` unconditionally —
 * so the production bundle was built in CI and then never opened by a browser.
 * Hydration, code splitting and asset hashing are exactly what dev replaces,
 * and a stylesheet is even fetched under a different CSP directive in each.
 *
 * The switch is opt-in, and the trap it has to avoid is the naive version of
 * itself: the readiness probe points at `/dev/a11y-fixtures`, a route that is
 * not guaranteed to exist in a production build. A flip that keeps that probe
 * turns a working gate into one that times out for 120 seconds on every
 * opted-in site.
 */
describe("configs/playwright-a11y — gateServer (#700)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.REDDOOR_GATE_SERVER;
    vi.resetModules();
  });

  async function importWithGate(gate: string | undefined, port = "41234") {
    vi.resetModules();
    vi.stubEnv("REDDOOR_SMOKE_PORT", port);
    if (gate === undefined) {
      vi.stubEnv("REDDOOR_GATE_SERVER", "");
      delete process.env.REDDOOR_GATE_SERVER;
    } else {
      vi.stubEnv("REDDOOR_GATE_SERVER", gate);
    }
    return await import("../../src/configs/playwright-a11y.js");
  }

  type Server = { command: string; url: string; timeout: number; reuseExistingServer: boolean };

  // The grant side: a site that has not opted in must get byte-identical
  // behaviour, because every fleet site is one until it says otherwise.
  it("defaults to the dev server, probing the fixture route", async () => {
    const mod = await importWithGate(undefined);
    const server = mod.default.webServer as Server;
    expect(server.command).toBe("npm run vite:dev -- --port 41234 --strictPort");
    expect(server.url).toBe("http://localhost:41234/dev/a11y-fixtures");
    expect(server.timeout).toBe(120_000);
  });

  it("builds and serves the production bundle when the site opts in", async () => {
    const mod = await importWithGate("preview");
    const server = mod.default.webServer as Server;
    expect(server.command).toBe("npm run build && npm run preview -- --port 41234 --strictPort");
  });

  // The trap, asserted directly.
  it("never probes a /dev/* route under preview", async () => {
    const mod = await importWithGate("preview");
    const server = mod.default.webServer as Server;
    expect(server.url).toBe("http://localhost:41234/");
    expect(server.url).not.toContain("/dev/");
  });

  it("gives the preview server a budget that covers a production build", async () => {
    const mod = await importWithGate("preview");
    const server = mod.default.webServer as Server;
    // A vite boot is ~10-20s; a SvelteKit build with prerendering is minutes.
    expect(server.timeout).toBeGreaterThanOrEqual(300_000);
  });

  it("keeps the port binding and the never-reuse rule under preview", async () => {
    const mod = await importWithGate("preview");
    const server = mod.default.webServer as Server;
    const probed = new URL(server.url).port;
    expect(server.command).toContain(`--port ${probed}`);
    expect(server.command).toContain("--strictPort");
    expect(server.reuseExistingServer).toBe(false);
    expect(mod.default.use?.baseURL).toBe(`http://localhost:${probed}`);
  });

  it("falls back to dev on an unrecognized value rather than shelling it", async () => {
    const mod = await importWithGate("prod");
    const server = mod.default.webServer as Server;
    expect(server.command).toBe("npm run vite:dev -- --port 41234 --strictPort");
  });

  describe("readGateServer", () => {
    it("reads package.json#reddoor.gateServer from a directory", async () => {
      const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
      const { tmpdir } = await import("node:os");
      const { join } = await import("node:path");
      const mod = await import("../../src/configs/playwright-a11y.js");
      const dir = await mkdtemp(join(tmpdir(), "reddoor-gate-"));
      try {
        // No package.json at all — a bare checkout must not throw here, because
        // this runs at Playwright config-evaluation time in every worker.
        expect(mod.readGateServer(dir)).toBe("dev");
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({ name: "site", reddoor: { gateServer: "preview" } }),
        );
        expect(mod.readGateServer(dir)).toBe("preview");
        await writeFile(
          join(dir, "package.json"),
          JSON.stringify({ name: "site", reddoor: { gateServer: "prod" } }),
        );
        expect(mod.readGateServer(dir)).toBe("dev");
        await writeFile(join(dir, "package.json"), "{ not json");
        expect(mod.readGateServer(dir)).toBe("dev");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  });
});
