// src/cli/commands/site-retest.ts
//
// P1-88: `reddoor-maint site-retest <slug>` re-tests one site during the day. It reads
// the site's current reasons from Turso through the same item list the /s/<slug> page
// shows, runs only the audits behind them (src/retest/site-retest.ts), writes that site's
// row alone, and reports which reasons cleared. The `site-retest.yml` workflow runs this,
// and the cockpit's Re-test button dispatches that workflow.
//
// It never runs security or deps, and imports nothing that dispatches Renovate (P0-1):
// tests/build/site-retest-workflow.test.ts pins both.
import type { WebsiteRow } from "../../fleet/site-row.js";
import { siteSlug } from "../../fleet/site-row.js";
import { buildSiteAlarmContext } from "../../dashboard/fleet-cockpit.js";
import {
  assertRetestSlug,
  parseRetestOnly,
  RETESTABLE_AUDITS,
  retestCannotMeasure,
  retestMeasured,
  retestPlanForRow,
  retestVerdict,
  SLUG_PATTERN,
  type RetestPlan,
  type RetestableAudit,
} from "../../retest/site-retest.js";
import type { AuditCommandOptions } from "./audit.js";
import type { FleetWriteResult } from "../../audits/write-audits.js";

export type SiteRetestOptions = {
  /** Override the plan with these audits (re-testable ones only). */
  only?: string;
  /** Print the plan and stop: no audit runs, nothing is written. */
  dryRun?: boolean;
  workdir?: string;
};

export type SiteRetestDeps = {
  readRoster?: () => Promise<WebsiteRow[]>;
  /** Every site's stored `sites.slug`, by id: the cockpit's /s/<slug> address. Defaults to
   *  Turso; when only `readRoster` is injected, to none (the roster's own slugs alone). */
  readStoredSlugs?: () => Promise<Array<{ id: string; slug: string }>>;
  runAudit?: (opts: AuditCommandOptions) => Promise<{
    output: string;
    writeBackFailed: boolean;
    writeResult?: FleetWriteResult;
  }>;
  now?: () => Date;
};

/** The item urls are never shown here; the collectors still need a base. */
const NO_BASE = "https://cockpit.invalid";

