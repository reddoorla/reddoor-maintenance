import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  smokeAudit,
  summarizeSmokeFailure,
  formatUnmeasuredSmokeSummary,
  isUnmeasuredSmoke,
  SMOKE_TIMEOUT_MS,
  SMOKE_UNMEASURED_PREFIX,
} from "../../src/audits/smoke.js";
import { SpawnTimeoutError } from "../../src/audits/util/spawn.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");

/** A site checkout with a real `package.json` carrying a `test:smoke` script —
 *  the audit reads this from disk (R3.2) before ever spawning `pnpm`, so the
 *  pass/fail/ENOENT-skip tests below need a real file on disk, not the fake
 *  `/tmp/acme` path (mirrors deps.test.ts's mkdtemp-fixture pattern). Defaults
 *  to an ALREADY-INSTALLED checkout (a node_modules dir) so the suite-behavior
 *  tests skip the install step; pass `installed: false` to exercise the
 *  fresh-clone install path. */
async function siteWithSmokeScript(installed = true): Promise<{ path: string; name: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-smoke-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "acme", scripts: { "test:smoke": "playwright test smoke" } }),
    "utf-8",
  );
  if (installed) await mkdir(join(dir, "node_modules"), { recursive: true });
  return { path: dir, name: "acme" };
}

