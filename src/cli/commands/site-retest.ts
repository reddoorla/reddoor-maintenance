// src/cli/commands/site-retest.ts
//
// P1-88: `reddoor-maint site-retest <slug>` re-tests one site during the day. It reads
// the site's current reasons from Turso through the same item list the /s/<slug> page
// shows, runs only the audits behind them (src/retest/site-retest.ts), writes that site's
// row alone, and reports which reasons cleared. The `site-retest.yml` workflow runs this,
// and the cockpit's Re-test button dispatches that workflow.
//
// It never runs security or deps, and imports nothing that dispatches Renovate (P0-1):
// tests/retest/site-retest-no-renovate.test.ts pins both.
import type { WebsiteRow } from "../../fleet/site-row.js";
import { siteSlug } from "../../fleet/site-row.js";
import { buildSiteAlarmContext } from "../../dashboard/fleet-cockpit.js";
import {
  assertRetestSlug,
  parseRetestOnly,
  retestPlanFromItems,
  type RetestPlan,
  type RetestableAudit,
} from "../../retest/site-retest.js";
import type { AuditCommandOptions } from "./audit.js";

export type SiteRetestOptions = {
  /** Override the plan with these audits (re-testable ones only). */
  only?: string;
  /** Print the plan and stop: no audit runs, nothing is written. */
  dryRun?: boolean;
  workdir?: string;
};

export type SiteRetestDeps = {
  readRoster?: () => Promise<WebsiteRow[]>;
  runAudit?: (opts: AuditCommandOptions) => Promise<{ output: string; writeBackFailed: boolean }>;
  now?: () => Date;
};

/** The item urls are never shown here; the collectors still need a base. */
const NO_BASE = "https://cockpit.invalid";

function planFor(rows: WebsiteRow[], now: Date): RetestPlan {
  const items = rows.flatMap((r) => buildSiteAlarmContext(r, [], NO_BASE, now).items);
  return retestPlanFromItems(items);
}

export async function runSiteRetestCommand(
  slugArg: string | undefined,
  opts: SiteRetestOptions,
  deps: SiteRetestDeps = {},
): Promise<{ output: string; code: number }> {
  const slug = assertRetestSlug(slugArg);
  const forced = parseRetestOnly(opts.only);
  const now = deps.now ?? (() => new Date());
  const readRoster =
    deps.readRoster ??
    (async () => {
      const { readFleetRoster } = await import("../../fleet/roster.js");
      return readFleetRoster();
    });
  const runAudit =
    deps.runAudit ??
    (async (o: AuditCommandOptions) => {
      const { runAuditCommand } = await import("./audit.js");
      return runAuditCommand(undefined, o);
    });

  const rowsOf = (roster: WebsiteRow[]) => roster.filter((r) => siteSlug(r.name) === slug);
  const rows = rowsOf(await readRoster());
  if (rows.length === 0) {
    throw Object.assign(new Error(`site-retest: no fleet site has the slug ${slug}`), {
      exitCode: 2,
    });
  }

  const before = planFor(rows, now());
  const audits: RetestableAudit[] = forced ?? before.audits;
  const out: string[] = [
    `RETEST site=${slug} audits=${audits.length > 0 ? audits.join(",") : "none"}${forced ? " (--only)" : ""}`,
  ];
  for (const r of before.reasons) out.push(`  reason: ${r.title} -> ${r.audit}`);
  for (const t of before.untouched) out.push(`  not re-tested: ${t}`);

  if (audits.length === 0) {
    out.push(`nothing to re-test for ${slug}: no current reason a re-test can clear`);
    return { output: out.join("\n"), code: 0 };
  }
  if (opts.dryRun) {
    out.push("dry run: no audit ran, nothing was written");
    return { output: out.join("\n"), code: 0 };
  }

  const run = await runAudit({
    fleet: "turso",
    site: slug,
    only: audits.join(","),
    writeBack: true,
    retest: true,
    concurrency: "1",
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
  });
  out.push("", run.output, "");

  // Read the row back: a reason the run's audits cover is cleared when it is gone.
  const after = planFor(rowsOf(await readRoster()), now());
  const ran = new Set<string>(audits);
  const stillKeys = new Set(after.reasons.filter((r) => ran.has(r.audit)).map((r) => r.key));
  const covered = before.reasons.filter((r) => ran.has(r.audit));
  const cleared = covered.filter((r) => !stillKeys.has(r.key));
  const still = after.reasons.filter((r) => ran.has(r.audit));
  for (const r of cleared) out.push(`  cleared: ${r.title}`);
  for (const r of still) out.push(`  still failing: ${r.title}`);
  out.push(
    `RETEST_RESULT site=${slug} cleared=${cleared.length} still=${still.length} write=${run.writeBackFailed ? "failed" : "ok"}`,
  );
  // A failing verdict is the answer, not a fault: only a failed write reds the run.
  return { output: out.join("\n"), code: run.writeBackFailed ? 1 : 0 };
}
