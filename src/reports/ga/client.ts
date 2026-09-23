import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { withSubjectFailover } from "./failover.js";
import { hostnameOf, isHttpUrl } from "../../util/url.js";
import { siteHostnames } from "../../client/site-host.js";

const ANALYTICS_READONLY = "https://www.googleapis.com/auth/analytics.readonly";
const MS_PER_DAY = 86_400_000;

export type GaQuery = {
  /** GA4 numeric property ID (e.g. "471880366"). */
  propertyId: string;
  /** Workspace users to impersonate via domain-wide delegation, tried in order
   *  (auth-failure failover — see `withSubjectFailover`). */
  subjects: string[];
  /** Path to the service-account JSON key. */
  keyPath: string;
  /** Hostnames this site's own traffic arrives on. When non-empty the query is
   *  filtered to them, so `localhost` and Netlify preview hosts are excluded.
   *  Empty means "unfiltered", which is the pre-2026-09 behaviour and the
   *  deliberate fallback for a site row with no usable URL: a filter matching
   *  nothing would silently report zero, which is worse than reporting noise. */
  hostnames: string[];
};

/**
 * The hostnames a site's own traffic can legitimately arrive on: the URL's
 * host and its www/apex twin.
 *
 * Without this the report counts every environment that serves the same
 * analytics tag. On reddoorla.com for the thirty days to 2026-09-14 that was
 * 15,971 `localhost` users against 87 real ones — the smoke suite, which
 * clicks and scrolls and so trips the tag's interaction gate, once per fresh
 * browser context. The report mailed it as a 510% rise while real traffic had
 * halved.
 *
 * Returns [] for anything that is not an http(s) URL, which the caller treats
 * as "do not filter" rather than "match nothing".
 */
export function measuredHostnames(siteUrl: string): string[] {
  if (!isHttpUrl(siteUrl)) return [];
  // The apex/www rule itself lives in src/client/site-host.ts, which is also
  // what `initAnalytics` gates the tag on. Two copies of this would let the
  // emit side and the read side drift apart, and the resulting site reads as
  // "no traffic" rather than "misconfigured" — see that module's header.
  return siteHostnames(hostnameOf(siteUrl));
}

/** UTC YYYY-MM-DD — matches the rest of the reports pipeline's date handling. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch GA4 `activeUsers` ("Users") for a report period and the equal-length window
 * immediately before it, via a domain-wide-delegation service account impersonating each
 * of `subjects` in order until one authenticates. Throws on any non-auth API error, or
 * once every subject has failed auth — the caller (draftReportForSite) soft-fails.
 *
 * Previous window: same length as the current period, ending the day before `periodStart`.
 */
export async function fetchPeriodUsers(
  query: GaQuery,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ current: number; previous: number }> {
  const key = JSON.parse(readFileSync(query.keyPath, "utf8")) as {
    client_email: string;
    private_key: string;
  };

  const lengthDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY);
  const prevEnd = new Date(periodStart.getTime() - MS_PER_DAY);
  const prevStart = new Date(prevEnd.getTime() - lengthDays * MS_PER_DAY);
  const property = `properties/${query.propertyId}`;

  return withSubjectFailover(query.subjects, "GA", async (subject) => {
    const authClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [ANALYTICS_READONLY],
      subject,
    });
    const client = new BetaAnalyticsDataClient({ authClient });

    const run = async (start: Date, end: Date): Promise<number> => {
      const [resp] = await client.runReport({
        property,
        dateRanges: [{ startDate: ymd(start), endDate: ymd(end) }],
        metrics: [{ name: "activeUsers" }],
        // Only the site's own hosts. Omitted entirely when we have no usable
        // hostname, so the number degrades to the old unfiltered one instead
        // of to zero.
        ...(query.hostnames.length > 0
          ? {
              dimensionFilter: {
                filter: {
                  fieldName: "hostName",
                  inListFilter: { values: query.hostnames },
                },
              },
            }
          : {}),
      });
      const raw = resp.rows?.[0]?.metricValues?.[0]?.value ?? "0";
      const n = Number.parseInt(raw, 10);
      return Number.isFinite(n) ? n : 0;
    };

    const current = await run(periodStart, periodEnd);
    const previous = await run(prevStart, prevEnd);
    return { current, previous };
  });
}