describe("audits/smoke", () => {
  it("passes when `pnpm test:smoke` exits 0 and writes a fresh checkedAt", async () => {
    const site = await siteWithSmokeScript();
    let cmd = "";
    let args: readonly string[] = [];
    let cwd: string | undefined;
    let timeoutMs: number | undefined;
    let smokePort: string | undefined;
    const spawn: SpawnFn = async (c, a, opts) => {
      cmd = c;
      args = a;
      cwd = opts?.cwd;
      timeoutMs = opts?.timeoutMs;
      smokePort = opts?.env?.REDDOOR_SMOKE_PORT;
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(cmd).toBe("pnpm");
    expect(args).toEqual(["test:smoke"]);
    expect(cwd).toBe(site.path);
    // The suite runs on the shipped budget — Playwright cold-boots the site's dev
    // server AND installs chromium inside it. The value itself is asserted once, in
    // "the budget clears the measured cost of the slowest fleet suite" below.
    expect(timeoutMs).toBe(SMOKE_TIMEOUT_MS);
    // Free-port hardening (the a11y --strictPort treatment): a numeric port is passed.
    expect(Number(smokePort)).toBeGreaterThan(0);
    expect(r.audit).toBe("smoke");
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", checkedAt: NOW.toISOString() });
  });

  it("runs `svelte-kit sync` before the suite so playwright can resolve tsconfig", async () => {
    // playwright.config.ts resolves tsconfig.json, which extends the GENERATED
    // ./.svelte-kit/tsconfig.json. On a fresh clone that file does not exist and
    // no fleet repo has a `prepare` script, so Playwright died loading its config
    // before running a single test — silently failing 9 of 11 live sites.
    const site = await siteWithSmokeScript();
    const calls: Array<{ cmd: string; args: readonly string[] }> = [];
    const spawn: SpawnFn = async (c, a) => {
      calls.push({ cmd: c, args: a });
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    const sync = calls.findIndex((c) => c.args.includes("svelte-kit"));
    const suite = calls.findIndex((c) => c.args.includes("test:smoke"));
    expect(sync, "svelte-kit sync was never spawned").toBeGreaterThanOrEqual(0);
    expect(calls[sync]?.args).toEqual(["exec", "svelte-kit", "sync"]);
    expect(sync).toBeLessThan(suite);
    expect(r.status).toBe("pass");
  });

  it("tolerates a failing sync — a non-SvelteKit site still runs its suite", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async (_c, a) =>
      a.includes("svelte-kit")
        ? { code: 1, stdout: "", stderr: "command not found" }
        : { code: 0, stdout: "", stderr: "" };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", checkedAt: NOW.toISOString() });
  });

  it("does not let a sync ENOENT crash the audit", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async (_c, a) => {
      if (a.includes("svelte-kit")) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("pass");
  });

  it("installs deps (frozen) on a fresh clone before running the suite", async () => {
    const site = await siteWithSmokeScript(false); // no node_modules
    const calls: Array<{ cmd: string; args: readonly string[]; cwd: string | undefined }> = [];
    const spawn: SpawnFn = async (c, a, opts) => {
      calls.push({ cmd: c, args: a, cwd: opts?.cwd });
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(calls[0]?.cmd).toBe("pnpm");
    expect(calls[0]?.args).toEqual(["install", "--frozen-lockfile"]);
    expect(calls[0]?.cwd).toBe(site.path);
    // sync sits between install and the suite: it needs the deps installed, and
    // the suite needs the tsconfig it generates.
    expect(calls[1]?.args).toEqual(["exec", "svelte-kit", "sync"]);
    expect(calls[2]?.args).toEqual(["test:smoke"]);
    expect(r.status).toBe("pass");
  });

  it("skips (no false fail) when the fresh-clone install fails", async () => {
    const site = await siteWithSmokeScript(false);
    const calls: string[][] = [];
    const spawn: SpawnFn = async (_c, a) => {
      calls.push([...a]);
      return { code: 1, stdout: "", stderr: "lockfile drift" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
    // frozen install + one unfrozen retry attempted; the suite never ran.
    expect(calls).toEqual([["install", "--frozen-lockfile"], ["install"]]);
  });

  it("does not install when node_modules already exists", async () => {
    const site = await siteWithSmokeScript(true); // node_modules present
    const calls: string[][] = [];
    const spawn: SpawnFn = async (_c, a) => {
      calls.push([...a]);
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    // sync + suite, no install. sync still runs on a warm checkout: node_modules
    // can exist while .svelte-kit does not, and sync is idempotent.
    expect(calls).toEqual([["exec", "svelte-kit", "sync"], ["test:smoke"]]);
    expect(calls.some((a) => a[0] === "install")).toBe(false);
    expect(r.status).toBe("pass");
  });

  it("fails when the smoke suite exits non-zero", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "1 test failed" });
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(r.details).toEqual({ ok: "fail", checkedAt: NOW.toISOString() });
    expect(r.summary).toMatch(/failed/i);
  });

  // Regression: Playwright writes its failure report to STDOUT; the old code read
  // only stderr.slice(0,200), which on the fleet run captured a `[WebServer] npm
  // warn …` line and threw away WHICH test failed — leaving the operator blind.
  it("surfaces the failing Playwright test + assertion from stdout, not stderr noise", async () => {
    const site = await siteWithSmokeScript();
    const stdout = [
      "Running 2 tests using 1 worker",
      "",
      "  1) [chromium] › tests/smoke/pages.spec.ts:94:1 › 404 page renders the custom error component",
      "",
      "    Error: expect(received).toBe(expected)",
      "    Expected: 404",
      "    Received: 200",
      "",
      "  1 failed",
      "  1 passed (7s)",
    ].join("\n");
    const spawn: SpawnFn = async () => ({
      code: 1,
      stdout,
      stderr: '[WebServer] npm warn Unknown env config "manage-package-manager-versions".',
    });
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(r.summary).toContain("404 page renders the custom error component");
    expect(r.summary).toContain("Received: 200");
    expect(r.summary).toContain("1 failed");
    expect(r.summary).not.toContain("npm warn");
  });

  it("falls back to stderr when stdout carries no reporter output (crash before run)", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async () => ({
      code: 1,
      stdout: "",
      stderr: "Error: Cannot find module '@playwright/test'",
    });
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.summary).toContain("@playwright/test");
  });

  it("skips (no details) when pnpm is not available (ENOENT)", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async () => {
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
  });

  // R3.2: a site whose package.json has no `test:smoke` script has simply not
  // adopted the suite yet — that's a skip (amber/unknown), NOT a fail (red).
  it("skips (no details) when the site's package.json has no test:smoke script", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-smoke-noscript-"));
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({ name: "acme", scripts: { build: "vite build" } }),
      "utf-8",
    );
    let spawnCalled = false;
    const spawn: SpawnFn = async () => {
      spawnCalled = true;
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site: { path: dir, name: "acme" }, spawn, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
    expect(r.summary).toMatch(/test:smoke/i);
    expect(spawnCalled).toBe(false);
  });

  // Same bucket as the missing-script case above: a checkout with no
  // package.json at all can't be told apart from "hasn't adopted the suite".
  it("skips (no details) when the site has no package.json at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "reddoor-smoke-nopkg-"));
    let spawnCalled = false;
    const spawn: SpawnFn = async () => {
      spawnCalled = true;
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site: { path: dir, name: "acme" }, spawn, now: NOW });
    expect(r.status).toBe("skip");
    expect(r.details).toBeUndefined();
    expect(spawnCalled).toBe(false);
  });
});

describe("summarizeSmokeFailure", () => {
  const ESC = String.fromCharCode(27);

  it("strips ANSI color codes from the extracted failure", () => {
    const stdout = [
      `  ${ESC}[31m1) [chromium] › pages.spec.ts:73:5 › / (home) loads with no console errors${ESC}[39m`,
      `    ${ESC}[31mError: console errors on /${ESC}[39m`,
      `  ${ESC}[31m1 failed${ESC}[39m`,
    ].join("\n");
    const out = summarizeSmokeFailure(stdout, "");
    expect(out).not.toContain(ESC);
    expect(out).toContain("home) loads with no console errors");
    expect(out).toContain("1 failed");
  });

  it("returns a sentinel when neither stream carries anything useful", () => {
    expect(summarizeSmokeFailure("", "")).toBe("no reporter output");
  });
});

