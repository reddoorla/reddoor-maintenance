import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import { siteLabel } from "../util/site.js";
import { findFreePort } from "../util/free-port.js";

/** Persisted smoke verdict: the site's own `test:smoke` suite passed or failed. */
export type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

/**
 * R3.2: a site whose `package.json` has no `test:smoke` script (or no
 * `package.json` at all) has simply not adopted the suite yet — treat both
 * the same as "can't tell", NOT as a failure. Read BEFORE spawning so a
 * not-yet-adopted site never pays a real `pnpm` invocation.
 */
async function hasTestSmokeScript(sitePath: string): Promise<boolean> {
  try {
    const raw = await readFile(join(sitePath, "package.json"), "utf-8");
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return typeof pkg.scripts?.["test:smoke"] === "string";
  } catch {
    return false;
  }
}

async function hasNodeModules(sitePath: string): Promise<boolean> {
  try {
    await access(join(sitePath, "node_modules"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Run a site's own `pnpm test:smoke` suite in its checkout and reduce the exit
 * code to a verdict. Clone-based: the CLI (`prepareFleetSites`) has already put a
 * real checkout at `site.path` (smoke is NOT in CHECKOUT_FREE_AUDITS). Reuses the
 * a11y harness treatment: a 5-min timeout (Playwright cold-boots the dev server +
 * installs chromium) and a freshly-allocated free port passed as REDDOOR_SMOKE_PORT
 * so the site's smoke playwright config can bind `--port <n> --strictPort` and stay
 * immune to a zombie-vite squatting 5173 (see free-port.ts).
 *
 * A site that hasn't adopted `test:smoke` yet (no script, or no package.json) →
 * skip (R3.2), same bucket as `pnpm` itself being unavailable. exit 0 → pass;
 * non-zero → fail (only reached once the suite is known to exist). A skip never
 * carries details, so the Airtable writer preserves the prior verdict.
 */
export async function smokeAudit(ctx: AuditContext): Promise<AuditResult> {
  const spawn = ctx.spawn ?? defaultSpawn;
  const site = ctx.site;
  const label = siteLabel(site);
  const now = ctx.now ?? new Date();
  const checkedAt = now.toISOString();

  if (!(await hasTestSmokeScript(site.path))) {
    return {
      audit: "smoke",
      site: label,
      status: "skip",
      summary: "no test:smoke script",
    };
  }

  // The nightly fleet producer runs against FRESH clones (cloneIfNeeded does a
  // bare `git clone`, no install), so the site's own playwright/vite aren't on
  // PATH yet — without this, `pnpm test:smoke` exits non-zero and we'd persist a
  // FALSE Smoke OK=fail. Install only when node_modules is absent (a local
  // already-installed checkout is untouched). Any install failure → skip (NO
  // details), so the Airtable writer preserves the prior verdict rather than
  // recording a false fail. Mirrors deps-outdated.ts.
  if (!(await hasNodeModules(site.path))) {
    let install;
    try {
      install = await spawn("pnpm", ["install", "--frozen-lockfile"], {
        cwd: site.path,
        timeoutMs: 5 * 60_000,
      });
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
        return { audit: "smoke", site: label, status: "skip", summary: "pnpm not available" };
      }
      throw err;
    }
    if (install.code !== 0) {
      // Lockfile drift shouldn't red a site — retry unfrozen once (the clone is
      // ephemeral, so a rewritten lockfile is harmless). Still failing → skip.
      const retry = await spawn("pnpm", ["install"], { cwd: site.path, timeoutMs: 5 * 60_000 });
      if (retry.code !== 0) {
        return {
          audit: "smoke",
          site: label,
          status: "skip",
          summary: `smoke: pnpm install failed (exit ${retry.code}) — deps unavailable`,
        };
      }
    }
  }

  const port = await findFreePort();

  let raw;
  try {
    raw = await spawn("pnpm", ["test:smoke"], {
      cwd: site.path,
      env: { ...process.env, REDDOOR_SMOKE_PORT: String(port) },
      // Playwright on a cold tree installs chromium, boots the site's dev server,
      // and runs the smoke specs — the shared 30s default starves it (mirrors a11y).
      timeoutMs: 5 * 60_000,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return { audit: "smoke", site: label, status: "skip", summary: "pnpm not available" };
    }
    throw err;
  }

  if (raw.code === 0) {
    return {
      audit: "smoke",
      site: label,
      status: "pass",
      summary: "smoke: suite green",
      details: { ok: "pass", checkedAt } satisfies SmokeDetails,
    };
  }
  return {
    audit: "smoke",
    site: label,
    status: "fail",
    summary: `smoke: suite failed (exit ${raw.code})${
      raw.stderr ? ` — ${raw.stderr.slice(0, 200)}` : ""
    }`,
    details: { ok: "fail", checkedAt } satisfies SmokeDetails,
  };
}
