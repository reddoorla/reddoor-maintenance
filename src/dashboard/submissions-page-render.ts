import { FAVICON_LINK } from "./favicon.js";
import { escapeHtml } from "../util/html.js";
import {
  renderSubmissionRow,
  SUBMISSION_STATUS_SCRIPT,
  SUBMISSION_STYLES,
} from "./submission-view.js";
import { SUBMISSION_STATUSES } from "../reports/submission-row.js";
import { SUBMISSION_FORM_TYPES } from "../forms/types.js";
import type { SubmissionsPageModel } from "./submissions-page.js";

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 1.25rem; }
.muted { color: #999; }
.empty { color: #999; padding: 1rem; border: 1px dashed #ccc; border-radius: 6px; text-align: center; }
.pill { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 700; }
.home { display: inline-block; font-size: 0.9rem; margin-bottom: 0.75rem; text-decoration: none; }
.filters { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; margin-bottom: 1.25rem; }
.filters select, .filters input { font: inherit; padding: 0.25rem 0.5rem; border: 1px solid #ccc; border-radius: 4px; background: transparent; color: inherit; }
@media (prefers-color-scheme: dark) { .filters select, .filters input { border-color: #444; } }
.filters button { font: inherit; padding: 0.25rem 0.75rem; border: 1px solid #2c7; border-radius: 4px; background: #2c7; color: #fff; cursor: pointer; }
.filters a { font-size: 0.9rem; }
.pager { display: flex; gap: 1rem; align-items: center; margin-top: 1.25rem; }
.subm-site { font-size: 0.8rem; font-weight: 700; display: inline-block; margin-right: 0.5rem; }
.subm-row-wrap { display: flex; align-items: flex-start; gap: 0.5rem; }
.subm-row-wrap .subm-item { flex: 1; min-width: 0; }
`;

function opt(value: string, label: string, active: string): string {
  const sel = value === active ? " selected" : "";
  return `<option value="${escapeHtml(value)}"${sel}>${escapeHtml(label)}</option>`;
}

function filterForm(m: SubmissionsPageModel): string {
  const f = m.filter;
  const siteOpts = [
    '<option value="">All sites</option>',
    ...m.sites.map((s) => opt(s.slug, s.name, f.site)),
  ].join("");
  const typeOpts = [
    '<option value="">All types</option>',
    ...SUBMISSION_FORM_TYPES.map((t) => opt(t, t, f.type)),
  ].join("");
  const statusOpts = [
    '<option value="">All statuses</option>',
    ...SUBMISSION_STATUSES.map((s) => opt(s, s, f.status)),
  ].join("");
  return `<form class="filters" method="get" action="/submissions">
    <select name="site">${siteOpts}</select>
    <select name="type">${typeOpts}</select>
    <select name="status">${statusOpts}</select>
    <input type="search" name="q" placeholder="Search name/email/message" value="${escapeHtml(f.q)}" />
    <input type="date" name="from" value="${escapeHtml(f.from)}" />
    <input type="date" name="to" value="${escapeHtml(f.to)}" />
    <button type="submit">Apply</button>
    <a class="muted" href="/submissions">Clear</a>
  </form>`;
}

function pageHref(m: SubmissionsPageModel, page: number): string {
  const p = new URLSearchParams();
  const f = m.filter;
  if (f.site) p.set("site", f.site);
  if (f.type) p.set("type", f.type);
  if (f.status) p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  if (f.from) p.set("from", f.from);
  if (f.to) p.set("to", f.to);
  p.set("page", String(page));
  return `/submissions?${p.toString()}`;
}

function pager(m: SubmissionsPageModel): string {
  const pages = Math.max(1, Math.ceil(m.total / m.pageSize));
  if (pages <= 1) return "";
  const prev =
    m.page > 1
      ? `<a href="${escapeHtml(pageHref(m, m.page - 1))}">← Prev</a>`
      : `<span class="muted">← Prev</span>`;
  const next =
    m.page < pages
      ? `<a href="${escapeHtml(pageHref(m, m.page + 1))}">Next →</a>`
      : `<span class="muted">Next →</span>`;
  return `<div class="pager">${prev}<span class="muted">Page ${m.page} of ${pages}</span>${next}</div>`;
}

function rowWithSite(r: SubmissionsPageModel["rows"][number]): string {
  const siteLink = r.slug
    ? `<a class="subm-site" href="/s/${escapeHtml(r.slug)}">${escapeHtml(r.siteName)}</a>`
    : `<span class="subm-site muted">${escapeHtml(r.siteName)}</span>`;
  return `<div class="subm-row-wrap">${siteLink}${renderSubmissionRow(r)}</div>`;
}

/** Render the full submissions fleet page as a standalone HTML document. */
export function renderSubmissionsPageHtml(m: SubmissionsPageModel): string {
  const body =
    m.total === 0
      ? `<div class="empty">No submissions match these filters.</div>`
      : `<div class="meta">${m.total} submission${m.total === 1 ? "" : "s"}</div>
       <ul class="subm-list">${m.rows.map(rowWithSite).join("")}</ul>
       ${pager(m)}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>Submissions — Reddoor maintenance</title>
  <style>${STYLES}${SUBMISSION_STYLES}</style>
</head>
<body>
  <a class="home" href="/">← Fleet home</a>
  <h1>Submissions</h1>
  ${filterForm(m)}
  ${body}
  <script>${SUBMISSION_STATUS_SCRIPT}</script>
</body>
</html>`;
}