describe("audits/smoke — a timeout is not a verdict", () => {
  /** The budget must clear the slowest suite the fleet actually runs, with margin.
   *  4m57s is reddoor-website's own `Smoke test` step on a 2-core GitHub runner with
   *  chromium pre-installed and node_modules warm (run 32413378638, 2026-08-20); the
   *  fleet path additionally installs chromium and syncs a fresh clone INSIDE this
   *  budget. The old 5m00s left three seconds and killed two sites for four nights.
   *
   *  This is the single assertion on the shipped constant. */
  it("the budget clears the measured cost of the slowest fleet suite", () => {
    const MEASURED_WARM_RUN_MS = 297_000; // 4m57s, reddoor-website CI
    expect(SMOKE_TIMEOUT_MS).toBeGreaterThan(MEASURED_WARM_RUN_MS * 2);
    // Still well inside fleet-smoke.yml's 90-minute step backstop, so a wedged
    // suite is killed by THIS budget and named, not by the runner and anonymous.
    expect(SMOKE_TIMEOUT_MS).toBeLessThan(90 * 60_000);
  });

  it("reports a timed-out suite as NOT MEASURED rather than a failing suite", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async (_c, a) => {
      if (a[0] === "test:smoke") throw new SpawnTimeoutError("pnpm", SMOKE_TIMEOUT_MS);
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(r.summary.startsWith(SMOKE_UNMEASURED_PREFIX)).toBe(true);
    expect(r.summary).toContain("15m");
    expect(isUnmeasuredSmoke(r)).toBe(true);
  });

  it("leaves `details` unset on a timeout, so Airtable keeps the prior verdict", async () => {
    // The write-back gate is `hasSmokeResult`, which keys on details.checkedAt. A
    // timeout learned nothing, so it must not overwrite a real prior result with a
    // fabricated fail — the same contract the pnpm-install path already honours.
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async (_c, a) => {
      if (a[0] === "test:smoke") throw new SpawnTimeoutError("pnpm", SMOKE_TIMEOUT_MS);
      return { code: 0, stdout: "", stderr: "" };
    };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.details).toBeUndefined();
  });

  it("a suite that RAN and failed is still a normal fail, not NOT MEASURED", async () => {
    // The distinction this whole change rests on: a real finding about the site must
    // not be swallowed by the unmeasured path, or the alarm would cry wolf nightly.
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async (_c, a) =>
      a[0] === "test:smoke"
        ? { code: 1, stdout: "  1) [chromium] › a.spec.ts:1:1 › boom\n  1 failed", stderr: "" }
        : { code: 0, stdout: "", stderr: "" };
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(isUnmeasuredSmoke(r)).toBe(false);
    expect(r.details).toEqual({ ok: "fail", checkedAt: NOW.toISOString() });
  });
});

describe("formatUnmeasuredSmokeSummary", () => {
  // PROVE THE INSTRUMENT: the clean-fleet case comes first and must pass before any
  // FAIL this gate produces is worth acting on. A gate that has only ever fired is an
  // untested assertion — and the alarm it replaces could never fire at all.
  it("emits count=0 for a fleet where every site was measured", () => {
    const out = formatUnmeasuredSmokeSummary([
      { audit: "smoke", site: "caltex", summary: "smoke: suite green" },
      { audit: "smoke", site: "sonder", summary: "smoke: suite failed (exit 1) — 1 failed" },
      { audit: "smoke", site: "espada", summary: "no test:smoke script" },
    ]);
    expect(out).toContain("FLEET_SMOKE_UNMEASURED count=0 sites=");
    expect(out).not.toContain("never measured");
  });

  it("names each unmeasured site and counts them", () => {
    const out = formatUnmeasuredSmokeSummary([
      { audit: "smoke", site: "caltex", summary: "smoke: suite green" },
      { audit: "smoke", site: "reddoor", summary: `${SMOKE_UNMEASURED_PREFIX} — budget` },
      { audit: "smoke", site: "beachfront-dentistry", summary: `${SMOKE_UNMEASURED_PREFIX} — x` },
    ]);
    expect(out).toContain("FLEET_SMOKE_UNMEASURED count=2 sites=reddoor,beachfront-dentistry");
    expect(out).toContain("2 site(s) never measured");
  });

  it("ignores non-smoke audits sharing the pool", () => {
    const out = formatUnmeasuredSmokeSummary([
      { audit: "lighthouse", site: "caltex", summary: `${SMOKE_UNMEASURED_PREFIX} — decoy` },
    ]);
    expect(out).toContain("count=0");
  });
});
