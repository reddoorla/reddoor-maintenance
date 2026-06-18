import { readFileSync } from "node:fs";
import { JWT } from "google-auth-library";

const WEBMASTERS_READONLY = "https://www.googleapis.com/auth/webmasters.readonly";
const SC_BASE = "https://searchconsole.googleapis.com/webmasters/v3";
/** Average-position threshold for "on page 1" (10 organic results per page). */
const PAGE_1_MAX_POSITION = 10;
/** Rows to pull for the brand `contains` match. searchAnalytics has no orderBy and returns
 *  rows clicks-desc, so the exact-query row survives into the response only if it isn't paged
 *  out beyond this cap. Sized with wide headroom — a brand has a handful of phrasing variants,
 *  far below 100 — so the exact query (and every variant) is in practice always present. */
export const BRAND_QUERY_ROW_LIMIT = 100;

export type SearchPresenceQuery = {
  /** Path to the service-account JSON key (same one GA uses). */
  keyPath: string;
  /** Workspace user to impersonate via domain-wide delegation. */
  subject: string;
  /** Explicit Search Console property (`sc-domain:...` or `https://.../`). Overrides auto-resolution. */
  property?: string | undefined;
  /** Site host, used to auto-resolve the property from `sites.list` when `property` is absent. */
  host: string;
  /** Operator-supplied brand hint (e.g. the business name). Matched as a case-insensitive
   *  SUBSTRING (`contains`) of the actual user query — NOT a hard exact string — so it tolerates
   *  phrasing ("red door creative" vs "…creative la"). An exact-query match is preferred when
   *  present; otherwise the most-searched matching query wins. */
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
 * From the queries matching the brand substring, pick the one the brand is actually FOUND
 * by most — the highest-impression row — and return its average position; tie-break on the
 * better (lower) position. Returns undefined when no row carries a numeric position. This is
 * what makes the reported "brand search" position robust to phrasing: with a `contains`
 * filter several variants can match, and we report the position of the variant real users
 * search most, not whichever the operator happened to type. Rows missing `impressions` count
 * as 0 (keeps a single-row, impression-less response — e.g. a test fixture — working). PURE.
 */
export function pickBrandQuery(
  rows: Array<{ position?: number; impressions?: number }>,
): number | undefined {
  let best: { position: number; impressions: number } | undefined;
  for (const r of rows) {
    if (typeof r.position !== "number") continue;
    const impressions = r.impressions ?? 0;
    if (
      best === undefined ||
      impressions > best.impressions ||
      (impressions === best.impressions && r.position < best.position)
    ) {
      best = { position: r.position, impressions };
    }
  }
  return best?.position;
}

/**
 * The brand's reported position from the `contains`-matched rows, preferring an EXACT match.
 * When a returned row's query equals the operator's configured string (case-insensitive), its
 * position is used verbatim — a precisely-configured brand query is honored, with no chance a
 * longer higher-impression variant ("…reviews", "…near me") hijacks the number. Otherwise we
 * fall back to the most-searched matching query (`pickBrandQuery`). Operates only on the rows
 * actually returned: a string `contains` itself, so the exact query is among the `contains`
 * results whenever it has data AND isn't paged out beyond `BRAND_QUERY_ROW_LIMIT` (sized so a
 * brand's handful of phrasing variants always fit; if it ever were paged out, the most-searched
 * fallback still returns a valid brand position). Returns undefined when no row carries a
 * numeric position. PURE.
 */
export function selectBrandPosition(
  rows: Array<{ keys?: string[]; position?: number; impressions?: number }>,
  exactQuery: string,
): number | undefined {
  const want = exactQuery.toLowerCase();
  const exact = rows.find(
    (r) => typeof r.position === "number" && (r.keys?.[0] ?? "").toLowerCase() === want,
  );
  if (exact) return exact.position;
  return pickBrandQuery(rows);
}

/**
 * Query Google Search Console for the brand's average position on the site over the report
 * period, via a domain-wide-delegation service account impersonating `subject`. `query` is a
 * case-insensitive SUBSTRING (`contains`) hint; among the matching user queries we report the
 * position of the exact-match query when present, else the most-searched one (see
 * `selectBrandPosition`) — so it doesn't depend on the operator typing the exact search string,
 * yet honors one verbatim when they do. Uses `property` verbatim when given (operator's
 * choice is final — no fallback); otherwise auto-discovers all matching properties via
 * `sites.list` and tries them in order (Domain first) until one returns data. Throws on any
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
    const res = await jwt.request<{
      rows?: Array<{ keys?: string[]; position?: number; impressions?: number }>;
    }>({
      url: `${SC_BASE}/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
      method: "POST",
      data: {
        startDate: ymd(periodStart),
        endDate: ymd(periodEnd),
        dimensions: ["query"],
        dimensionFilterGroups: [
          {
            filters: [
              { dimension: "query", operator: "contains", expression: q.query.toLowerCase() },
            ],
          },
        ],
        rowLimit: BRAND_QUERY_ROW_LIMIT,
      },
    });
    const pos = selectBrandPosition(res.data.rows ?? [], q.query.toLowerCase());
    if (typeof pos === "number") {
      // Search Console can average below 1; floor to 1 so the template never
      // renders a nonsensical "#0" (positions are 1-indexed).
      return { foundOnPage1: pos <= PAGE_1_MAX_POSITION, position: Math.max(1, Math.round(pos)) };
    }
  }
  return { foundOnPage1: false, position: null };
}
