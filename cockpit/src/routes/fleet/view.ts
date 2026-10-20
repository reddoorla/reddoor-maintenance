import { NO_STATUS_FILTER, noStatusFilterActive } from "../../../../src/dashboard/fleet-table.js";
import type { FleetSortKey, FleetTableModel } from "../../../../src/dashboard/fleet-table.js";

/** Columns in display order: header label + the sort key its header toggles. */
export const COLUMNS: ReadonlyArray<{ key: FleetSortKey; label: string; numeric: boolean }> = [
  { key: "name", label: "Site", numeric: false },
  { key: "url", label: "URL", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "perf", label: "Perf", numeric: true },
  { key: "a11y", label: "Access", numeric: true },
  { key: "bp", label: "BP", numeric: true },
  { key: "seo", label: "SEO", numeric: true },
  { key: "nextMaintenance", label: "Next maint", numeric: false },
  { key: "nextTesting", label: "Next test", numeric: false },
  { key: "lastAudit", label: "Last audit", numeric: false },
];

/** Href that re-requests /fleet with the given sort applied and the ACTIVE
 *  filters preserved. Filters only appear when set, so default views keep
 *  clean, shareable URLs. */
export function sortHref(m: FleetTableModel, key: FleetSortKey): string {
  const p = new URLSearchParams();
  p.set("sort", key);
  // Clicking the active column toggles direction; any other column starts asc.
  p.set("dir", m.query.sort === key && m.query.dir === "asc" ? "desc" : "asc");
  if (m.query.status) p.set("status", m.query.status);
  if (m.query.q) p.set("q", m.query.q);
  return `/fleet?${p.toString()}`;
}

export function sortArrow(m: FleetTableModel, key: FleetSortKey): string {
  return m.query.sort === key ? (m.query.dir === "asc" ? " ▲" : " ▼") : "";
}

export type StatusOption = { value: string; label: string; selected: boolean };

/** The status filter's options. Derived from the DATA, so the filter in force
 *  is named even when no site carries it (a stale bookmark, or a value renamed
 *  out from under it); otherwise the browser would show "All statuses" above
 *  an empty table. */
export function statusOptions(m: FleetTableModel): StatusOption[] {
  const active = m.query.status;
  const noStatus = noStatusFilterActive(active, m.statuses);
  const opts: StatusOption[] = [{ value: "", label: "All statuses", selected: false }];
  // Offered unless a stored status literally equals the sentinel — in which case
  // the data owns the value and a second option carrying it would be a lie.
  if (!m.statuses.includes(NO_STATUS_FILTER)) {
    opts.push({ value: NO_STATUS_FILTER, label: "(no status set)", selected: noStatus });
  }
  for (const s of m.statuses) opts.push({ value: s, label: s, selected: s === active });
  if (active !== "" && !noStatus && !m.statuses.includes(active)) {
    opts.push({ value: active, label: `${active} (no matching sites)`, selected: true });
  }
  return opts;
}
