// src/dashboard/site-alarm.ts
import type { Db } from "../db/client.js";
import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import {
  countUnreplayedDeadLettersForSlug,
  oldestUnreplayedDeadLetterForSlug,
} from "../db/deadletter.js";
import { countNotifyBouncedForSite, type NotifyBounceCounts } from "../db/submissions.js";
import { screenOutsSince } from "../db/screenouts.js";
import { readDigestState } from "../db/digest-state.js";
import type { DigestSnapshot } from "../alerts/digest-state.js";
import { NOTIFY_BOUNCE_WINDOW_DAYS } from "../alerts/digest-collectors.js";
import type { SiteAlarmContext } from "./fleet-cockpit.js";
import { buildSiteAlarm, type SiteAlarmInputs } from "./site-alarm-verdict.js";
import { orElse } from "./or-else.js";

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
 *
 * The reads ({@link readSiteAlarmInputs}) need only the site and the slug, so
 * `loadSiteDashboard` starts them alongside its reports read and builds the verdict
 * ({@link buildSiteAlarm}) once the reports are in.
 */
export async function loadSiteAlarmContext(
  db: Db,
  site: WebsiteRow,
  slug: string,
  reports: ReportRow[],
  baseUrl: string,
  now: Date,
): Promise<SiteAlarmContext | null> {
  return buildSiteAlarm(
    site,
    reports,
    baseUrl,
    now,
    await readSiteAlarmInputs(db, site, slug, now),
  );
}

/** The alarm's four reads, together; each one's failure drops only its signal. */
export async function readSiteAlarmInputs(
  db: Db,
  site: WebsiteRow,
  slug: string,
  now: Date,
): Promise<SiteAlarmInputs> {
  const [bounces, deadLetterCount, oldest, prior] = await Promise.all([
    // bounce chip simply absent
    orElse<NotifyBounceCounts | null>(
      () => countNotifyBouncedForSite(db, site.id, screenOutsSince(now, NOTIFY_BOUNCE_WINDOW_DAYS)),
      null,
    ),
    // dead-letter chip simply absent
    orElse(() => countUnreplayedDeadLettersForSlug(db, slug), 0),
    // OD 87: the hold's clock. A blip leaves it empty, and the dead letter alarms
    // (nothing held). Read in the same wave as the count, and used only when the
    // count found dead letters, as when it was read after it.
    orElse<string | null>(() => oldestUnreplayedDeadLetterForSlug(db, slug), null),
    // nothing waits on an empty snapshot
    orElse<DigestSnapshot>(() => readDigestState(db), {}),
  ]);
  return {
    notifyBounces:
      bounces !== null && bounces.total > 0 ? new Map([[site.id, bounces]]) : new Map(),
    deadLetters: deadLetterCount > 0 ? new Map([[slug, deadLetterCount]]) : new Map(),
    deadLetterOldest:
      deadLetterCount > 0 && oldest !== null ? new Map([[slug, oldest]]) : new Map(),
    prior,
  };
}

export { buildSiteAlarm, type SiteAlarmInputs } from "./site-alarm-verdict.js";
