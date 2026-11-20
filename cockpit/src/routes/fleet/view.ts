import {
  ALL_STATUSES_FILTER,
  NO_STATUS_FILTER,
  allStatusesFilterActive,
  noStatusFilterActive,
} from "../../../../src/dashboard/fleet-table.js";
import type { FleetSortKey, FleetTableModel } from "../../../../src/dashboard/fleet-table.js";
import type { HealthCheckName } from "../../lib/overview/view.js";

/** The checks the overview's "Is every site live?" table showed, moved here
 *  (P1-87, PR 2). They sit just before Level, as they did there; they are not
 *  sortable. */
export const FACT_COLUMNS = ["Live", "Certificate", "Deploy", "Forms"] as const;

/** The fact column that shows a check's own cell (P1-87, PR 8b). Security, Accessibility
 *  and Build + tests have no column here, so nothing is marked for them. */
export const CHECK_COLUMN: Partial<Record<HealthCheckName, (typeof FACT_COLUMNS)[number]>> = {
  Live: "Live",
  Certificate: "Certificate",
  Deploy: "Deploy",
  "Contact form": "Forms",
};

/** The check filter the route resolved (P1-87, PR 8b): a known check with its failing and
 *  unread counts, or the slug no check has (named on the page; the table is left whole). */
export type CheckFilter =
  { slug: string; name: HealthCheckName; failing: number; unread: number } | { unknown: string };

/** The line above the table: "Failing Certificate: 2 sites". */
export function failingLine(c: { name: HealthCheckName; failing: number }): string {
  return `Failing ${c.name}: ${c.failing} ${c.failing === 1 ? "site" : "sites"}`;
}

/** A cell's verdict as the overview styled it. */
export const okClass = (ok: boolean | null): "ok" | "bad" | "unknown" =>
  ok === true ? "ok" : ok === false ? "bad" : "unknown";

/** Columns in display order: header label + the sort key its header toggles. */
export const COLUMNS: ReadonlyArray<{ key: FleetSortKey; label: string; numeric: boolean }> = [
  { key: "name", label: "Site", numeric: false },
  { key: "url", label: "URL", numeric: false },
  { key: "status", label: "Status", numeric: false },
  { key: "level", label: "Level", numeric: false },
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
  if (m.query.check) p.set("check", m.query.check);
  return `/fleet?${p.toString()}`;
}

export function sortArrow(m: FleetTableModel, key: FleetSortKey): string {
  return m.query.sort === key ? (m.query.dir === "asc" ? " ↑" : " ↓") : "";
}

/** Href that shows every site, the hidden archived and external ones included,
 *  keeping the sort in force. Offered only on the default view, which has no
 *  status or search to carry. */
export function showHiddenHref(m: FleetTableModel): string {
  const p = new URLSearchParams();
  p.set("sort", m.query.sort);
  p.set("dir", m.query.dir);
  p.set("status", ALL_STATUSES_FILTER);
  if (m.query.check) p.set("check", m.query.check);
  return `/fleet?${p.toString()}`;
}

/** The check line's "Show all sites": every site the check does not narrow, keeping the
 *  sort, status and search and dropping the check (P1-87, PR 8b). */
export function allSitesHref(m: FleetTableModel): string {
  const p = new URLSearchParams();
  p.set("sort", m.query.sort);
  p.set("dir", m.query.dir);
  if (m.query.status) p.set("status", m.query.status);
  if (m.query.q) p.set("q", m.query.q);
  return `/fleet?${p.toString()}`;
}

export type StatusOption = { value: string; label: string; selected: boolean };

/** The status filter's options. Derived from the DATA, so the filter in force
 *  is named even when no site carries it (a stale bookmark, or a value renamed
 *  out from under it); otherwise the browser would show "All statuses" above
 *  an empty table. The "" option is the default view, which hides archived and
 *  external sites; "All statuses" brings them back. */
export function statusOptions(m: FleetTableModel): StatusOption[] {
  const active = m.query.status;
  const noStatus = noStatusFilterActive(active, m.statuses);
  const allStatuses = allStatusesFilterActive(active, m.statuses);
  const opts: StatusOption[] = [
    { value: "", label: "Current (archived & external hidden)", selected: false },
  ];
  // Each sentinel is offered unless a stored status literally equals it — in
  // which case the data owns the value and a second option carrying it would be
  // a lie.
  if (!m.statuses.includes(ALL_STATUSES_FILTER)) {
    opts.push({ value: ALL_STATUSES_FILTER, label: "All statuses", selected: allStatuses });
  }
  if (!m.statuses.includes(NO_STATUS_FILTER)) {
    opts.push({ value: NO_STATUS_FILTER, label: "(no status set)", selected: noStatus });
  }
  for (const s of m.statuses) opts.push({ value: s, label: s, selected: s === active });
  if (active !== "" && !noStatus && !allStatuses && !m.statuses.includes(active)) {
    opts.push({ value: active, label: `${active} (no matching sites)`, selected: true });
  }
  return opts;
}
