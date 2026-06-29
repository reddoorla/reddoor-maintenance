import type {
  CockpitModel,
  SubmissionEntry,
  NeedsYouItem,
  NeedsYouGroup,
  RecentEntry,
} from "./fleet-cockpit.js";
import { fleetLastAuditedAt, buildNeedsYouFeed } from "./fleet-cockpit.js";
import type { FleetEventType } from "../db/fleet-events.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml } from "../util/html.js";
import { FAVICON_LINK } from "./favicon.js";
import { renderFleetBrowsePanel, FLEET_BROWSE_SCRIPT } from "./fleet-browse-render.js";

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 1100px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } }
h1 { margin: 0 0 0.25rem; font-size: 1.75rem; }
.meta { color: #666; margin-bottom: 1.5rem; }
.empty { color: #999; padding: 2rem; text-align: center; border: 1px dashed #ccc; border-radius: 6px; }
.cards { display: flex; flex-direction: column; gap: 0.75rem; }
.card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 0.9rem 1.1rem; }
@media (prefers-color-scheme: dark) { .card { border-color: #2a2a2a; background: #181818; } }
.card-head { display: flex; flex-wrap: wrap; gap: 0.5rem 1.25rem; align-items: baseline; }
.card-head .site { font-weight: 600; font-size: 1.05rem; }
.card-head .url { color: #666; font-size: 0.85rem; }
.card-head .setup, .card-head .audited { color: #666; font-size: 0.85rem; }
.card-head .setup { margin-left: auto; }
.card-metrics { display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; margin-top: 0.5rem; font-variant-numeric: tabular-nums; }
.cluster { display: inline-flex; gap: 0.5rem; align-items: baseline; }
.cluster.lighthouse .score { display: inline-block; min-width: 2.25rem; text-align: right; }
.metric-label { color: #999; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; }
.metric { font-feature-settings: "tnum"; }
.metric.deploy { font-size:0.78rem; padding:0.05rem 0.4rem; border-radius:6px; text-decoration:none; }
.metric.deploy.ready { background:#e6f4ea; color:#1a7f37; }
.metric.deploy.failed { background:#fdecea; color:#b00; font-weight:600; }
.metric.deploy.building { background:#fff4e5; color:#9a6700; }
.metric.deploy.unknown { color:#999; }
@media (prefers-color-scheme: dark) {
  .metric.deploy.ready { background:#0f2417; color:#4ac26b; }
  .metric.deploy.failed { background:#3a1412; color:#ff6b6b; }
  .metric.deploy.building { background:#2e2410; color:#e3b341; }
}
.spam-rollup { font-size:0.9rem; margin-bottom:1rem; }
.muted { color:#999; }
.filters { display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:1.25rem; }
.filters button { font:inherit; font-size:0.85rem; padding:0.25rem 0.7rem; border:1px solid #ccc; border-radius:999px; background:transparent; color:inherit; cursor:pointer; }
.filters button[aria-pressed="true"] { background:#1a1a1a; color:#fff; border-color:#1a1a1a; }
@media (prefers-color-scheme: dark) { .filters button[aria-pressed="true"] { background:#e8e8e8; color:#111; } }
.fleet-actions { margin-bottom:1.25rem; }
.refresh-fleet { font:inherit; font-size:0.85rem; padding:0.3rem 0.8rem; border:1px solid #1a1a1a; border-radius:999px; background:#1a1a1a; color:#fff; cursor:pointer; }
.refresh-fleet:disabled { opacity:0.6; cursor:default; }
@media (prefers-color-scheme: dark) { .refresh-fleet { background:#e8e8e8; color:#111; border-color:#e8e8e8; } }
.rf-status { margin-top:0.6rem; font-size:0.85rem; }
.rf-row { padding:0.1rem 0; }
.rf-row a { margin-left:0.3rem; }
.rf-sub { color:#999; font-size:0.8rem; margin-left:1.1rem; }
.rf-spin { display:inline-block; width:0.8em; height:0.8em; border:2px solid #999; border-top-color:transparent; border-radius:50%; animation:rf-spin 0.8s linear infinite; vertical-align:-0.1em; }
@keyframes rf-spin { to { transform:rotate(360deg); } }
details.fleet-browse, details.inbox { margin:0.75rem 0; }
details.fleet-browse > summary, details.inbox > summary { cursor:pointer; font-weight:700; font-size:1.05rem; padding:0.35rem 0; list-style:none; }
.approve-row { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; padding:0.25rem 0; }
.pill { font-size:0.75rem; padding:0.1rem 0.5rem; border-radius:999px; font-weight:700; }
.pill.attention { background:#fdecea; color:#b00; }
.pill.watch { background:#fff4e5; color:#a65a00; }
.pill.healthy { background:#e8f5e9; color:#1b7a2f; }
.chips { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.5rem; }
.chip { font-size:0.8rem; padding:0.1rem 0.5rem; border-radius:6px; background:#f0f0f0; }
@media (prefers-color-scheme: dark) { .chip { background:#222; } }
.chip.critical { background:#fdecea; color:#b00; }
.chip.stuck { border:1px solid #b00; font-weight:600; }
.badge { font-weight:700; color:#C00; font-size:0.72rem; margin-right:0.25rem; }
.verdict { border-radius:8px; padding:0.9rem 1.1rem; margin-bottom:1.25rem; }
.verdict .verdict-line { font-weight:800; font-size:1.4rem; }
.verdict .verdict-meta { color:#666; font-size:0.9rem; margin-top:0.2rem; }
.verdict.ok { background:#e8f5e9; color:#1b7a2f; }
.verdict.ok .verdict-meta { color:#2e7d32; }
.verdict.warn { background:#fdecea; color:#b00; }
.verdict.warn .verdict-meta { color:#b00; opacity:0.85; }
.verdict.watch { background:#fff4e5; color:#a65a00; }
.verdict.watch .verdict-meta { color:#a65a00; opacity:0.85; }
.verdict.soft { background:#e7f1ff; color:#1c5d99; }
.verdict.soft .verdict-meta { color:#1c5d99; opacity:0.85; }
@media (prefers-color-scheme: dark) { .verdict.ok { background:#10240f; color:#7fce85; } .verdict.warn { background:#2a0f0d; color:#ff8a80; } .verdict.watch { background:#2a2410; color:#ffd454; } .verdict.soft { background:#0f1d2a; color:#7fb6e8; } }
.verdict .fleet-actions { margin:0.6rem 0 0; }
.needs-you { border:1px solid #e5e5e5; border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.25rem; }
@media (prefers-color-scheme: dark) { .needs-you { border-color:#2a2a2a; background:#181818; } }
.needs-you h2 { font-size:1.05rem; margin:0 0 0.5rem; }
.feed-group-label { text-transform:uppercase; letter-spacing:0.04em; font-size:0.72rem; color:#999; margin:0.6rem 0 0.2rem; }
.feed-row { display:flex; gap:0.5rem; align-items:center; padding:0.3rem 0; border-bottom:1px dashed #eee; }
.feed-row:last-child { border-bottom:0; }
@media (prefers-color-scheme: dark) { .feed-row { border-bottom-color:#262626; } }
.feed-what { flex:1; }
.feed-open { white-space:nowrap; }
.dot { width:0.55rem; height:0.55rem; border-radius:50%; display:inline-block; flex:0 0 auto; }
.dot.broken { background:#dc2626; }
.dot.approval { background:#2563eb; }
.dot.watch { background:#f59e0b; }
`;

/** Per-band site counts for the verdict, derived from the Needs-you feed. PURE. */
function needsYouCounts(feed: NeedsYouItem[]): {
  broken: number;
  watch: number;
  approval: number;
} {
  let broken = 0;
  let watch = 0;
  let approval = 0;
  for (const i of feed) {
    if (i.group === "broken") broken++;
    else if (i.group === "watch") watch++;
    else approval++;
  }
  return { broken, watch, approval };
}

/** The glance verdict — worst band wins. Green "✓ All clear" on an empty feed; else
 *  red (any broken), amber (watch, nothing broken), or blue (only approvals). Every
 *  lower band's count + the healthy count ride in the meta line (zero terms omitted),
 *  followed by the audit-recency suffix. Houses the ↻ Audit button + live panel.
 *  CSS-class ↔ band map: ok=empty, warn=broken, watch=watch, soft=approval — `warn`
 *  and `soft` are inherited from the prior binary verdict, so they differ from the
 *  feed's `broken`/`approval` group names. */
function verdictBar(model: CockpitModel, feed: NeedsYouItem[]): string {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const auditedTerm = auditedIso
    ? `fleet last audited ${escapeHtml(relativeTimeFromNow(auditedIso))}`
    : null;
  const total = model.cards.length;
  const { broken, watch, approval } = needsYouCounts(feed);
  // Clamp: feed counts include pending-report sites, which (rarely) may not be among
  // the visible cards, so total − feed could otherwise underflow to a negative "healthy".
  const healthy = Math.max(0, total - (broken + watch + approval));
  const actions = `<div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Audit fleet</button>
      <div id="rf-status" class="rf-status" aria-live="polite"></div>
    </div>`;
  const render = (cls: string, line: string, terms: Array<string | null>): string =>
    `<div class="verdict ${cls}">
    <div class="verdict-line">${line}</div>
    <div class="verdict-meta">${terms.filter(Boolean).join(" · ")}</div>
    ${actions}
  </div>`;

  if (broken === 0 && watch === 0 && approval === 0) {
    const sitesWord = `${total} site${total === 1 ? "" : "s"}`;
    return render("ok", "✓ All clear", [`${sitesWord} healthy`, auditedTerm]);
  }

  // Count terms are integer-derived static English — no escaping needed (unlike auditedTerm).
  const watchTerm = watch > 0 ? `${watch} watching` : null;
  const approvalTerm = approval > 0 ? `${approval} waiting on you` : null;
  const healthyTerm = healthy > 0 ? `${healthy} healthy` : null;

  if (broken > 0) {
    return render("warn", `⚠ ${broken} site${broken === 1 ? "" : "s"} broken`, [
      watchTerm,
      approvalTerm,
      healthyTerm,
      auditedTerm,
    ]);
  }
  if (watch > 0) {
    return render("watch", `${watch} site${watch === 1 ? "" : "s"} to watch`, [
      approvalTerm,
      healthyTerm,
      auditedTerm,
    ]);
  }
  return render("soft", `${approval} waiting on you`, [healthyTerm, auditedTerm]);
}

const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  watch: "Watch",
  approval: "Waiting on your yes",
};

/** The single per-site triage feed. Every row is navigation-only: one Open ▸ to the
 *  site page (where approve / Trigger Renovate / checklist already live). */
function renderNeedsYouFeed(feed: NeedsYouItem[]): string {
  if (feed.length === 0) return "";
  const groups: NeedsYouGroup[] = ["broken", "watch", "approval"];
  const blocks = groups
    .map((g) => {
      const rows = feed.filter((i) => i.group === g);
      if (rows.length === 0) return "";
      const lis = rows
        .map(
          (i) => `<div class="feed-row" data-group="${g}">
          <span class="dot ${g}"></span>
          <span class="feed-what"><strong>${escapeHtml(i.siteName)}</strong> — ${escapeHtml(i.reasons.join(" · "))}</span>
          <a class="feed-open" href="${escapeHtml(i.url)}">Open ▸</a>
        </div>`,
        )
        .join("");
      return `<div class="feed-group"><div class="feed-group-label">${NEEDS_YOU_GROUP_LABEL[g]}</div>${lis}</div>`;
    })
    .join("");
  return `<section class="needs-you"><h2>Needs you (${feed.length})</h2>${blocks}</section>`;
}

/** Most submissions to render in the cockpit inbox lane. The summary still shows the
 *  true fleet total; overflow is triaged on each site's page (which lists 25). */
const SUBMISSIONS_STRIP_CAP = 10;

const RECENT_ICON: Record<FleetEventType, string> = {
  pr_automerged: "🔧",
  vuln_cleared: "🛡",
  ci_recovered: "✅",
  site_launched: "🚀",
  cert_renewed: "🔒",
  fleet_swept: "🔄",
};

/** The calm "Recently" lane: what the fleet did for you, collapsed by default
 *  (reassurance, not an alarm). One row per event: icon · site + summary · when ·
 *  optional link (PR url, else /s/<slug>). Returns "" when there is nothing. */
function renderRecentlyLane(model: CockpitModel): string {
  const events: RecentEntry[] = model.recent ?? [];
  if (events.length === 0) return "";
  const rows = events
    .map((e) => {
      const icon = RECENT_ICON[e.type] ?? "•";
      const when = escapeHtml(relativeTimeFromNow(e.ts));
      const site = e.siteName ? `<strong>${escapeHtml(e.siteName)}</strong> — ` : "";
      const link = e.url
        ? `<a href="${escapeHtml(e.url)}">view ▸</a>`
        : e.slug
          ? `<a href="/s/${escapeHtml(e.slug)}">open ▸</a>`
          : "";
      return `<div class="recent-row" data-type="${e.type}">
        <span class="recent-icon">${icon}</span>
        <span class="recent-what">${site}${escapeHtml(e.summary)}</span>
        <span class="muted">${when}</span>
        ${link}
      </div>`;
    })
    .join("");
  return `<details class="recently">
    <summary>🔧 Recently (${events.length})</summary>
    ${rows}
  </details>`;
}

/** The quiet inbox lane: newest submissions + the 30-day spam roll-up, in one collapsed
 *  <details>. Submissions are a separate work stream — they never raise the verdict. */
function renderInboxLane(model: CockpitModel): string {
  const subs: SubmissionEntry[] = model.submissions ?? [];
  const spam = model.spam;
  const hasSpam = !!spam && (spam.caught > 0 || spam.through > 0);
  if (subs.length === 0 && !hasSpam) return "";

  const shown = [...subs]
    .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
    .slice(0, SUBMISSIONS_STRIP_CAP);
  const rows = shown
    .map((sub) => {
      const href = `/s/${escapeHtml(sub.slug)}`;
      const when = sub.submittedAt ? escapeHtml(relativeTimeFromNow(sub.submittedAt)) : "";
      const who = escapeHtml(sub.name || sub.email);
      return `<div class="approve-row" data-signal="submissions">
        <strong>${escapeHtml(sub.siteName)}</strong>
        <span class="muted">${escapeHtml(sub.formType)} — ${who}</span>
        <span class="muted">${when}</span>
        <a href="${href}">open ▸</a>
      </div>`;
    })
    .join("");
  const overflow = subs.length - shown.length;
  const more =
    overflow > 0
      ? `<div class="approve-row subm-more muted"><a href="/submissions">+${overflow} more — view all submissions</a></div>`
      : `<div class="approve-row subm-more muted"><a href="/submissions">View all submissions →</a></div>`;
  const spamLine = hasSpam
    ? `<div class="spam-rollup muted">🛡 Spam (30d) — caught ${spam!.caught} · through ${spam!.through}</div>`
    : "";
  const spamInSummary = hasSpam ? " · 🛡 Spam (30d)" : "";
  return `<details class="inbox">
    <summary>📥 Submissions (${subs.length} new)${spamInSummary}</summary>
    ${rows}${subs.length > 0 ? more : ""}
    ${spamLine}
  </details>`;
}

const AUDIT_SCRIPT = `<script>
(function(){
  // fleet-refresh live status: dispatch, then poll the actual runs and follow them.
  // Vanilla JS, string-concat only (no template literals) — this lives inside a TS
  // template string, so backticks or interpolation syntax would break the server render.
  var RF_KEY = 'reddoor:fleet-refresh';
  var RF_POLL_MS = 10000;
  var RF_MAX_MS = 90 * 60 * 1000; // safety ceiling; a full fleet Lighthouse run was ~48 min (2026-06-24)
  function rfPanel(){ return document.getElementById('rf-status'); }
  function rfStop(){ try { localStorage.removeItem(RF_KEY); } catch(e){} }
  // Per-workflow ETA hint (the lighthouse fleet sweep runs ~48 min; security ~1-2 min).
  function rfEta(label){ return label === 'lighthouse' ? '~48m' : label === 'security' ? '~2m' : ''; }
  // Map a raw GitHub step name to a coarse human phase. Order matters (the audit step
  // name also contains 'browser'; 'playwright install' also contains 'install').
  function rfPhase(step){
    if (!step) return '';
    var s = step.toLowerCase();
    if (s.indexOf('audit') !== -1 || s.indexOf('lighthouse') !== -1) return 'auditing the fleet…';
    if (s.indexOf('build') !== -1) return 'building…';
    if (s.indexOf('playwright') !== -1 || s.indexOf('browser') !== -1) return 'installing browsers…';
    if (s.indexOf('install') !== -1 || s.indexOf('depend') !== -1) return 'installing dependencies…';
    if (s.indexOf('set up') !== -1 || s.indexOf('checkout') !== -1) return 'setting up…';
    return step;
  }
  // Safe to build raw HTML: workflow/state/step are server-fixed (enums + GitHub step
  // names) and url is GitHub's own html_url for our central repo — none are
  // user-supplied. Don't interpolate untrusted fields here without escaping.
  function rfRender(status, startedAt){
    var failed = function(s){ return s === 'failure' || s === 'cancelled' || s === 'timed_out'; };
    var mins = Math.floor((Date.now() - startedAt) / 60000);
    var elapsed = mins < 1 ? '<1m' : mins + 'm';
    return status.perWorkflow.map(function(w){
      var label = w.workflow.replace('.yml','').replace('fleet-','');
      var done = w.state === 'success';
      var isFailed = failed(w.state);
      var icon = done ? '✓' : isFailed ? '✗' : '<span class="rf-spin"></span>';
      var line = icon + ' ' + label + ' — ' + w.state.replace('_',' ');
      if (!done && !isFailed){
        var phase = rfPhase(w.step);
        var eta = rfEta(label);
        var detail = [];
        if (phase) detail.push(phase);
        detail.push(elapsed + (eta ? ' / ' + eta : ''));
        var link = w.url ? ' · <a href="'+w.url+'" target="_blank" rel="noopener">view run ↗</a>' : '';
        line += '<div class="rf-sub">' + detail.join(' · ') + link + '</div>';
      } else if (isFailed && w.url){
        line += ' <a href="'+w.url+'" target="_blank" rel="noopener">run</a>';
      }
      return '<div class="rf-row">' + line + '</div>';
    }).join('');
  }
  function rfPoll(since, startedAt){
    fetch('/api/fleet/refresh/status?since=' + encodeURIComponent(since)).then(function(res){
      if (res.status === 401) return { authFail: true };
      return res.ok ? res.json() : null;
    }).then(function(data){
      var p = rfPanel();
      if (data && data.authFail){
        if (p) p.innerHTML += '<div class="rf-row">Session expired — reload to sign in.</div>';
        if (rf){ rf.disabled = false; rf.textContent = '↻ Audit fleet'; }
        rfStop(); return;
      }
      if (data && data.status){
        if (p) p.innerHTML = rfRender(data.status, startedAt);
        if (data.status.allDone){
          if (!data.status.anyFailure){
            if (p) p.innerHTML += '<div class="rf-row">✓ Done — reloading…</div>';
            rfStop(); setTimeout(function(){ location.reload(); }, 2000); return;
          }
          if (p) p.innerHTML += '<div class="rf-row"><button type="button" onclick="location.reload()">Reload</button></div>';
          if (rf){ rf.disabled = false; rf.textContent = '↻ Audit fleet'; }
          rfStop(); return;
        }
      }
      if (Date.now() - startedAt > RF_MAX_MS){
        if (p) p.innerHTML += '<div class="rf-row">Still running — reload later.</div>';
        if (rf){ rf.disabled = false; rf.textContent = '↻ Audit fleet'; }
        rfStop(); return;
      }
      setTimeout(function(){ rfPoll(since, startedAt); }, RF_POLL_MS);
    }).catch(function(){
      var p = rfPanel();
      if (Date.now() - startedAt > RF_MAX_MS){
        if (p) p.innerHTML += '<div class="rf-row">Still running — reload later.</div>';
        if (rf){ rf.disabled = false; rf.textContent = '↻ Audit fleet'; }
        rfStop(); return;
      }
      setTimeout(function(){ rfPoll(since, startedAt); }, RF_POLL_MS);
    });
  }
  function rfBegin(since, startedAt){
    try { localStorage.setItem(RF_KEY, JSON.stringify({ since: since, startedAt: startedAt })); } catch(e){}
    var p = rfPanel(); if (p) p.innerHTML = '<div class="rf-row"><span class="rf-spin"></span> starting…</div>';
    rfPoll(since, startedAt);
  }
  var rf = document.querySelector('button.refresh-fleet');
  if (rf) rf.addEventListener('click', async function(){
    if (!confirm('Kick off the security + Lighthouse sweeps for the whole fleet? They take a few minutes.')) return;
    rf.disabled = true; rf.textContent = 'Auditing…';
    try {
      var res = await fetch(rf.dataset.refreshUrl, { method: 'POST' });
      if (res.ok){
        var data = await res.json();
        rf.textContent = '↻ Audit running…';
        if (data && data.since) rfBegin(data.since, Date.now());
      } else { rf.textContent = 'Failed to start'; rf.disabled = false; }
    } catch(e){ rf.textContent = 'Failed to start'; rf.disabled = false; }
  });
  // Resume-on-reload: if a refresh is in flight (<90 min old), keep following it.
  try {
    var rfSaved = JSON.parse(localStorage.getItem(RF_KEY) || 'null');
    if (rfSaved && rfSaved.since && rfSaved.startedAt && (Date.now() - rfSaved.startedAt) < RF_MAX_MS){
      if (rf){ rf.disabled = true; rf.textContent = '↻ Audit running…'; }
      rfBegin(rfSaved.since, rfSaved.startedAt);
    } else if (rfSaved) { rfStop(); }
  } catch(e){}
})();
</script>`;

/**
 * Render the fleet cockpit as a single HTML document. Pure function: no Airtable
 * access, no env reads, no I/O. The Netlify function handler builds the
 * CockpitModel (visible-site filter, tiering, NEW/WORSE badging, pending list)
 * and hands it here. Renders the doc shell + verdict bar + the per-site Needs-you
 * feed + the collapsed Fleet browse panel (one flat, filterable card grid).
 */
export function renderCockpitHtml(model: CockpitModel): string {
  const total = model.cards.length;
  const feed = buildNeedsYouFeed(model);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${FAVICON_LINK}
  <title>Reddoor maintenance — fleet cockpit</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet cockpit</h1>
  <div class="meta">${total} site${total === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${verdictBar(model, feed)}
  ${renderNeedsYouFeed(feed)}
  ${renderFleetBrowsePanel(model)}
  ${renderRecentlyLane(model)}
  ${renderInboxLane(model)}
  ${AUDIT_SCRIPT}
  ${FLEET_BROWSE_SCRIPT}
</body>
</html>`;
}
