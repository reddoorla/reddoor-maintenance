import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { withSubjectFailover } from "./failover.js";

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
};

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
