import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { CockpitModel, SiteCard, Tier, SubmissionEntry } from "./fleet-cockpit.js";
import { onboardingStatus } from "./onboarding.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

const DASH = "—";

function scoreSpan(category: "perf" | "a11y-lh" | "bp" | "seo", value: number | null): string {
  const display = value === null ? DASH : String(value);
  return `<span class="score ${category}">${escapeHtml(display)}</span>`;
}

function a11ySpan(value: number | null): string {
  const display = value === null ? DASH : String(value);
  return `<span class="metric a11y">${escapeHtml(display)}</span>`;
}

function depsSpan(
  drifted: number | null,
  majorBehind: number | null,
  outdated: number | null,
): string {
  if (drifted === null || majorBehind === null) {
    return `<span class="metric deps">${DASH}</span>`;
  }
  // Declared-range drift vs baseline, plus the real outdated-install count when
  // it was determined (null = not checked this run → omit, don't imply clean).
  const driftPart = drifted === 0 ? "0" : `${drifted} drifted (${majorBehind} major)`;
  const display = outdated === null ? driftPart : `${driftPart} · ${outdated} outdated`;
  return `<span class="metric deps">${escapeHtml(display)}</span>`;
}

function securitySpan(
  critical: number | null,
  high: number | null,
  moderate: number | null,
  low: number | null,
): string {
  if (critical === null || high === null || moderate === null || low === null) {
    return `<span class="metric sec">${DASH}</span>`;
  }
  const total = critical + high + moderate + low;
  const display = total === 0 ? "0" : `${critical}C/${high}H/${moderate}M/${low}L`;
  return `<span class="metric sec">${escapeHtml(display)}</span>`;
}

