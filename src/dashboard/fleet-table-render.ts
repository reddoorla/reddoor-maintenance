/** Server-rendered HTML for the fleet table (#539 Phase 4). Sorting and
 *  filtering are plain links/GET-form re-requests with query params — the
 *  house idiom — and the page ships ZERO inline JS by design (one raw `\n`
 *  in a served template literal once killed a whole inline <script> while
 *  the page looked fine; a link cannot fail that way). */
import { FAVICON_LINK } from "./favicon.js";
import { escapeHtml, safeUrl } from "../util/html.js";
import type { FleetSortKey, FleetTableModel, FleetTableRow } from "./fleet-table.js";

const DASH = "—";

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.home { display: inline-block; margin-bottom: 0.75rem; }
.meta { color: #666; margin-bottom: 1.25rem; }
.muted { color: #999; }
.empty { color: #999; padding: 1rem; border: 1px dashed #ccc; border-radius: 6px; text-align: center; }
.filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem; align-items: center; }
.filters select, .filters input, .filters button { font: inherit; padding: 0.3rem 0.5rem; }
.fleet-table-wrap { overflow-x: auto; }
table.fleet { border-collapse: collapse; width: 100%; font-size: 0.9rem; }
table.fleet th, table.fleet td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #8883; white-space: nowrap; }
table.fleet th a { text-decoration: none; }
table.fleet td.num { text-align: right; font-variant-numeric: tabular-nums; }
table.fleet th.num { text-align: right; }
`;

/** Columns in display order: header label + the sort key its header toggles. */
const COLUMNS: ReadonlyArray<{ key: FleetSortKey; label: string; numeric: boolean }> = [
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
function sortHref(m: FleetTableModel, key: FleetSortKey): string {
  const p = new URLSearchParams();
  p.set("sort", key);
  // Clicking the active column toggles direction; any other column starts asc.
  p.set("dir", m.query.sort === key && m.query.dir === "asc" ? "desc" : "asc");
  if (m.query.status) p.set("status", m.query.status);
  if (m.query.q) p.set("q", m.query.q);
  return `/fleet?${p.toString()}`;
}

function headerCell(m: FleetTableModel, col: (typeof COLUMNS)[number]): string {
  const active = m.query.sort === col.key;
  const arrow = active ? (m.query.dir === "asc" ? " ▲" : " ▼") : "";
  const cls = col.numeric ? ' class="num"' : "";
  return `<th${cls}><a href="${escapeHtml(sortHref(m, col.key))}">${escapeHtml(col.label)}</a>${arrow}</th>`;
}

function score(v: number | null): string {
  return v === null ? DASH : escapeHtml(String(v));
}

/** Date cell: the calendar-date part of a date-only or ISO-timestamp value,
 *  full raw value on hover for timestamps. */
function dateCell(v: string | null): string {
  if (v === null) return DASH;
  const day = v.slice(0, 10);
  return day === v ? escapeHtml(day) : `<span title="${escapeHtml(v)}">${escapeHtml(day)}</span>`;
}

function row(r: FleetTableRow): string {
  const url = safeUrl(r.url);
  const urlCell =
    url === "#"
      ? `<span class="muted">${DASH}</span>`
      : `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(r.url)}</a>`;
  const status = r.status === null ? DASH : escapeHtml(r.status);
  return `<tr class="fleet-row">
    <td><a href="/s/${escapeHtml(r.slug)}">${escapeHtml(r.name)}</a></td>
    <td>${urlCell}</td>
    <td>${status}</td>
    <td class="num">${score(r.pScore)}</td>
    <td class="num">${score(r.rScore)}</td>
    <td class="num">${score(r.bpScore)}</td>
    <td class="num">${score(r.seoScore)}</td>
    <td>${dateCell(r.nextMaintenanceAt)}</td>
    <td>${dateCell(r.nextTestingAt)}</td>
    <td>${dateCell(r.lastLighthouseAuditAt)}</td>
  </tr>`;
}

function filterForm(m: FleetTableModel): string {
  const statusOpts = [
    '<option value="">All statuses</option>',
    ...m.statuses.map(
      (s) =>
        `<option value="${escapeHtml(s)}"${s === m.query.status ? " selected" : ""}>${escapeHtml(s)}</option>`,
    ),
  ].join("");
  return `<form class="filters" method="get" action="/fleet">
    <select name="status">${statusOpts}</select>
    <input type="search" name="q" placeholder="Filter by name or slug" value="${escapeHtml(m.query.q)}" />
    <button type="submit">Apply</button>
    <a class="muted" href="/fleet">Clear</a>
  </form>`;
}

/** Render the fleet table as a standalone HTML document. */
export function renderFleetTableHtml(m: FleetTableModel): string {
  const table =
    m.rows.length === 0
      ? `<div class="empty">No sites match these filters.</div>`
      : `<div class="fleet-table-wrap"><table class="fleet">
    <thead><tr>${COLUMNS.map((c) => headerCell(m, c)).join("")}</tr></thead>
    <tbody>${m.rows.map(row).join("")}</tbody>
  </table></div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>Fleet table — Reddoor maintenance</title>
  <style>${STYLES}</style>
</head>
<body>
  <a class="home" href="/">← Fleet home</a>
  <h1>Fleet table</h1>
  <div class="meta">${m.rows.length} of ${m.totalSites} site${m.totalSites === 1 ? "" : "s"}</div>
  ${filterForm(m)}
  ${table}
</body>
</html>`;
}
