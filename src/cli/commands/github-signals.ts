import { openBase, readAirtableConfig, type AirtableBase } from "../../reports/airtable/client.js";
import { listWebsites, siteSlug, updateGitHubSignals } from "../../reports/airtable/websites.js";
import type { Site } from "../../types.js";
import { collectGitHubSignals } from "../../audits/github-signals.js";
import { makeGitHub, type GitHub } from "../../github/gh.js";
import {
  formatFleetWriteSummary,
  type FleetWriteResult,
} from "../../audits/write-audits-to-airtable.js";
import { detectSignalEvents, fleetSweptEvent } from "../../audits/fleet-event-detectors.js";
import { recordFleetEventsBestEffort } from "../../audits/fleet-events-writer.js";
import type { FleetEvent } from "../../db/fleet-events.js";
import type { HealthMirror } from "../../audits/health-mirror.js";

/** The slice of the GitHub client this sweep actually probes. */
type GhProbes = Pick<
  GitHub,
  "openPullRequests" | "defaultBranchStatus" | "mergedRenovatePullRequests"
>;

/** Injectable wiring for {@link runGitHubSignalsCommand}. Every default is the
 *  real fleet path; tests override to reach the per-row write+mirror loop —
 *  the hand-rolled `makeHealthMirrorBestEffort()` call made that loop
 *  untestable (no test could prove a mirror throw stays out of `failed`, that
 *  the counters increment the right way round, or that the mirror sees the
 *  same payload Airtable got). Same seam shape as
 *  `writeFleetAuditsToAirtable`'s `mirror` argument. */
export type GitHubSignalsDeps = {
  /** Airtable base (default: real creds via readAirtableConfig). */
  openBase: () => AirtableBase;
  /** GitHub probe client for the fleet token (default: makeGitHub). */
  makeGh: (token: string) => GhProbes;
  /** Turso mirror factory (default: makeHealthMirrorBestEffort — null without
   *  libSQL creds, leaving the Airtable sweep byte-for-byte unchanged). */
  makeMirror: () => Promise<HealthMirror | null>;
  /** Fleet-activity recorder (default: recordFleetEventsBestEffort). */
  recordEvents: (events: FleetEvent[], now: Date) => Promise<void>;
};

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
export async function runGitHubSignalsCommand(
  opts: {
    fleet?: boolean | undefined;
    writeAirtable?: boolean | undefined;
  },
  deps: Partial<GitHubSignalsDeps> = {},
): Promise<{ output: string; code: number }> {
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
  const base = deps.openBase ? deps.openBase() : openBase(readAirtableConfig());
  const websites = await listWebsites(base);
  const gh: GhProbes = deps.makeGh ? deps.makeGh(token) : makeGitHub({ token });
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
  // Phase 3 dual-write (#539): mirror each row's written FieldSet into
  // site_health. Null when libSQL creds are absent — the Airtable sweep
  // proceeds exactly as before. (Dynamic import so the no-mirror path never
  // loads the db client.)
  const makeMirror =
    deps.makeMirror ??
    (async () => {
      const { makeHealthMirrorBestEffort } = await import("../../audits/health-mirror.js");
      return makeHealthMirrorBestEffort();
    });
  const mirror = await makeMirror();
  const result: FleetWriteResult = {
    written: [],
    failed: [],
    ...(mirror ? { mirrored: 0, mirrorFailed: 0, mirrorMissed: 0 } : {}),
  };
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
      const ghFields = await updateGitHubSignals(base, target.id, {
        renovateFailingCis: row.renovateFailingCis,
        ciState: row.ciState,
        lastCommitAt: row.lastCommitAt,
        sweptAt,
      });
      if (mirror) {
        // Count, never throw: a Turso blip must not move an Airtable-written
        // row into `failed` (that would red the sweep via githubSignalsExitCode
        // on a fleet-wide mirror outage). A 0-row match (site not yet imported)
        // is a miss, not a mirror — see FleetWriteResult.mirrorMissed.
        try {
          if (await mirror(target.id, ghFields)) {
            result.mirrored = (result.mirrored ?? 0) + 1;
          } else {
            result.mirrorMissed = (result.mirrorMissed ?? 0) + 1;
          }
        } catch (e) {
          result.mirrorFailed = (result.mirrorFailed ?? 0) + 1;
          console.error(`[health-mirror] ${target.name}: ${(e as Error).message}`);
        }
      }
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
  await (deps.recordEvents ?? recordFleetEventsBestEffort)(events, new Date());

  // Exit non-zero when failures are the MAJORITY of the fleet, not only on a
  // total wipeout. A run where 11/12 repos failed but 1 wrote used to return 0,
  // masking a large outage. The nightly cron step is `continue-on-error`, so a
  // non-zero here is an operator-visibility signal, not a red build.
  return {
    output: formatFleetWriteSummary(result),
    code: githubSignalsExitCode(result.written.length, result.failed.length),
  };
}
