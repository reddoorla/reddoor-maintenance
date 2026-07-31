import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn } from "./util/spawn.js";
import { siteLabel } from "../util/site.js";
import { findFreePort } from "../util/free-port.js";

/** Persisted smoke verdict: the site's own `test:smoke` suite passed or failed. */
export type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

// ESC built from a char code so the regex source carries no literal control
// char (keeps `no-control-regex` quiet). Matches the SGR color codes Playwright emits.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/**
 * Distill the actionable failure out of a Playwright run. The list reporter writes
 * its failing-test list — "N) [chromium] › file:line › title" followed by the
 * Error/Expected/Received head — plus an "N failed" tally to STDOUT; STDERR only
 * carries dev-server/npm noise (e.g. `[WebServer] npm warn …`). So summarize stdout
 * first (which test, and why) and fall back to stderr only when stdout yielded
 * nothing useful (a crash before the reporter ran). Capped so a runaway report
 * can't bloat the CLI/Airtable summary.
 */
export function summarizeSmokeFailure(stdout: string, stderr: string): string {
  const lines = stdout
    .replace(ANSI, "")
    .split("\n")
    .map((l) => l.trim());
  const failing: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    // The list reporter numbers each failing test: "1) [chromium] › file › title".
    if (/^\d+\)\s/.test(line)) {
      failing.push(line);
      // Grab the next 3 NON-BLANK lines — the Error:/Expected:/Received: head.
      // Skip blanks without spending the budget, and stop at the next failing block.
      let taken = 0;
      for (let j = i + 1; j < lines.length && taken < 3; j++) {
        const next = lines[j];
        if (!next) continue;
        if (/^\d+\)\s/.test(next)) break;
        failing.push(next);
        taken++;
      }
      break;
    }
  }
  const tally = lines.find((l) => l !== undefined && /\b\d+\s+failed\b/.test(l));
  const distilled = [tally, ...failing].filter(Boolean).join(" | ");
  if (distilled) return distilled.slice(0, 300);
  const err = stderr.replace(ANSI, "").trim();
  return err ? err.slice(0, 200) : "no reporter output";
}

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

  // `playwright.config.ts` resolves `tsconfig.json`, which extends the GENERATED
  // `./.svelte-kit/tsconfig.json`. A fresh clone has no such file, and no fleet
  // repo carries a `prepare` script to write one, so Playwright aborted while
  // loading its own config — before a single test ran:
  //
  //   Error: Failed to load tsconfig file at <site>/tsconfig.json:
  //   Failed to resolve "extends" path "./.svelte-kit/tsconfig.json"
  //
  // That silently failed 9 of 11 live sites (found 2026-07-31). It stayed hidden
  // because fleet-smoke.yml gates on FLEET_WRITE_SUMMARY, which counts rows
  // WRITTEN, not rows passing — a failing site is still written, so the workflow
  // reported success.
  //
  // Fixing it here rather than per-repo: one change covers every site, and
  // AUTONOMY.md makes multi-repo mutations a human-reviewed operation. `sync` is
  // idempotent and fast, so run it unconditionally instead of probing for the
  // file. Best-effort by design — a non-SvelteKit site or a missing binary must
  // never downgrade a working suite; let the suite itself be the verdict.
  try {
    await spawn("pnpm", ["exec", "svelte-kit", "sync"], {
      cwd: site.path,
      timeoutMs: 60_000,
    });
  } catch {
    // ENOENT (no pnpm) or a spawn failure — the `test:smoke` call below reports
    // the real outcome, including its own ENOENT skip.
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
    summary: `smoke: suite failed (exit ${raw.code}) — ${summarizeSmokeFailure(raw.stdout, raw.stderr)}`,
    details: { ok: "fail", checkedAt } satisfies SmokeDetails,
  };
}
