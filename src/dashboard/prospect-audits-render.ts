import { escapeHtml, safeUrl } from "../util/html.js";
import { FAVICON_LINK } from "./favicon.js";
import { renderAuthChrome } from "./auth/render.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { isValidToken, type ProspectAuditListItem } from "../db/prospect-audits.js";

/** Model for the `GET /audits` cockpit page. Pure-render input — the
 *  `.mts` handler does the auth + Turso read and hands this in. `now` is
 *  explicit (not `new Date()` inline) so the "when it ran" column is
 *  deterministic in tests, matching every other renderer in this module. */
export type ProspectAuditsPageModel = {
  audits: ProspectAuditListItem[];
  now: Date;
  /** The signed-in operator, for the page chrome. Null when entry came through
   *  the shared-password fallback, which has no identity to show. */
  operatorEmail?: string | null;
};

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
h2 { font-size: 1.1rem; margin: 1.75rem 0 0.75rem; }
.home { display: inline-block; font-size: 0.9rem; margin-bottom: 0.75rem; text-decoration: none; }
.meta { color: #666; margin-bottom: 1.25rem; }
.muted { color: #999; }
.empty { color: #999; padding: 1.5rem; text-align: center; border: 1px dashed #ccc; border-radius: 6px; }
.run-form { display: flex; flex-direction: column; gap: 0.75rem; border: 1px solid #e5e5e5; border-radius: 8px; padding: 1rem 1.1rem; }
@media (prefers-color-scheme: dark) { .run-form { border-color: #2a2a2a; background: #181818; } }
.run-form label { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; font-weight: 600; }
/* font-size:16px on the inputs, not the surrounding 0.9rem label text, keeps
   iOS Safari from zooming the viewport on focus — the whole point of this
   page is being usable from a phone. */
.run-form input[type="url"], .run-form input[type="text"] {
  font: 16px system-ui, -apple-system, sans-serif;
  padding: 0.6rem 0.7rem;
  border: 1px solid #ccc;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  width: 100%;
  box-sizing: border-box;
}
@media (prefers-color-scheme: dark) { .run-form input[type="url"], .run-form input[type="text"] { border-color: #444; } }
.run-form button {
  font: inherit;
  font-size: 1rem;
  font-weight: 700;
  padding: 0.7rem 1rem;
  border: 1px solid #1a1a1a;
  border-radius: 6px;
  background: #1a1a1a;
  color: #fff;
  cursor: pointer;
  min-height: 44px;
}
.run-form button:disabled { opacity: 0.6; cursor: default; }
@media (prefers-color-scheme: dark) { .run-form button { background: #e8e8e8; color: #111; border-color: #e8e8e8; } }
.run-note { font-size: 0.85rem; color: #666; margin: 0.75rem 0 0; }
@media (prefers-color-scheme: dark) { .run-note { color: #999; } }
.run-status { margin-top: 0.75rem; font-size: 0.9rem; min-height: 1.2em; }
.run-status a { margin-left: 0.4rem; }
.run-status.is-error { color: #b00; }
@media (prefers-color-scheme: dark) { .run-status.is-error { color: #ff8a80; } }
.audit-list { display: flex; flex-direction: column; gap: 0.6rem; }
.audit-row { border: 1px solid #e5e5e5; border-radius: 8px; padding: 0.75rem 1rem; }
@media (prefers-color-scheme: dark) { .audit-row { border-color: #2a2a2a; background: #181818; } }
.audit-row-head { display: flex; flex-wrap: wrap; gap: 0.4rem 0.75rem; align-items: baseline; }
.audit-business { font-weight: 700; }
.audit-url { font-size: 0.85rem; color: #666; word-break: break-all; }
@media (prefers-color-scheme: dark) { .audit-url { color: #999; } }
.audit-when { font-size: 0.8rem; color: #999; margin-left: auto; }
.audit-row-foot { margin-top: 0.4rem; font-size: 0.85rem; }
.pill { font-size: 0.75rem; padding: 0.1rem 0.5rem; border-radius: 999px; font-weight: 700; }
.pill.complete { background: #e8f5e9; color: #1b7a2f; }
.pill.partial { background: #fff4e5; color: #a65a00; }
@media (prefers-color-scheme: dark) { .pill.complete { background: #10240f; color: #7fce85; } .pill.partial { background: #2a2410; color: #ffd454; } }
`;

// Vanilla JS, string-concat only (no template literals / backticks) — this
// lives inside a TS template string, so any backtick would end the outer
// literal early and a stray single-backslash escape is consumed at BUILD
// time (turning into a literal newline that breaks the parse of the whole
// <script> block) — see the identical warning in render.ts. Server strings
// (the response's `message`) are assigned via textContent only, never
// innerHTML, so they stay inert even though they may contain a hostname.
const RUN_SCRIPT = `<script>
(function () {
  var form = document.getElementById('audit-run-form');
  if (!form) return;
  var status = document.getElementById('audit-run-status');
  var button = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var url = form.elements.url.value.trim();
    var business = form.elements.business.value.trim();
    if (status) {
      status.className = 'run-status';
      status.textContent = '';
    }
    if (button) { button.disabled = true; button.textContent = 'Starting…'; }
    fetch('/api/prospect-audit/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url, business: business }),
    })
      .then(function (res) {
        return res.json().catch(function () { return null; }).then(function (data) {
          return { ok: res.ok, data: data };
        });
      })
      .then(function (result) {
        if (!status) return;
        var data = result.data;
        var message = data && data.message ? data.message : (result.ok ? 'Audit started.' : 'Failed to start the audit.');
        status.textContent = message;
        if (!result.ok) status.className = 'run-status is-error';
        if (data && data.reportUrl) {
          var link = document.createElement('a');
          link.href = data.reportUrl;
          link.textContent = 'View existing report →';
          status.appendChild(link);
        }
        if (result.ok && form) form.reset();
      })
      .catch(function () {
        if (status) {
          status.className = 'run-status is-error';
          status.textContent = 'Failed to start the audit — network error.';
        }
      })
      .finally(function () {
        if (button) { button.disabled = false; button.textContent = 'Run audit'; }
      });
  });
})();
</script>`;

function statusPill(status: string): string {
  const cls = status === "complete" ? "complete" : "partial";
  const label = status === "complete" ? "Complete" : "Partial";
  return `<span class="pill ${cls}">${label}</span>`;
}

/** One row of the recent-audits list. Every field originating in the row is
 *  untrusted-ish (the business name was read off a stranger's site by a
 *  model) — escaped as text, and the audited url goes through `safeUrl`
 *  before it's used as an href. The `/r/{token}` link is built from a token
 *  this same codebase generates (crypto-random, `isValidToken`-shaped) —
 *  guarded with `isValidToken` and omitted entirely on a shape mismatch
 *  rather than trusted blindly. */
function auditRow(a: ProspectAuditListItem, now: Date): string {
  const when = escapeHtml(relativeTimeFromNow(a.created_at, now));
  const business = a.business
    ? `<span class="audit-business">${escapeHtml(a.business)}</span>`
    : `<span class="audit-business muted">(no business name)</span>`;
  const href = safeUrl(a.url);
  const urlLine =
    href === "#"
      ? `<div class="audit-url">${escapeHtml(a.url)}</div>`
      : `<div class="audit-url"><a href="${href}">${escapeHtml(a.url)}</a></div>`;
  const reportLink = isValidToken(a.token)
    ? `<a href="/r/${escapeHtml(a.token)}">View report →</a>`
    : `<span class="muted">Report unavailable</span>`;
  return `<div class="audit-row">
    <div class="audit-row-head">
      ${business}
      ${statusPill(a.status)}
      <span class="audit-when">${when}</span>
    </div>
    ${urlLine}
    <div class="audit-row-foot">${reportLink}</div>
  </div>`;
}

function auditsList(model: ProspectAuditsPageModel): string {
  if (model.audits.length === 0) {
    return `<div class="empty">No audits yet — run one above.</div>`;
  }
  return `<div class="audit-list">${model.audits.map((a) => auditRow(a, model.now)).join("")}</div>`;
}

/**
 * Render the `GET /audits` cockpit page: a form to trigger a new prospect
 * audit, and the recent-audits list. Pure function — no I/O, no env reads.
 *
 * Deliberately has NO polling and NO live-progress UI: a run takes minutes
 * and the result arrives by email (see `.run-note` below), so there is
 * nothing on this page that would need to refresh itself. Refreshing the
 * page (or checking email) is the "did it finish" check.
 */
export function renderProspectAuditsPageHtml(model: ProspectAuditsPageModel): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>Prospect audits — Reddoor maintenance</title>
  <style>${STYLES}</style>
</head>
<body>
  ${renderAuthChrome(model.operatorEmail)}
  <a class="home" href="/">← Fleet home</a>
  <h1>Prospect audits</h1>
  <div class="meta">Run a Lighthouse + AI-visibility audit against a prospect's site.</div>

  <form id="audit-run-form" class="run-form">
    <label>URL
      <input type="url" name="url" placeholder="https://example.com" required />
    </label>
    <label>Business name (optional)
      <input type="text" name="business" placeholder="Acme Roofing" />
    </label>
    <button type="submit">Run audit</button>
    <div id="audit-run-status" class="run-status" aria-live="polite"></div>
  </form>
  <p class="run-note">A run takes a few minutes and the result arrives by email — there is nothing to watch here, so feel free to close this page.</p>

  <h2>Recent audits</h2>
  ${auditsList(model)}
  ${RUN_SCRIPT}
</body>
</html>`;
}
