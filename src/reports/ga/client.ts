import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";
import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { withSubjectFailover } from "./failover.js";
import { hostnameOf, isHttpUrl } from "../../util/url.js";
import { siteHostnames } from "../../client/site-host.js";
import { ymd } from "../../util/date.js";
import { reportWindows, type GaDateRange } from "./window.js";

export { REPORT_WINDOW_DAYS, reportWindows, type GaDateRange } from "./window.js";

const ANALYTICS_READONLY = "https://www.googleapis.com/auth/analytics.readonly";
const ADMIN_BASE = "https://analyticsadmin.googleapis.com/v1beta";
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

/** The request body both report windows share: one metric, the site's own hosts. */
function reportRequest(
  property: string,
  range: GaDateRange,
  metric: string,
  hostnames: string[],
): Record<string, unknown> {
  return {
    property,
    dateRanges: [range],
    metrics: [{ name: metric }],
    // Only the site's own hosts. Omitted entirely when we have no usable
    // hostname, so the number degrades to the unfiltered one instead of to zero.
    ...(hostnames.length > 0
      ? {
          dimensionFilter: {
            filter: { fieldName: "hostName", inListFilter: { values: hostnames } },
          },
        }
      : {}),
  };
}

function firstMetric(resp: {
  rows?: Array<{ metricValues?: Array<{ value?: string | null }> | null }> | null;
}): number {
  const raw = resp.rows?.[0]?.metricValues?.[0]?.value ?? "0";
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

function readKey(keyPath: string): { client_email: string; private_key: string } {
  return JSON.parse(readFileSync(keyPath, "utf8")) as { client_email: string; private_key: string };
}

/**
 * A report's analytics line (P1-73): GA4 `engagedSessions` on the site's own
 * hosts over {@link reportWindows} — the last 30 complete days in the
 * property's timezone — and the 30 days before. The email labels it
 * "Engaged visits".
 *
 * Why engaged sessions, not `activeUsers`: from July 2026 a data-centre bot
 * fleet made 522 of ERP Industrials' 932 users in a month, with 24 engaged
 * sessions between them. Engaged sessions (10 s or more, two or more pages, or
 * a conversion) held flat at 180-400 a month through it, and need no bot list
 * to maintain (the operator, decision 2026-10-26-1521).
 *
 * The timezone comes from the Admin API on every call, so a property whose
 * zone changes is read in its current one. Throws, like
 * {@link fetchPeriodUsers}, on a non-auth error, a property with no timezone,
 * or once every subject has failed auth; the caller soft-fails.
 */
export async function fetchReportVisits(
  query: GaQuery,
  now: Date,
): Promise<{ current: number; previous: number }> {
  const key = readKey(query.keyPath);
  const propertyId = query.propertyId.trim();
  const property = `properties/${propertyId}`;

  return withSubjectFailover(query.subjects, "GA", async (subject) => {
    const authClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [ANALYTICS_READONLY],
      subject,
    });
    const meta = await authClient.request<{ timeZone?: string }>({
      url: `${ADMIN_BASE}/properties/${encodeURIComponent(propertyId)}`,
      method: "GET",
    });
    const windows = reportWindows(now, meta.data.timeZone ?? "");
    const client = new BetaAnalyticsDataClient({ authClient });
    const run = async (range: GaDateRange): Promise<number> => {
      const [resp] = await client.runReport(
        reportRequest(property, range, "engagedSessions", query.hostnames),
      );
      return firstMetric(resp);
    };
    const current = await run(windows.current);
    const previous = await run(windows.previous);
    return { current, previous };
  });
}

/**
 * Fetch GA4 `activeUsers` for a window and the equal-length window
 * immediately before it, via a domain-wide-delegation service account impersonating each
 * of `subjects` in order until one authenticates. Throws on any non-auth API error, or
 * once every subject has failed auth.
 *
 * No report reads this since P1-73 (they read {@link fetchReportVisits}). The analytics
 * audit and `launch-check` do: they ask "is this property collecting at all", and any
 * user, bot or not, is proof that the tag fires.
 *
 * Previous window: same length as the current period, ending the day before `periodStart`.
 */
export async function fetchPeriodUsers(
  query: GaQuery,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ current: number; previous: number }> {
  const key = readKey(query.keyPath);

  const lengthDays = Math.round((periodEnd.getTime() - periodStart.getTime()) / MS_PER_DAY);
  const prevEnd = new Date(periodStart.getTime() - MS_PER_DAY);
  const prevStart = new Date(prevEnd.getTime() - lengthDays * MS_PER_DAY);
  // Trimmed: a trailing newline from a paste or a `--jq` round-trip would ride
  // into the resource name and 404, which the analytics audit already guards.
  const property = `properties/${query.propertyId.trim()}`;

  return withSubjectFailover(query.subjects, "GA", async (subject) => {
    const authClient = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: [ANALYTICS_READONLY],
      subject,
    });
    const client = new BetaAnalyticsDataClient({ authClient });

    const run = async (start: Date, end: Date): Promise<number> => {
      const [resp] = await client.runReport(
        reportRequest(
          property,
          { startDate: ymd(start), endDate: ymd(end) },
          "activeUsers",
          query.hostnames,
        ),
      );
      return firstMetric(resp);
    };

    const current = await run(periodStart, periodEnd);
    const previous = await run(prevStart, prevEnd);
    return { current, previous };
  });
}
