import { openBase, readAirtableConfig } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, updateGitHubSignals } from "../../reports/airtable/websites.js";
import type { Site } from "../../types.js";
import { collectGitHubSignals } from "../../audits/github-signals.js";
import { makeGitHub } from "../../github/gh.js";
import {
  formatFleetWriteSummary,
  type FleetWriteResult,
} from "../../audits/write-audits-to-airtable.js";
import { detectSignalEvents, fleetSweptEvent } from "../../audits/fleet-event-detectors.js";
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import type { FleetEvent } from "../../db/fleet-events.js";

/** Exit code for a fleet github-signals run. Exit 1 when failures are the
 *  MAJORITY of the fleet (`failed > written`), not only on a total wipeout —
 *  a run where 11/12 repos failed but 1 wrote should still signal an outage.
 *  All-success or a minority of flakes (e.g. 1/12 failed) stays exit 0. The
 *  no-token clean-skip returns 0 separately (before any probe runs). */
export function githubSignalsExitCode(written: number, failed: number): number {
  return failed > written ? 1 : 0;
}

/** `github-signals --fleet --write-airtable`: sweep every repo-backed site for its
 *  Renovate-failing count + default-branch CI state + last-commit date, write each
 *  row serially (Airtable ~5 req/sec), and emit FLEET_WRITE_SUMMARY for CI. A
 *  missing fleet token is a clean skip (local runs), not a failure. */
export async function runGitHubSignalsCommand(opts: {
  fleet?: boolean | undefined;
  writeAirtable?: boolean | undefined;
}): Promise<{ output: string; code: number }> {
  if (!opts.fleet || !opts.writeAirtable) {
    return { output: "github-signals currently supports only --fleet --write-airtable", code: 2 };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) {
    return {
      output: "github-signals skipped: no RENOVATE_TOKEN/GH_TOKEN (fleet read) configured.",
      code: 0,
    };
  }
  const base = openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const gh = makeGitHub({ token });
  const sites: Site[] = websites.map((w) => ({
    path: "",
    name: w.name,
    meta: {},
    ...(w.gitRepo ? { gitRepo: w.gitRepo } : {}),
  }));

  const skipped: string[] = [];
  const rows = await collectGitHubSignals(
    sites,
    {
      openPullRequests: (r) => gh.openPullRequests(r),
      defaultBranchStatus: (r) => gh.defaultBranchStatus(r),
    },
    ({ repo }) => skipped.push(repo),
  );

  const sweptAt = new Date().toISOString();
  const result: FleetWriteResult = { written: [], failed: [] };
  const byRepo = new Map(websites.filter((w) => w.gitRepo).map((w) => [w.gitRepo, w]));
  const events: FleetEvent[] = [];
  const sweptMs = Date.parse(sweptAt);
  const since24h = new Date(sweptMs - 24 * 60 * 60 * 1000).toISOString();
  // Serial: Airtable's ~5 req/sec limit (matches writeFleetAuditsToAirtable).
  for (const row of rows) {
    const target = byRepo.get(row.repo);
    if (!target) {
      result.failed.push({ slug: siteSlug(row.site), error: "no Websites row matched" });
      continue;
    }
    try {
      await updateGitHubSignals(base, target.id, {
        renovateFailingCis: row.renovateFailingCis,
        ciState: row.ciState,
        lastCommitAt: row.lastCommitAt,
        sweptAt,
      });
      result.written.push({
        siteName: target.name,
        writes: [{ audit: "github-signals", counts: row }],
      });
      // Fleet-activity events for this repo: merged Renovate PRs since the last sweep
      // (watermark = the row's prior GitHub Signals At, else a 24h fallback) + a
      // CI-recovered transition. A PR-fetch hiccup drops only this repo's PR events.
      const since = target.githubSignalsAt ?? since24h;
      let merged: Awaited<ReturnType<typeof gh.mergedRenovatePullRequests>> = [];
      try {
        merged = await gh.mergedRenovatePullRequests(row.repo, since);
      } catch {
        // PR list unavailable this run — skip pr_automerged for this repo, keep ci_recovered
      }
      events.push(...detectSignalEvents(target, row, merged, sweptAt));
    } catch (e) {
      result.failed.push({ slug: siteSlug(row.site), error: (e as Error).message });
    }
  }
  for (const repo of skipped) result.failed.push({ slug: repo, error: "probe failed (skipped)" });

  events.push(fleetSweptEvent("github-signals", result.written.length, sweptAt));
  await recordFleetEventsBestEffort(events, new Date());

  // Exit non-zero when failures are the MAJORITY of the fleet, not only on a
  // total wipeout. A run where 11/12 repos failed but 1 wrote used to return 0,
  // masking a large outage. The nightly cron step is `continue-on-error`, so a
  // non-zero here is an operator-visibility signal, not a red build.
  return {
    output: formatFleetWriteSummary(result),
    code: githubSignalsExitCode(result.written.length, result.failed.length),
  };
}
