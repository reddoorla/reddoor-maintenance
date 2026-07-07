import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { smokeAudit } from "../../src/audits/smoke.js";
import type { SpawnFn } from "../../src/audits/util/spawn.js";

const NOW = new Date("2026-07-06T00:00:00.000Z");

/** A site checkout with a real `package.json` carrying a `test:smoke` script —
 *  the audit reads this from disk (R3.2) before ever spawning `pnpm`, so the
 *  pass/fail/ENOENT-skip tests below need a real file on disk, not the fake
 *  `/tmp/acme` path (mirrors deps.test.ts's mkdtemp-fixture pattern). */
async function siteWithSmokeScript(): Promise<{ path: string; name: string }> {
  const dir = await mkdtemp(join(tmpdir(), "reddoor-smoke-"));
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({ name: "acme", scripts: { "test:smoke": "playwright test smoke" } }),
    "utf-8",
  );
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
    // 5-min budget — Playwright cold-boots the site's dev server + installs chromium.
    expect(timeoutMs).toBe(5 * 60_000);
    // Free-port hardening (the a11y --strictPort treatment): a numeric port is passed.
    expect(Number(smokePort)).toBeGreaterThan(0);
    expect(r.audit).toBe("smoke");
    expect(r.status).toBe("pass");
    expect(r.details).toEqual({ ok: "pass", checkedAt: NOW.toISOString() });
  });

  it("fails when the smoke suite exits non-zero", async () => {
    const site = await siteWithSmokeScript();
    const spawn: SpawnFn = async () => ({ code: 1, stdout: "", stderr: "1 test failed" });
    const r = await smokeAudit({ site, spawn, now: NOW });
    expect(r.status).toBe("fail");
    expect(r.details).toEqual({ ok: "fail", checkedAt: NOW.toISOString() });
    expect(r.summary).toMatch(/failed/i);
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