function planFor(rows: WebsiteRow[], now: Date): RetestPlan {
  const plans = rows.map((r) =>
    retestPlanForRow(r, buildSiteAlarmContext(r, [], NO_BASE, now).items),
  );
  const wanted = new Set(plans.flatMap((p) => p.audits));
  return {
    audits: RETESTABLE_AUDITS.filter((a) => wanted.has(a)),
    reasons: plans.flatMap((p) => p.reasons),
    untouched: plans.flatMap((p) => p.untouched),
  };
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

  const readStoredSlugs =
    deps.readStoredSlugs ??
    (deps.readRoster
      ? async () => []
      : async () => {
          const { listSiteSlugs } = await import("../../db/fleet-state.js");
          const { openDb, readDbConfig } = await import("../../db/client.js");
          const db = await openDb(readDbConfig());
          try {
            return await listSiteSlugs(db);
          } finally {
            await db.destroy();
          }
        });

  // The slug may be the stored one (the cockpit's /s/<slug> address, which a rename
  // leaves alone) or the one the roster derives from the Name; either finds the row
  // (#1887). Two rows answering to one slug would have their plans unioned and the
  // write-back would pick one of them, so that is refused (#1889).
  const stored = new Map((await readStoredSlugs()).map((r) => [r.id, r.slug]));
  const roster = await readRoster();
  const matches = roster.filter((r) => siteSlug(r.name) === slug || stored.get(r.id) === slug);
  if (matches.length === 0) {
    throw Object.assign(new Error(`site-retest: no fleet site has the slug ${slug}`), {
      exitCode: 2,
    });
  }
  if (matches.length > 1) {
    throw Object.assign(
      new Error(
        `site-retest: ${matches.length} fleet sites answer to the slug ${slug} (${matches
          .map((r) => JSON.stringify(r.name))
          .join(", ")}); re-test refused`,
      ),
      { exitCode: 2 },
    );
  }
  const site = matches[0]!;
  // The audit run and its write-back find the site by the roster's slug, so that slug
  // must name this row alone too.
  const runSlug = siteSlug(site.name);
  const sharing = roster.filter((r) => siteSlug(r.name) === runSlug);
  if (sharing.length > 1) {
    throw Object.assign(
      new Error(
        `site-retest: ${sharing.length} fleet sites share the roster slug ${runSlug} (${sharing
          .map((r) => JSON.stringify(r.name))
          .join(", ")}); re-test refused`,
      ),
      { exitCode: 2 },
    );
  }
  if (!SLUG_PATTERN.test(runSlug)) {
    throw Object.assign(
      new Error(`site-retest: ${JSON.stringify(site.name)} has no usable roster slug`),
      { exitCode: 2 },
    );
  }
  // `--only` names audits outright, so it is held to what the run can measure for this
  // row, as the plan is: anything else is refused with its reason (#1889).
  if (forced) {
    const refused = forced.flatMap((a) => {
      const why = retestCannotMeasure(site, a);
      return why === null ? [] : [`${a} (${why})`];
    });
    if (refused.length > 0) {
      throw Object.assign(
        new Error(`site-retest: --only cannot measure ${refused.join(", ")} for ${slug}`),
        { exitCode: 2 },
      );
    }
  }
  const rows = [site];
  const rowsOf = (roster: WebsiteRow[]) => roster.filter((r) => r.id === site.id);

  const before = planFor(rows, now());
  const audits: RetestableAudit[] = forced ?? before.audits;
  const out: string[] = [
    `RETEST site=${runSlug} audits=${audits.length > 0 ? audits.join(",") : "none"}${forced ? " (--only)" : ""}`,
  ];
  for (const r of before.reasons)
    out.push(
      (audits as string[]).includes(r.audit)
        ? `  reason: ${r.title} -> ${r.audit}`
        : `  not re-tested: ${r.title} (--only left out ${r.audit})`,
    );
  for (const t of before.untouched) out.push(`  not re-tested: ${t}`);

  if (audits.length === 0) {
    out.push(`nothing to re-test for ${runSlug}: no current reason a re-test can clear`);
    return { output: out.join("\n"), code: 0 };
  }
  if (opts.dryRun) {
    out.push("dry run: no audit ran, nothing was written");
    return { output: out.join("\n"), code: 0 };
  }

  const run = await runAudit({
    fleet: "turso",
    site: runSlug,
    only: audits.join(","),
    writeBack: true,
    retest: true,
    concurrency: "1",
    ...(opts.workdir !== undefined ? { workdir: opts.workdir } : {}),
  });
  out.push("", run.output, "");

  // An audit the write-back did not measure for this site left the old verdict in the
  // row: its reasons were not re-tested, and the run says so and goes red (review round 1).
  const measured = (audit: string): boolean =>
    run.writeResult !== undefined && retestMeasured(run.writeResult, runSlug, audit);
  const unmeasured = audits.filter((a) => !measured(a));

  // Read the row back: a reason a measured audit covers is cleared when it is gone.
  const afterRead = rowsOf(await readRoster());
  const after = planFor(afterRead, now());
  const ran = new Set<string>(audits.filter(measured));
  const stillKeys = new Set(after.reasons.filter((r) => ran.has(r.audit)).map((r) => r.key));
  // Gone from the list is not enough: the row must hold a measured pass for it (round 2).
  // A measured fail is still failing under another reason (a cert at 8 days read 7, a
  // function-health fail that is now the CMS), and a null verdict was not measured.
  const verdict = (key: string) => {
    const r = afterRead[0];
    return r === undefined ? null : retestVerdict(key, r);
  };
  const gone = before.reasons.filter((r) => ran.has(r.audit) && !stillKeys.has(r.key));
  const cleared = gone.filter((r) => verdict(r.key) === "pass");
  const changed = gone.filter((r) => verdict(r.key) === "fail");
  const nulled = gone.filter((r) => verdict(r.key) === null);
  const still = after.reasons.filter((r) => ran.has(r.audit));
  const skipped = before.reasons.filter((r) => !ran.has(r.audit) && audits.includes(r.audit));
  const notMeasured = [...skipped, ...nulled];
  for (const r of cleared) out.push(`  cleared: ${r.title}`);
  for (const r of changed) out.push(`  still failing: ${r.title} (it now reads as another reason)`);
  for (const r of still) out.push(`  still failing: ${r.title}`);
  for (const r of skipped) out.push(`  not measured: ${r.title} (${r.audit} measured nothing)`);
  for (const r of nulled)
    out.push(
      `  not measured: ${r.title} (${r.audit} wrote no pass: the reason left the list without one)`,
    );
  for (const a of unmeasured)
    out.push(`::error::site-retest: ${a} measured nothing for ${runSlug}`);
  const write = run.writeBackFailed
    ? "failed"
    : unmeasured.length > 0 || nulled.length > 0
      ? "unmeasured"
      : "ok";
  out.push(
    `RETEST_RESULT site=${runSlug} cleared=${cleared.length} still=${still.length} unmeasured=${notMeasured.length} unmeasured_audits=${unmeasured.length} write=${write}`,
  );
  // A failing verdict is the answer, not a fault: a failed write, or an audit that
  // measured nothing, reds the run.
  return { output: out.join("\n"), code: write === "ok" ? 0 : 1 };
}
