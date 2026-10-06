// src/dashboard/site-alarm.ts
import type { Db } from "../db/client.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import { countUnreplayedDeadLettersForSlug } from "../db/deadletter.js";
import { countNotifyBouncedForSite, type NotifyBounceCounts } from "../db/submissions.js";
import { screenOutsSince } from "../db/screenouts.js";
import { readDigestState } from "../db/digest-state.js";
import type { DigestSnapshot } from "../alerts/digest-state.js";
import { NOTIFY_BOUNCE_WINDOW_DAYS } from "../alerts/digest-collectors.js";
import { buildSiteAlarmContext, type SiteAlarmContext } from "./fleet-cockpit.js";

/**
 * The `/s/<slug>` page's alarm verdict, read from the store: the same collectors and
 * assignTier as buildCockpitModel (see buildSiteAlarmContext). Every read is
 * defensive: a Turso blip drops just that signal, and any collector throw drops the
 * strip (null).
 *
 * The collectors take fleet-shaped maps, so each per-site read is wrapped in a
 * one-entry map rather than changing their signatures — the site page and the
 * cockpit keep running the identical collector code. An empty map on failure still
 * means "no signal".
 *
 * Dead letters are read for THIS slug only (#645, MED-11): `slug` is the URL's, the
 * same value `getSiteBySlug` matched and `form-ingest` writes into
 * `submission_deadletter.site_slug`. The fleet-wide view of the queue is the cockpit.
 *
 * The digest snapshot dates each item's first flag, which decides whether a waiting
 * item has escalated (src/alerts/waiting.ts). It is the same snapshot the cockpit
 * reads, so the page and the cockpit escalate on the same day. A blip leaves it
 * empty, and an empty snapshot mutes nothing.
 */
export async function loadSiteAlarmContext(
  db: Db,
  site: WebsiteRow,
  slug: string,
  reports: ReportRow[],
  baseUrl: string,
  now: Date,
): Promise<SiteAlarmContext | null> {
  let notifyBounces: ReadonlyMap<string, NotifyBounceCounts> = new Map();
  try {
    const counts = await countNotifyBouncedForSite(
      db,
      site.id,
      screenOutsSince(now, NOTIFY_BOUNCE_WINDOW_DAYS),
    );
    if (counts.total > 0) notifyBounces = new Map([[site.id, counts]]);
  } catch {
    // bounce chip simply absent
  }
  let deadLetters: ReadonlyMap<string, number> = new Map();
  try {
    const n = await countUnreplayedDeadLettersForSlug(db, slug);
    if (n > 0) deadLetters = new Map([[slug, n]]);
  } catch {
    // dead-letter chip simply absent
  }
  let prior: DigestSnapshot = {};
  try {
    prior = await readDigestState(db);
  } catch {
    // nothing waits on an empty snapshot
  }
  try {
    return buildSiteAlarmContext(site, reports, baseUrl, now, notifyBounces, deadLetters, prior);
  } catch (e) {
    console.error(`[site-dashboard] alarm context failed: ${String(e)}`);
    return null;
  }
}
