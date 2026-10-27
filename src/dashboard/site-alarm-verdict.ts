import type { WebsiteRow } from "../fleet/site-row.js";
import type { ReportRow } from "../reports/report-fields.js";
import type { NotifyBounceCounts } from "../db/submissions.js";
import type { DigestSnapshot } from "../alerts/digest-state.js";
import type { LatestDeps } from "../alerts/production-signals.js";
import { buildSiteAlarmContext, type SiteAlarmContext } from "./fleet-cockpit.js";

/**
 * The `/s/<slug>` alarm verdict from inputs already read, apart from the reads in
 * `site-alarm.ts` so the cockpit's browser code (the snapshot's derivations,
 * `snapshot-views.ts`) can build it without importing a store module.
 */
export type SiteAlarmInputs = {
  notifyBounces: ReadonlyMap<string, NotifyBounceCounts>;
  deadLetters: ReadonlyMap<string, number>;
  deadLetterOldest: ReadonlyMap<string, string>;
  prior: DigestSnapshot;
  /** P1-78c. The latest `fleet_daily` dependency readings; null on a blip. */
  deps: LatestDeps | null;
};

/** The verdict from the reads and the site's reports; null if a collector throws. */
export function buildSiteAlarm(
  site: WebsiteRow,
  reports: ReportRow[],
  baseUrl: string,
  now: Date,
  inputs: SiteAlarmInputs,
): SiteAlarmContext | null {
  try {
    return buildSiteAlarmContext(
      site,
      reports,
      baseUrl,
      now,
      inputs.notifyBounces,
      inputs.deadLetters,
      inputs.prior,
      inputs.deadLetterOldest,
      inputs.deps,
    );
  } catch (e) {
    console.error(`[site-dashboard] alarm context failed: ${String(e)}`);
    return null;
  }
}