function card(site: WebsiteRow): string {
  const name = escapeHtml(site.name);
  // The per-site dashboard at /s/<slug> is operator-only, gated by the shared
  // dashboard password (no per-site token). dashboardToken is now just the
  // fleet-homepage visibility flag; the caller filters on it.
  const href = `/s/${escapeHtml(siteSlug(site.name))}`;
  const onboarding = onboardingStatus(site);
  const audited = relativeTimeFromNow(site.lastLighthouseAuditAt);
  const safeSiteUrl = escapeHtml(safeUrl(site.url));
  const visibleUrl = escapeHtml(site.url);

  return `<article class="card">
    <header class="card-head">
      <a class="site" href="${href}">${name}</a>
      <a class="url" href="${safeSiteUrl}" target="_blank" rel="noopener">${visibleUrl}</a>
      <span class="setup">Setup: <strong>${onboarding.score}/${onboarding.total}</strong></span>
      <span class="audited">Audited: <strong>${escapeHtml(audited)}</strong></span>
    </header>
    <div class="card-metrics">
      <span class="cluster lighthouse">
        ${scoreSpan("perf", site.pScore)}
        ${scoreSpan("a11y-lh", site.rScore)}
        ${scoreSpan("bp", site.bpScore)}
        ${scoreSpan("seo", site.seoScore)}
      </span>
      <span class="cluster health">
        <span class="metric-label">a11y</span> ${a11ySpan(site.a11yViolations)}
        <span class="metric-label">deps</span> ${depsSpan(site.depsDrifted, site.depsMajorBehind, site.depsOutdated)}
        <span class="metric-label">sec</span> ${securitySpan(
          site.securityVulnsCritical,
          site.securityVulnsHigh,
          site.securityVulnsModerate,
          site.securityVulnsLow,
        )}
      </span>
    </div>
  </article>`;
}

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
.summary { display:flex; flex-wrap:wrap; gap:0.5rem 1.25rem; align-items:baseline; margin-bottom:0.5rem; }
.summary .tier { font-weight:700; }
.summary .heads { color:#666; font-size:0.9rem; }
.filters { display:flex; flex-wrap:wrap; gap:0.4rem; margin-bottom:1.25rem; }
.filters button { font:inherit; font-size:0.85rem; padding:0.25rem 0.7rem; border:1px solid #ccc; border-radius:999px; background:transparent; color:inherit; cursor:pointer; }
.filters button[aria-pressed="true"] { background:#1a1a1a; color:#fff; border-color:#1a1a1a; }
@media (prefers-color-scheme: dark) { .filters button[aria-pressed="true"] { background:#e8e8e8; color:#111; } }
details.tier { margin:0.75rem 0; }
details.tier > summary { cursor:pointer; font-weight:700; font-size:1.05rem; padding:0.35rem 0; list-style:none; }
.approve-strip { border:1px solid #ffe08a; background:#fff8e1; border-radius:8px; padding:0.75rem 1rem; margin-bottom:1.25rem; }
@media (prefers-color-scheme: dark) { .approve-strip { background:#241f00; border-color:#5a4d00; } }
.approve-strip h2 { font-size:1rem; margin:0 0 0.5rem; }
.approve-row { display:flex; flex-wrap:wrap; gap:0.5rem 1rem; align-items:center; padding:0.25rem 0; }
.pill { font-size:0.75rem; padding:0.1rem 0.5rem; border-radius:999px; font-weight:700; }
.pill.attention { background:#fdecea; color:#b00; }
.pill.watch { background:#fff4e5; color:#a65a00; }
.pill.healthy { background:#e8f5e9; color:#1b7a2f; }
.chips { display:flex; flex-wrap:wrap; gap:0.4rem; margin-top:0.5rem; }
.chip { font-size:0.8rem; padding:0.1rem 0.5rem; border-radius:6px; background:#f0f0f0; }
@media (prefers-color-scheme: dark) { .chip { background:#222; } }
.chip.critical { background:#fdecea; color:#b00; }
.badge { font-weight:700; color:#C00; font-size:0.72rem; margin-right:0.25rem; }
.all-clear { background:#e8f5e9; color:#1b7a2f; padding:0.6rem 1rem; border-radius:8px; margin-bottom:1.25rem; font-weight:600; }
@media (prefers-color-scheme: dark) { .all-clear { background:#10240f; color:#7fce85; } }
`;

const TIER_META: Record<Tier, { emoji: string; label: string; open: boolean }> = {
  attention: { emoji: "🔴", label: "Needs attention", open: true },
  watch: { emoji: "🟡", label: "Watch", open: false },
  healthy: { emoji: "🟢", label: "Healthy", open: false },
};

const FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "stale",
  "pending",
  "submissions",
] as const;

function summaryBar(model: CockpitModel): string {
  const s = model.summary;
  const heads = [
    `${s.criticalHighVulns} critical/high vuln${s.criticalHighVulns === 1 ? "" : "s"}`,
    `${s.lighthouseBelowFloor} Lighthouse<75`,
    `${s.deliveryFailures} delivery`,
    `${s.renovateFailing} PRs failing`,
    `${s.ciRed} CI red`,
    `${s.pending} pending`,
    `${s.newSubmissions ?? 0} new`,
  ].join(" · ");
  const chips = FILTERS.map(
    (f) =>
      `<button type="button" data-filter="${f}" aria-pressed="${f === "all" ? "true" : "false"}">${f}</button>`,
  ).join("");
  return `<div class="summary">
      <span class="tier">🔴 ${s.attention} needs attention</span>
      <span class="tier">🟡 ${s.watch} watch</span>
      <span class="tier">🟢 ${s.healthy} healthy</span>
    </div>
    <div class="summary heads">${escapeHtml(heads)}</div>
    <div class="filters">${chips}</div>`;
}

/** Affirmative all-clear when nothing is on the 🔴 tier (spec §5.2/§12) — so a
 *  healthy or empty fleet reads as "all clear", not three bare "None." rows. */
function allClearBanner(model: CockpitModel): string {
  if (model.summary.attention > 0) return "";
  const msg =
    model.cards.length === 0
      ? "No sites on the fleet view yet."
      : "All clear — nothing needs your attention.";
  return `<div class="all-clear">✓ ${escapeHtml(msg)}</div>`;
}

function approveStrip(model: CockpitModel): string {
  if (model.pending.length === 0) return "";
  const rows = model.pending
    .map((p) => {
      const href = `/s/${escapeHtml(p.slug)}`;
      const url = `/api/reports/${encodeURIComponent(p.reportId)}/approve`;
      return `<div class="approve-row" data-signal="pending">
        <strong>${escapeHtml(p.siteName)}</strong>
        <span class="muted">${escapeHtml(p.reportType)} ${escapeHtml(p.period)}</span>
        <button class="approve" data-report-id="${escapeHtml(p.reportId)}" data-approve-url="${url}">Approve</button>
        <a href="${href}">open ▸</a>
      </div>`;
    })
    .join("");
  return `<section class="approve-strip" data-tier="pending">
    <h2>Approve (${model.pending.length}) — your daily yes</h2>
    ${rows}
  </section>`;
}

function submissionsStrip(model: CockpitModel): string {
  const subs: SubmissionEntry[] = model.submissions ?? [];
  if (subs.length === 0) return "";
  const rows = subs
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
  return `<section class="approve-strip subm-strip" data-tier="submissions">
    <h2>📥 New submissions (${subs.length})</h2>
    ${rows}
  </section>`;
}

function submBadge(c: SiteCard): string {
  const n = c.newSubmissions ?? 0;
  return n > 0 ? `<span class="chip">📥 ${n} new</span>` : "";
}

const PILL_LABEL: Record<Tier, string> = { attention: "failing", watch: "watch", healthy: "ok" };

function attentionBadge(status?: string): string {
  if (status === "new") return `<span class="badge">NEW</span>`;
  if (status === "worse") return `<span class="badge">WORSE</span>`;
  return "";
}

function chips(c: SiteCard): string {
  const items = c.items.map((it) => {
    const cls = it.severity === "critical" ? "chip critical" : "chip";
    return `<span class="${cls}">${attentionBadge(it.status)}${escapeHtml(it.title)}</span>`;
  });
  for (const reason of c.watchReasons)
    items.push(`<span class="chip">${escapeHtml(reason)}</span>`);
  return items.length ? `<div class="chips">${items.join("")}</div>` : "";
}

/** Space-separated signal tags for the client filter. Attention-item kinds
 *  ("vulns"/"lighthouse"/"delivery"/"prs" from renovate/"ci") plus the structured
 *  watch signals ("lighthouse" for a sub-floor-band score, "stale" for an old
 *  commit) — so a watch-band Lighthouse card still matches the "lighthouse" filter. */
function signalsAttr(c: SiteCard): string {
  const kinds = new Set<string>();
  for (const it of c.items) {
    kinds.add(it.kind === "vuln" ? "vulns" : it.kind === "renovate" ? "prs" : it.kind);
  }
  for (const sig of c.watchSignals) kinds.add(sig);
  return [...kinds].join(" ");
}

function cockpitCard(c: SiteCard): string {
  const base = card(c.site); // existing header + metrics markup
  const pill = `<span class="pill ${c.tier}">${PILL_LABEL[c.tier]}</span>`;
  const extra = `${pill}${chips(c)}${submBadge(c)}`;
  const opening = `<article class="card" data-signals="${signalsAttr(c)}">`;
  // Inject the pill + chips before the article's closing tag, and add the filter
  // hook. Function replacers so a `$` in escaped chip text can't be read as a
  // String.replace special ($&, $1, …).
  return base
    .replace('<article class="card">', () => opening)
    .replace("</article>", () => `${extra}</article>`);
}

const FILTER_SCRIPT = `<script>
(function(){
  var btns = document.querySelectorAll('.filters button');
  var cards = document.querySelectorAll('.cards .card');
  var details = document.querySelectorAll('details.tier');
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      var f = b.getAttribute('data-filter');
      btns.forEach(function(x){ x.setAttribute('aria-pressed', x===b ? 'true':'false'); });
      // "pending" lives on the approve strip, not on tier cards — just jump to it,
      // never hide the triage cards (else the whole board blanks).
      if (f === 'pending') { var s = document.querySelector('.approve-strip'); if (s) s.scrollIntoView({behavior:'smooth'}); return; }
      if (f === 'submissions') { var ss = document.querySelector('[data-tier="submissions"]'); if (ss) ss.scrollIntoView({behavior:'smooth'}); return; }
      if (f !== 'all') details.forEach(function(d){ d.open = true; });
      cards.forEach(function(c){
        var sig = (c.getAttribute('data-signals')||'').split(' ');
        c.style.display = (f==='all' || sig.indexOf(f)!==-1) ? '' : 'none';
      });
    });
  });
  // approve buttons: mirror the per-site dashboard's inline POST.
  document.querySelectorAll('button.approve').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Approving…';
      try { var res = await fetch(b.dataset.approveUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Approved ✓' : 'Failed'; }
      catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
})();
</script>`;

/**
 * Render the fleet cockpit as a single HTML document. Pure function: no Airtable
 * access, no env reads, no I/O. The Netlify function handler builds the
 * CockpitModel (visible-site filter, tiering, NEW/WORSE badging, pending list)
 * and hands it here. Renders the doc shell + summary bar + filter chips + pinned
 * approve strip + three <details> tier sections of cards.
 */
export function renderCockpitHtml(model: CockpitModel): string {
  const total = model.cards.length;
  const tiers: Tier[] = ["attention", "watch", "healthy"];
  const sections = tiers
    .map((tier) => {
      const cards = model.cards.filter((c) => c.tier === tier);
      const meta = TIER_META[tier];
      const body =
        cards.length === 0
          ? `<div class="empty">None.</div>`
          : `<div class="cards">${cards.map(cockpitCard).join("")}</div>`;
      return `<details class="tier" data-tier="${tier}"${meta.open ? " open" : ""}>
        <summary>${meta.emoji} ${meta.label} (${cards.length})</summary>
        ${body}
      </details>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Reddoor maintenance — fleet cockpit</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet cockpit</h1>
  <div class="meta">${total} site${total === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${summaryBar(model)}
  ${allClearBanner(model)}
  ${approveStrip(model)}
  ${submissionsStrip(model)}
  ${sections}
  ${FILTER_SCRIPT}
</body>
</html>`;
}
