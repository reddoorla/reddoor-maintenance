import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { defaultSpawn, isSpawnTimeout } from "./util/spawn.js";
import { siteLabel } from "../util/site.js";
import { findFreePort } from "../util/free-port.js";

/** Persisted smoke verdict: the site's own `test:smoke` suite passed or failed. */
export type SmokeDetails = { ok: "pass" | "fail"; checkedAt: string };

/** Wall-clock budget for a site's own `test:smoke` run.
 *
 *  Measured, not guessed. reddoor-website's `Smoke test` step takes **4m57s** on a
 *  2-core GitHub runner with chromium already installed and `node_modules` warm
 *  (run 32413378638, 2026-08-20). The old budget was 5m00s — three seconds of
 *  headroom — and the fleet path is strictly heavier than that step: the site's
 *  `test:smoke` is `playwright install chromium && playwright test`, so the browser
 *  install lands INSIDE this budget, on a fresh clone, after `svelte-kit sync`.
 *
 *  So the budget was already effectively negative, and the medtech release (#133)
 *  pushed the suite past it: reddoor was killed at 5m03s and beachfront-dentistry
 *  at 5m04s — both the wall, not their suites.
 *
 *  15 minutes is ~3x the measured suite, leaving room for a site to grow a quarter's
 *  worth of specs before anyone has to think about this again, while still killing a
 *  genuinely wedged run far inside fleet-smoke.yml's 90-minute step backstop. */
export const SMOKE_TIMEOUT_MS = 15 * 60_000;

/** Summary prefix for a smoke run that produced no verdict at all.
 *
 *  A timeout is NOT a failing suite — it means the measurement never happened. The
 *  two must stay distinguishable: a failing suite is a finding about the site, an
 *  unmeasured one is a finding about this audit. Exported so the CI summary keys on
 *  the same constant the audit stamps, instead of re-describing it in a grep that
 *  can drift out of sync. */
export const SMOKE_UNMEASURED_PREFIX = "smoke: NOT MEASURED";

/** True when a smoke audit never reached a verdict (timed out mid-suite).
 *
 *  Deliberately distinct from {@link hasSmokeResult}: an unmeasured run carries no
 *  `details`, so the Airtable writer already preserves the prior verdict rather than
 *  recording a false fail. That is correct — and it is also why nothing surfaced it.
 *  This predicate is what makes it visible to CI. */
export function isUnmeasuredSmoke(result: { audit: string; summary: string }): boolean {
  return result.audit === "smoke" && result.summary.startsWith(SMOKE_UNMEASURED_PREFIX);
}

/** Render the "did every site actually get measured?" line for CI.
 *
 *  Emits `FLEET_SMOKE_UNMEASURED count=N sites=a,b` on EVERY run, count=0 included —
 *  deliberately, and for the same reason `FLEET_WRITE_SUMMARY` does. A gate that only
 *  prints on failure cannot be told apart from a gate that never ran, so the workflow
 *  treats an ABSENT line as a crash and a `count=0` line as a proven-clean sweep. That
 *  distinction is the whole point: this alarm exists because the previous one was
 *  structurally incapable of firing, and an alarm nobody has seen pass is not evidence.
 *
 *  Only `smoke` results are considered; other audits in the same pool are ignored. */
export function formatUnmeasuredSmokeSummary(
  results: ReadonlyArray<{ audit: string; site: string; summary: string }>,
): string {
  const unmeasured = results.filter(isUnmeasuredSmoke).map((r) => r.site);
  let out = "";
  if (unmeasured.length > 0) {
    out += `⚠ ${unmeasured.length} site(s) never measured: ${unmeasured.join("; ")}\n`;
  }
  out += `FLEET_SMOKE_UNMEASURED count=${unmeasured.length} sites=${unmeasured.join(",")}`;
  return out;
}

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
 * a11y harness treatment: a {@link SMOKE_TIMEOUT_MS} budget (Playwright cold-boots the
 * dev server + installs chromium) and a freshly-allocated free port passed as REDDOOR_SMOKE_PORT
 * so the site's smoke playwright config can bind `--port <n> --strictPort` and stay
 * immune to a zombie-vite squatting 5173 (see free-port.ts).
 *
 * A site that hasn't adopted `test:smoke` yet (no script, or no package.json) →
 * skip (R3.2), same bucket as `pnpm` itself being unavailable. exit 0 → pass;
 * non-zero → fail (only reached once the suite is known to exist). A skip never
 * carries details, so the Airtable writer preserves the prior verdict.
 *
 * A suite that exceeds the budget is a THIRD outcome: it produced no verdict at all,
 * so it is reported as {@link SMOKE_UNMEASURED_PREFIX} and likewise carries no details.
 * That keeps Airtable on the prior value (right — nothing was learned) while letting
 * fleet-smoke.yml red the run, which is what the write-back gate alone cannot do.
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
      timeoutMs: SMOKE_TIMEOUT_MS,
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT" || /ENOENT/.test(String(err))) {
      return { audit: "smoke", site: label, status: "skip", summary: "pnpm not available" };
    }
    // A timeout is not a verdict. Rethrowing sent it to runOneAudit's catch-all,
    // which stringified it into `smoke: unexpected error — Error: spawn timeout…`:
    // technically a `fail`, carrying no details, so Airtable correctly preserved the
    // prior verdict — and therefore kept showing GREEN for a site that had not been
    // measured in days, while the workflow (gated on write-back) exited 0. Name it
    // instead, and leave `details` unset so the write-back behavior is unchanged.
    if (isSpawnTimeout(err)) {
      const minutes = Math.round(SMOKE_TIMEOUT_MS / 60_000);
      return {
        audit: "smoke",
        site: label,
        status: "fail",
        summary: `${SMOKE_UNMEASURED_PREFIX} — \`pnpm test:smoke\` exceeded its ${minutes}m budget; no verdict, prior Airtable value preserved`,
      };
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
