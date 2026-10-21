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
import type { SubmissionRow } from "../reports/submission-row.js";
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
 * Failures degrade as the page loaders' do, page by page, and none fails the whole
 * snapshot. A read that some page cannot do without (the sites everywhere but
 * `/audits`, the reports on `/s/:slug`, the submissions on `/submissions`, the
 * audits list) becomes null here, so that page answers 502 while the pages that
 * do without it still render. Every read that fell back is named in `gaps`, and
 * the cockpit then makes the next navigation a full load, which reads again, as
 * every navigation did before the snapshot.
 */
export async function loadCockpitSnapshot(
  db: Db,
  now: Date,
  baseUrl: string,
): Promise<CockpitSnapshot> {
  const gaps: string[] = [];
  /** `orElse`, and the read's name in `gaps` when it fell back. */
  const read = <T>(name: string, f: () => Promise<T>, fallback: T): Promise<T> =>
    orElse(f, GAP as T).then((v) => {
      if (v !== (GAP as T)) return v;
      gaps.push(name);
      return fallback;
    });
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
    read("sites", () => listSites(db), null),
    read("sites", () => listSiteSlugs(db), null),
    read<CockpitSnapshot["reports"]>("reports", () => listAllReports(db), null),
    read("digest", () => readDigestState(db), {}),
    read("rollup", () => readCockpitRollup(db), null),
    read(
      "events",
      () =>
        listFleetEvents(db, {
          sinceIso: new Date(now.getTime() - RECENT_EVENTS_DAYS * 86_400_000).toISOString(),
          limit: RECENT_EVENTS_LIMIT,
        }),
      [],
    ),
    read<ReadonlyMap<string, number>>(
      "dead letters",
      () => countUnreplayedDeadLettersBySlug(db),
      new Map(),
    ),
    read<ReadonlyMap<string, string>>(
      "dead letter ages",
      () => oldestUnreplayedDeadLetterBySlug(db),
      new Map(),
    ),
    read("submissions", () => listAllSubmissions(db), null),
    read<CockpitSnapshot["screenOuts"]>(
      "screen-outs",
      () => listScreenOutBucketsSince(db, screenOutsSince(now, SNAPSHOT_SCREENOUT_DAYS)),
      null,
    ),
    read<CockpitSnapshot["audits"]>(
      "audits",
      () => listRecentProspectAudits(db, RECENT_AUDITS_LIMIT),
      null,
    ),
  ]);
  return {
    takenAt: now.toISOString(),
    baseUrl,
    gaps: [...new Set(gaps)],
    // Both reads or neither: a slug map without its sites (or the reverse) would
    // 404 a site that exists.
    sites:
      sites === null || slugs === null
        ? null
        : sites.map((site) => ({
            // The editor shows only whether a key is set ("The stored key never
            // reaches the page", lib/site/view.ts), so the key never enters the
            // snapshot.
            ...site,
            mailchimpApiKey: site.mailchimpApiKey === null ? null : MAILCHIMP_KEY_REDACTED,
          })),
    slugById: new Map((slugs ?? []).map((r) => [r.id, r.slug])),
    reports,
    digest,
    rollup,
    recentEvents,
    deadLetters,
    deadLetterOldest,
    submissions: submissions === null ? null : submissions.rows.map(cutFreeText),
    rawSubmissionEnums: submissions?.raw ?? new Map(),
    screenOuts,
    audits,
  };
}

/** `read`'s marker for a read that fell back. */
const GAP = Symbol("gap");

/** The longest any one free-text field of a lead may be in the snapshot. Visitors
 *  write these, through every client site's public form, and nothing at ingest
 *  bounds them; the snapshot rides in every cockpit page, so one oversized post
 *  must not be able to push every page past the function's response limit. The
 *  longest real message on 2026-10-21 was 7,924 characters (681 rows), so no real
 *  lead is cut. */
export const SNAPSHOT_FIELD_MAX = 20_000;

const FREE_TEXT = [
  "name",
  "email",
  "phone",
  "message",
  "extraFields",
  "sourceUrl",
  "utm",
  "spamReason",
  "bounceMessage",
] as const satisfies readonly (keyof SubmissionRow)[];

function cutFreeText(row: SubmissionRow): SubmissionRow {
  let out = row;
  for (const field of FREE_TEXT) {
    const value = row[field];
    if (typeof value !== "string" || value.length <= SNAPSHOT_FIELD_MAX) continue;
    if (out === row) out = { ...row };
    const more = value.length - SNAPSHOT_FIELD_MAX;
    (out as Record<string, unknown>)[field] =
      `${value.slice(0, SNAPSHOT_FIELD_MAX)} … [${more} more characters cut by the cockpit; the whole lead is in Turso]`;
  }
  return out;
}

/** What a set Mailchimp key reads as in the snapshot. */
export const MAILCHIMP_KEY_REDACTED = "(set)";
