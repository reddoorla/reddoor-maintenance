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
    submissions: submissions === null ? null : boundLeadText(submissions.rows),
    rawSubmissionEnums: submissions?.raw ?? new Map(),
    screenOuts,
    audits,
  };
}

/** `read`'s marker for a read that fell back. */
const GAP = Symbol("gap");

/** How much lead text the snapshot may carry, as the bytes SvelteKit's serialiser
 *  writes for it (`textCost`). Visitors write these fields, through every client
 *  site's public form, nothing at ingest bounds them, and the snapshot rides in
 *  every cockpit page, so a few crafted posts must not be able to push every page
 *  past the function's response limit (6 MB).
 *
 *  - One field: at most `SNAPSHOT_FIELD_MAX`. The longest real message on
 *    2026-10-21 was 7,924 characters (681 rows).
 *  - All of them: at most `SNAPSHOT_TEXT_BUDGET`, newest lead first. Every lead
 *    past it keeps its row (so every count and status still holds) but its text is
 *    one constant marker, which the serialiser writes once however many rows hold
 *    it. All 681 rows' text came to about 0.2 MB on 2026-10-21.
 *
 *  Neither has cut a real lead yet; when one does, the marker says so, and the
 *  whole lead is still in Turso. */
export const SNAPSHOT_FIELD_MAX = 20_000;
export const SNAPSHOT_TEXT_BUDGET = 1_500_000;
export const TEXT_PAST_BUDGET =
  "[cut by the cockpit: too much lead text to send; the whole lead is in Turso]";

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
export const SNAPSHOT_FREE_TEXT: readonly string[] = FREE_TEXT;

/** What one character costs once serialised (devalue, then UTF-8): `<`, the
 *  control characters and the line separators are written as `\uXXXX`, a quote or
 *  backslash is escaped, and anything past ASCII takes up to four bytes. */
function charCost(code: number): number {
  if (code === 0x3c || code < 0x20 || code === 0x2028 || code === 0x2029) return 6;
  if (code === 0x22 || code === 0x5c) return 2;
  return code > 0x7f ? 4 : 1;
}

/** `value` cut to at most `max` serialised bytes, and what that cost. */
function cutTo(value: string, max: number): { text: string; cost: number; cut: boolean } {
  let cost = 0;
  for (let i = 0; i < value.length; i++) {
    const c = charCost(value.charCodeAt(i));
    if (cost + c > max) return { text: value.slice(0, i), cost, cut: true };
    cost += c;
  }
  return { text: value, cost, cut: false };
}

/** Apply both bounds to the rows, newest first (the order they are read in). */
function boundLeadText(rows: SubmissionRow[]): SubmissionRow[] {
  let spent = 0;
  return rows.map((row) => {
    let out = row;
    const set = (field: string, value: string) => {
      if (out === row) out = { ...row };
      (out as Record<string, unknown>)[field] = value;
    };
    if (spent > SNAPSHOT_TEXT_BUDGET) {
      for (const field of FREE_TEXT) {
        if (typeof row[field] === "string" && row[field] !== "") set(field, TEXT_PAST_BUDGET);
      }
      return out;
    }
    for (const field of FREE_TEXT) {
      const value = row[field];
      if (typeof value !== "string") continue;
      const { text, cost, cut } = cutTo(value, SNAPSHOT_FIELD_MAX);
      spent += cost;
      if (cut) {
        set(
          field,
          `${text} … [${value.length - text.length} more characters cut by the cockpit; the whole lead is in Turso]`,
        );
      }
    }
    return out;
  });
}

/** What a set Mailchimp key reads as in the snapshot. */
export const MAILCHIMP_KEY_REDACTED = "(set)";
