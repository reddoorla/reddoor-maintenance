/**
 * P1-87 PR 6: the wiring between `scripts/fleet-daily.mts` and the traffic block. The
 * script keeps only the IO; the rules that decide what each read asks for live here, so
 * a test can pin them (review round 1, Group D). The two client functions and the key
 * file's existence are injected, so nothing here reaches Google or the disk by default.
 */
import { existsSync } from "node:fs";
import { fetchDailyEngaged, measuredHostnames } from "../reports/ga/client.js";
import type { GaConfig } from "../reports/ga/config.js";
import { fetchSearchDaily } from "../reports/search/client.js";
import { hostnameOf } from "../util/url.js";
import { nightOf } from "./core.js";
import type { TrafficReaders, TrafficSiteInput } from "./traffic.js";

export type TrafficWiringDeps = {
  fetchDailyEngaged: typeof fetchDailyEngaged;
  fetchSearchDaily: typeof fetchSearchDaily;
  existsSync: (path: string) => boolean;
};

export const LIVE_WIRING: TrafficWiringDeps = { fetchDailyEngaged, fetchSearchDaily, existsSync };

/** The GA and Search Console readers for the traffic block, or null when GA is not
 *  configured or its key file is not there: the block then reads "GA not configured".
 *  Each read takes the same subjects and key file the reports use. */
export function trafficReaders(
  cfg: GaConfig | null,
  deps: TrafficWiringDeps = LIVE_WIRING,
): TrafficReaders | null {
  if (!cfg || !deps.existsSync(cfg.keyPath)) return null;
  return {
    visits: (site, range) =>
      deps.fetchDailyEngaged(
        {
          propertyId: site.ga4PropertyId ?? "",
          subjects: cfg.subjects,
          keyPath: cfg.keyPath,
          hostnames: measuredHostnames(site.url),
        },
        range,
      ),
    search: (site, range) =>
      deps.fetchSearchDaily(
        {
          keyPath: cfg.keyPath,
          subjects: cfg.subjects,
          property: site.searchConsoleProperty ?? undefined,
          host: hostnameOf(site.url),
        },
        range,
      ),
  };
}

/** The columns of a site row the traffic block reads. */
export type SiteRowLike = {
  id: string;
  url: string;
  status: string | null;
  ga4PropertyId: string | null;
  searchConsoleProperty: string | null;
};

/** The sites the traffic block reads: the maintained ones, the same rule the deps readings
 *  use (`status = 'maintained'`). */
export function trafficSites<T extends SiteRowLike>(rows: T[]): TrafficSiteInput[] {
  return rows
    .filter((s) => s.status === "maintained")
    .map((s) => ({
      id: s.id,
      url: s.url,
      ga4PropertyId: s.ga4PropertyId,
      searchConsoleProperty: s.searchConsoleProperty,
    }));
}

/** The night the row is keyed by: the same night the writer uses, from the run's creation time. */
export function trafficNight(env: { RUN_CREATED_AT?: string | undefined }): string {
  if (!env.RUN_CREATED_AT) throw new Error("RUN_CREATED_AT must be set");
  return nightOf(env.RUN_CREATED_AT);
}
