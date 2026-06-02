import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

const WEBMASTERS_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
const SC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
/** Average-position threshold for "on page 1" (10 organic results per page). */
const PAGE_1_MAX_POSITION = 10;

export type SearchPresenceQuery = {
  /** Path to the service-account JSON key (same one GA uses). */
  keyPath: string;
  /** Workspace user to impersonate via domain-wide delegation. */
  subject: string;
  /** Explicit Search Console property (`sc-domain:...` or `https://.../`). Overrides auto-resolution. */
  property?: string | undefined;
  /** Site host, used to auto-resolve the property from `sites.list` when `property` is absent. */
  host: string;
  /** Operator-supplied query string (e.g. the business name). */
  query: string;
};

export type SearchPresence = {
  /** True when the average position for the query is on page 1 (<= 10). */
  foundOnPage1: boolean;
  /** Rounded average position, or null when not found / no data. */
  position: number | null;
};

type SiteEntry = { siteUrl: string };

/** Reduce any property string or URL to a bare host: no `sc-domain:`, scheme, `www.`, path, lowercased. */
export function bareHost(s: string): string {
  return s
    .trim()
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .split("/")[0]!
    .replace(/^www\./i, "")
    .toLowerCase();
}

/**
 * Pick the Search Console property matching `host` from the list the identity can see.
 * Accepts Domain (`sc-domain:`) and URL-prefix properties; prefers the Domain form on a tie
 * (broadest coverage). Returns null when nothing matches.
 */
export function resolveProperty(entries: SiteEntry[], host: string): string | null {
  const target = bareHost(host);
  const matches = entries.filter((e) => bareHost(e.siteUrl) === target);
  if (matches.length === 0) return null;
  const domain = matches.find((e) => e.siteUrl.toLowerCase().startsWith("sc-domain:"));
  return (domain ?? matches[0]!).siteUrl;
}

/** UTC YYYY-MM-DD — matches the rest of the reports pipeline. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Query Google Search Console for the average position of `query` on the site over the report
 * period, via a domain-wide-delegation service account impersonating `subject`. Resolves the
 * property from `property` (verbatim) or auto-discovers it via `sites.list`. Throws on any
 * auth/API error — the caller (draftReportForSite) soft-fails.
 */
export async function fetchSearchPresence(
  q: SearchPresenceQuery,
  periodStart: Date,
  periodEnd: Date,
): Promise<SearchPresence> {
  const key = JSON.parse(readFileSync(q.keyPath, "utf8")) as {
    client_email: string;
    private_key: string;
  };
  const jwt = new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [WEBMASTERS_READONLY],
    subject: q.subject,
  });

  let property = q.property?.trim() || null;
  if (!property) {
    const list = await jwt.request<{ siteEntry?: SiteEntry[] }>({
      url: `${SC_BASE}/sites`,
      method: "GET",
    });
    property = resolveProperty(list.data.siteEntry ?? [], q.host);
    if (!property) return { foundOnPage1: false, position: null };
  }

  const res = await jwt.request<{ rows?: Array<{ position?: number }> }>({
    url: `${SC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
    method: "POST",
    data: {
      startDate: ymd(periodStart),
      endDate: ymd(periodEnd),
      dimensions: ["query"],
      dimensionFilterGroups: [
        { filters: [{ dimension: "query", operator: "equals", expression: q.query.toLowerCase() }] },
      ],
      rowLimit: 1,
    },
  });

  const pos = res.data.rows?.[0]?.position;
  if (typeof pos !== "number") return { foundOnPage1: false, position: null };
  return { foundOnPage1: pos <= PAGE_1_MAX_POSITION, position: Math.round(pos) };
}
