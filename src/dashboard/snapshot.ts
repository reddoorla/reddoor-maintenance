import type { Db } from "../db/client.js";
import { listSites, listSiteSlugs, listAllReports } from "../db/fleet-state.js";
import {
  countUnreplayedDeadLettersBySlug,
  oldestUnreplayedDeadLetterBySlug,
} from "../db/deadletter.js";
import { listAllSubmissions } from "../db/submissions.js";
import { listFleetEvents } from "../db/fleet-events.js";
import { listScreenOutBucketsSince, screenOutsSince } from "../db/screenouts.js";
import { readDigestState, readCockpitRollup } from "../db/digest-state.js";
import { listRecentProspectAudits } from "../db/prospect-audits.js";
import { orElse } from "./or-else.js";
import {
  RECENT_AUDITS_LIMIT,
  RECENT_EVENTS_DAYS,
  RECENT_EVENTS_LIMIT,
  SNAPSHOT_SCREENOUT_DAYS,
  type CockpitSnapshot,
} from "./snapshot-views.js";

/**
 * The cockpit's working set, read once per session (the root layout's load) and
 * kept in the browser, so navigating between its pages needs no server round trip
 * (home base `briefs/2026-10-21-cockpit-one-snapshot.md`). Every page derives its
 * view from this in `snapshot-views.ts`, which mirrors what the per-page loaders in
 * `page-data.ts` read; a parity test runs both against the same database.
 *
 * Every read starts at once, so on a `Db` opened with `batchReads` the whole
 * snapshot is ONE `client.batch` to Turso. Never selected: `sites.header_image`
 * (not in `SITE_COLUMNS`), `prospect_audits.result_json` (the listing's own select)
 * and `reports.rendered_html` (the list reads select only whether one exists).
 *
 * Failures degrade as the page loaders' do. `listSites` is core and throws. A read
 * that some page treats as core (reports on `/s/:slug`, submissions on
 * `/submissions`, the audits list) becomes null here, so that page answers 502
 * while the pages that degrade it still render.
 */
export async function loadCockpitSnapshot(
  db: Db,
  now: Date,
  baseUrl: string,
): Promise<CockpitSnapshot> {
  const [
    sites,
    slugs,
    reports,
    digest,
    rollup,
    recentEvents,
    deadLetters,
    deadLetterOldest,
    submissions,
    screenOuts,
    audits,
  ] = await Promise.all([
    listSites(db),
    listSiteSlugs(db),
    orElse<CockpitSnapshot["reports"]>(() => listAllReports(db), null),
    orElse(() => readDigestState(db), {}),
    orElse(() => readCockpitRollup(db), null),
    orElse(
      () =>
        listFleetEvents(db, {
          sinceIso: new Date(now.getTime() - RECENT_EVENTS_DAYS * 86_400_000).toISOString(),
          limit: RECENT_EVENTS_LIMIT,
        }),
      [],
    ),
    orElse<ReadonlyMap<string, number>>(() => countUnreplayedDeadLettersBySlug(db), new Map()),
    orElse<ReadonlyMap<string, string>>(() => oldestUnreplayedDeadLetterBySlug(db), new Map()),
    orElse<CockpitSnapshot["submissions"]>(() => listAllSubmissions(db), null),
    orElse<CockpitSnapshot["screenOuts"]>(
      () => listScreenOutBucketsSince(db, screenOutsSince(now, SNAPSHOT_SCREENOUT_DAYS)),
      null,
    ),
    orElse<CockpitSnapshot["audits"]>(
      () => listRecentProspectAudits(db, RECENT_AUDITS_LIMIT),
      null,
    ),
  ]);
  const slugById = new Map(slugs.map((r) => [r.id, r.slug]));
  return {
    takenAt: now.toISOString(),
    baseUrl,
    sites: sites.map((site) => ({
      // The editor shows only whether a key is set ("The stored key never reaches
      // the page", lib/site/view.ts), so the key itself never enters the snapshot.
      ...site,
      mailchimpApiKey: site.mailchimpApiKey === null ? null : MAILCHIMP_KEY_REDACTED,
    })),
    slugById,
    reports,
    digest,
    rollup,
    recentEvents,
    deadLetters,
    deadLetterOldest,
    submissions,
    screenOuts,
    audits,
  };
}

/** What a set Mailchimp key reads as in the snapshot. */
export const MAILCHIMP_KEY_REDACTED = "(set)";
