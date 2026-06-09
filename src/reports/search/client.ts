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
 * All Search Console properties matching `host`, ordered for query fallback: Domain
 * (`sc-domain:`) forms first (broadest coverage), then URL-prefix forms. A site can be verified
 * as both; a freshly-created Domain property has no backfilled history, so its data can be empty
 * even while a long-lived URL-prefix property has data — hence we return every match and let the
 * caller try them in order until one returns data. Empty list = nothing matches.
 */
export function resolvePropertyCandidates(entries: SiteEntry[], host: string): string[] {
  const target = bareHost(host);
  const matches = entries.filter((e) => bareHost(e.siteUrl) === target).map((e) => e.siteUrl);
  const domains = matches.filter((s) => s.toLowerCase().startsWith("sc-domain:"));
  const prefixes = matches.filter((s) => !s.toLowerCase().startsWith("sc-domain:"));
  return [...domains, ...prefixes];
}

/** UTC YYYY-MM-DD — matches the rest of the reports pipeline. */
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Query Google Search Console for the average position of `query` on the site over the report
 * period, via a domain-wide-delegation service account impersonating `subject`. Uses `property`
 * verbatim when given (operator's choice is final — no fallback); otherwise auto-discovers all
 * matching properties via `sites.list` and tries them in order (Domain first) until one returns
 * data. Throws on any auth/API error — the caller (draftReportForSite) soft-fails.
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

  const explicit = q.property?.trim();
  let candidates: string[];
  if (explicit) {
    candidates = [explicit];
  } else {
    const list = await jwt.request<{ siteEntry?: SiteEntry[] }>({
      url: `${SC_BASE}/sites`,
      method: "GET",
    });
    candidates = resolvePropertyCandidates(list.data.siteEntry ?? [], q.host);
    if (candidates.length === 0) return { foundOnPage1: false, position: null };
  }

  for (const property of candidates) {
    const res = await jwt.request<{ rows?: Array<{ position?: number }> }>({
      url: `${SC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      method: "POST",
      data: {
        startDate: ymd(periodStart),
        endDate: ymd(periodEnd),
        dimensions: ["query"],
        dimensionFilterGroups: [
          {
            filters: [
              { dimension: "query", operator: "equals", expression: q.query.toLowerCase() },
            ],
          },
        ],
        rowLimit: 1,
      },
    });
    const pos = res.data.rows?.[0]?.position;
    if (typeof pos === "number") {
      // Search Console can average below 1; floor to 1 so the template never
      // renders a nonsensical "#0" (positions are 1-indexed).
      return { foundOnPage1: pos <= PAGE_1_MAX_POSITION, position: Math.max(1, Math.round(pos)) };
    }
  }
  return { foundOnPage1: false, position: null };
}
