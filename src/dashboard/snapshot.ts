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
import { readCockpitVersion } from "../db/cockpit-version.js";
import { orElse } from "./or-else.js";
import { readLatestDeps, readOverviewNights } from "../fleet-daily/read.js";
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
    version,
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
    deps,
    nights,
  ] = await Promise.all([
    // First, in the same read batch as the rest, so it is the version of exactly
    // these rows. Should the batch fail and its reads run one by one, first still
    // means the version is never newer than a row (client.ts): a write between
    // them reads as a change on the next check, never as "unchanged".
    read<number | null>("version", () => readCockpitVersion(db), null),
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
    // P1-78c: a week of fleet_daily rows by primary key; absent, the dependency alarm is.
    read<CockpitSnapshot["deps"]>("fleet-daily", () => readLatestDeps(db), null),
    // P1-78g: a month of fleet_daily nights for the overview; absent, its counts say so.
    read<CockpitSnapshot["nights"]>("fleet-daily", () => readOverviewNights(db), null),
  ]);
  return {
    takenAt: now.toISOString(),
    version,
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
    deps,
    nights,
  };
}

/** `read`'s marker for a read that fell back. */
const GAP = Symbol("gap");

/** How much lead text the snapshot may carry. Visitors write these fields, through
 *  every client site's public form, nothing at ingest bounds them, and the snapshot
 *  rides in every cockpit page, so a few crafted posts must not be able to push
 *  every page past the function's response limit (6 MB).
 *
 *  - One field: at most `SNAPSHOT_FIELD_MAX` characters. The longest real message
 *    on 2026-10-21 was 7,924 characters (681 rows).
 *  - All of them: at most `SNAPSHOT_TEXT_BUDGET`, counted as the bytes SvelteKit's
 *    serialiser writes (`charCost`), newest lead first. A lead past it keeps its
 *    row, its status, its reasons and the first 80 characters of its name, email
 *    and phone, so every count, status and reason filter holds and a search by
 *    sender still finds it; its message and other text become one constant
 *    marker, which the serialiser writes once however many rows hold it. A search
 *    for words in an older lead's message misses it while the budget is spent.
 *    All 681 rows' text came to about 0.2 MB on 2026-10-21.
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

/** `value` cut to at most `max` characters, never between the halves of a
 *  surrogate pair, and what the kept part costs serialised. */
function cutTo(value: string, max: number): { text: string; cost: number; cut: boolean } {
  let end = Math.min(value.length, max);
  if (end < value.length) {
    const code = value.charCodeAt(end - 1);
    if (code >= 0xd800 && code <= 0xdbff) end--;
  }
  const text = value.slice(0, end);
  let cost = 0;
  for (let i = 0; i < text.length; i++) cost += charCost(text.charCodeAt(i));
  return { text, cost, cut: end < value.length };
}

/** The fields a row past the budget keeps a short prefix of, so a search by who
 *  wrote still finds a real lead (real ones are far shorter), and the most of them
 *  it keeps. `spamReason` is the classifier's tokens, not a visitor's text: it is
 *  never budgeted, so the reason filters and facets hold. */
const KEPT_PAST_BUDGET = ["name", "email", "phone"] as const;
const PREFIX_PAST_BUDGET = 80;

/** Apply both bounds to the rows, newest first (the order they are read in). */
function boundLeadText(rows: SubmissionRow[]): SubmissionRow[] {
  let spent = 0;
  return rows.map((row) => {
    let out = row;
    const set = (field: string, value: string) => {
      if (out === row) out = { ...row };
      (out as Record<string, unknown>)[field] = value;
    };
    const past = spent > SNAPSHOT_TEXT_BUDGET;
    for (const field of FREE_TEXT) {
      const value = row[field];
      if (typeof value !== "string" || value === "") continue;
      const budgeted = field !== "spamReason";
      if (past && budgeted) {
        if ((KEPT_PAST_BUDGET as readonly string[]).includes(field)) {
          const { text, cut } = cutTo(value, PREFIX_PAST_BUDGET);
          if (cut) set(field, `${text}…`);
        } else {
          set(field, TEXT_PAST_BUDGET);
        }
        continue;
      }
      const { text, cost, cut } = cutTo(value, SNAPSHOT_FIELD_MAX);
      if (budgeted) spent += cost;
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
