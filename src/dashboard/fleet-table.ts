/** Phase 4 of the Airtable → Turso migration (#539): the fleet table.
 *
 *  A sortable/filterable inventory of EVERY fleet site — the console's
 *  replacement for eyeballing the Airtable grid. Unlike the cockpit
 *  (isDashboardVisible = {maintenance, launch period}), NOTHING here is
 *  status-filtered by default: archived/legacy/null-status rows all render,
 *  and the status is carried RAW (a vocabulary rename is pending operator
 *  sign-off — this module never remaps or invents status names).
 *
 *  All sorting/filtering happens HERE, in memory, over the one `listSites`
 *  read (44 rows). Deliberately NO new SQL: the EXPLAIN-query-plan gate
 *  (#556) covers request-path statements, and a per-column ORDER BY would
 *  buy nothing at this fleet size while costing an index per sort key.
 */
import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";

export const FLEET_SORT_KEYS = [
  "name",
  "url",
  "status",
  "perf",
  "a11y",
  "bp",
  "seo",
  "nextMaintenance",
  "nextTesting",
  "lastAudit",
] as const;
export type FleetSortKey = (typeof FLEET_SORT_KEYS)[number];

export type FleetTableQuery = {
  sort: FleetSortKey;
  dir: "asc" | "desc";
  /** Exact raw status to filter to ("" = all sites, nulls included). */
  status: string;
  /** Case-insensitive substring matched against site name AND slug ("" = all). */
  q: string;
};

/** The render-ready row: exactly the WebsiteRow fields the table shows. */
export type FleetTableRow = {
  slug: string;
  name: string;
  url: string;
  /** RAW stored status — null stays null (the renderer owns the dash). */
  status: string | null;
  pScore: number | null;
  rScore: number | null;
  bpScore: number | null;
  seoScore: number | null;
  nextMaintenanceAt: string | null;
  nextTestingAt: string | null;
  lastLighthouseAuditAt: string | null;
};

export type FleetTableModel = {
  /** Filtered + sorted rows. */
  rows: FleetTableRow[];
  /** Pre-filter fleet size, so the header can say "N of M sites". */
  totalSites: number;
  /** Distinct raw statuses present in the fleet (a-z) — the filter options.
   *  Derived from DATA, not from the code Status union, so an Airtable-only
   *  value like "legacy" is filterable without this module naming statuses. */
  statuses: string[];
  query: FleetTableQuery;
};

function asSortKey(v: string): FleetSortKey {
  return (FLEET_SORT_KEYS as readonly string[]).includes(v) ? (v as FleetSortKey) : "name";
}

/** Parse ?sort/?dir/?status/?q — junk degrades to defaults, never throws.
 *  Length caps only bound hostile input (real statuses/searches are short). */
export function parseFleetTableQuery(params: URLSearchParams): FleetTableQuery {
  const sort = asSortKey(params.get("sort")?.trim() ?? "");
  const dir = params.get("dir")?.trim() === "desc" ? "desc" : "asc";
  const status = (params.get("status")?.trim() ?? "").slice(0, 64);
  const q = (params.get("q")?.trim() ?? "").slice(0, 200);
  return { sort, dir, status, q };
}

/** Per-key sort value. Strings compare lowercased; dates are ISO strings, which
 *  compare lexicographically. null = "no value" → always sorts last. */
function sortValue(site: WebsiteRow, key: FleetSortKey): string | number | null {
  switch (key) {
    case "name":
      return site.name.toLowerCase();
    case "url":
      return site.url.toLowerCase();
    case "status":
      return site.status === null ? null : site.status.toLowerCase();
    case "perf":
      return site.pScore;
    case "a11y":
      return site.rScore;
    case "bp":
      return site.bpScore;
    case "seo":
      return site.seoScore;
    case "nextMaintenance":
      return site.nextMaintenanceAt;
    case "nextTesting":
      return site.nextTestingAt;
    case "lastAudit":
      return site.lastLighthouseAuditAt;
  }
}

function toRow(site: WebsiteRow): FleetTableRow {
  return {
    slug: siteSlug(site.name),
    name: site.name,
    url: site.url,
    status: site.status,
    pScore: site.pScore,
    rScore: site.rScore,
    bpScore: site.bpScore,
    seoScore: site.seoScore,
    nextMaintenanceAt: site.nextMaintenanceAt,
    nextTestingAt: site.nextTestingAt,
    lastLighthouseAuditAt: site.lastLighthouseAuditAt,
  };
}

/** Filter + sort the full `listSites` read into the render model.
 *
 *  Sort semantics: `dir` inverts only the PRIMARY key. Nulls sort last in both
 *  directions (an unaudited site never tops a score sort), and ties break on
 *  name-asc then id — stable and identical under asc/desc, so flipping a
 *  column keeps equal-valued sites in one predictable order. */
export function buildFleetTableModel(sites: WebsiteRow[], query: FleetTableQuery): FleetTableModel {
  const statuses = [...new Set(sites.flatMap((s) => (s.status === null ? [] : [s.status])))].sort(
    (a, b) => a.localeCompare(b),
  );

  const qLower = query.q.toLowerCase();
  const filtered = sites.filter((s) => {
    if (query.status !== "" && s.status !== query.status) return false;
    if (qLower !== "") {
      const name = s.name.toLowerCase();
      if (!name.includes(qLower) && !siteSlug(s.name).includes(qLower)) return false;
    }
    return true;
  });

  const flip = query.dir === "desc" ? -1 : 1;
  const sorted = [...filtered].sort((a, b) => {
    const av = sortValue(a, query.sort);
    const bv = sortValue(b, query.sort);
    if (av !== bv) {
      // Nulls last regardless of direction — "no value" is not a rank.
      if (av === null) return 1;
      if (bv === null) return -1;
      if (av < bv) return -1 * flip;
      if (av > bv) return 1 * flip;
    }
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return { rows: sorted.map(toRow), totalSites: sites.length, statuses, query };
}
