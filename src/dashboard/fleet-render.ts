import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type {
  CockpitModel,
  SiteCard,
  Tier,
  SubmissionEntry,
  NeedsYouItem,
  NeedsYouGroup,
} from "./fleet-cockpit.js";
import { fleetLastAuditedAt, buildNeedsYouFeed } from "./fleet-cockpit.js";
import { onboardingStatus, missingOnboarding } from "./onboarding.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";
import { FAVICON_LINK } from "./favicon.js";

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
  // dashboard password (no per-site token). Cockpit visibility is Status-based;
  // the caller filters the fleet view.
  const href = `/s/${escapeHtml(siteSlug(site.name))}`;
  const onboarding = onboardingStatus(site);
  const missing = missingOnboarding(site);
  const setupTitle = escapeHtml(
    missing.length === 0 ? "Setup complete" : `Missing: ${missing.join(", ")}`,
  );
  const audited = relativeTimeFromNow(site.lastLighthouseAuditAt);
  const safeSiteUrl = escapeHtml(safeUrl(site.url));
  const visibleUrl = escapeHtml(site.url);

  return `<article class="card">
    <header class="card-head">
      <a class="site" href="${href}">${name}</a>
      <a class="url" href="${safeSiteUrl}" target="_blank" rel="noopener">${visibleUrl}</a>
      <span class="setup" title="${setupTitle}">Setup: <strong>${onboarding.score}/${onboarding.total}</strong></span>
      <span class="audited">Audited: <strong>${escapeHtml(audited)}</strong></span>
    </header>
    <div class="card-metrics">
      <span class="cluster lighthouse">
        <span class="metric-label">Perf</span> ${scoreSpan("perf", site.pScore)}
        <span class="metric-label">Access</span> ${scoreSpan("a11y-lh", site.rScore)}
        <span class="metric-label">BP</span> ${scoreSpan("bp", site.bpScore)}
        <span class="metric-label">SEO</span> ${scoreSpan("seo", site.seoScore)}
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
.spam-rollup { font-size:0.9rem; margin-bottom:1rem; }
.muted { color:#999; }
.subm-viewall { font-size:0.8rem; font-weight:normal; margin-left:0.4rem; white-space:nowrap; }
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
.chip.stuck { border:1px solid #b00; font-weight:600; }
.badge { font-weight:700; color:#C00; font-size:0.72rem; margin-right:0.25rem; }
.all-clear { background:#e8f5e9; color:#1b7a2f; padding:0.6rem 1rem; border-radius:8px; margin-bottom:1.25rem; font-weight:600; }
@media (prefers-color-scheme: dark) { .all-clear { background:#10240f; color:#7fce85; } }
.verdict { border-radius:8px; padding:0.9rem 1.1rem; margin-bottom:1.25rem; }
.verdict .verdict-line { font-weight:800; font-size:1.4rem; }
.verdict .verdict-meta { color:#666; font-size:0.9rem; margin-top:0.2rem; }
.verdict.ok { background:#e8f5e9; color:#1b7a2f; }
.verdict.ok .verdict-meta { color:#2e7d32; }
.verdict.warn { background:#fdecea; color:#b00; }
.verdict.warn .verdict-meta { color:#b00; opacity:0.85; }
@media (prefers-color-scheme: dark) { .verdict.ok { background:#10240f; color:#7fce85; } .verdict.warn { background:#2a0f0d; color:#ff8a80; } }
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
.dot.slipping { background:#f59e0b; }
`;

const TIER_META: Record<Tier, { emoji: string; label: string; open: boolean }> = {
  attention: { emoji: "🔴", label: "Needs attention", open: true },
  watch: { emoji: "🟡", label: "Watch", open: false },
  healthy: { emoji: "🟢", label: "Healthy", open: false },
};

// Kept for a later cockpit task that re-introduces the filter UI; not rendered yet.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "auto-fix-failed",
  "stale",
  "no-domain",
  "pending",
  "submissions",
] as const;

/** The glance verdict: "✓ All clear", or "⚠ N sites need you". N is the per-site
 *  Needs-you feed length (NOT submissions). Houses the ↻ Audit button + live panel. */
function verdictBar(model: CockpitModel, feedCount: number): string {
  const auditedIso = fleetLastAuditedAt(model.cards);
  const audited = auditedIso
    ? ` · fleet last audited ${escapeHtml(relativeTimeFromNow(auditedIso))}`
    : "";
  const sites = model.cards.length;
  const sitesWord = `${sites} site${sites === 1 ? "" : "s"}`;
  const actions = `<div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Audit fleet</button>
      <div id="rf-status" class="rf-status" aria-live="polite"></div>
    </div>`;
  if (feedCount === 0) {
    return `<div class="verdict ok">
      <div class="verdict-line">✓ All clear</div>
      <div class="verdict-meta">${sitesWord} healthy${audited}</div>
      ${actions}
    </div>`;
  }
  const noun = feedCount === 1 ? "site needs" : "sites need";
  return `<div class="verdict warn">
    <div class="verdict-line">⚠ ${feedCount} ${noun} you</div>
    <div class="verdict-meta">${sitesWord}${audited}</div>
    ${actions}
  </div>`;
}

/** One-line fleet spam roll-up beneath the summary: caught (honeypot+too-fast) vs
 *  through (marked spam) over the window. Omitted when there's no spam data, so a
 *  fleet with no screen-out buckets reads clean rather than "caught 0 · through 0". */
function spamRollup(model: CockpitModel): string {
  const s = model.spam;
  if (!s || (s.caught === 0 && s.through === 0)) return "";
  return `<div class="spam-rollup muted">🛡 Spam (30d) — caught ${s.caught} · through ${s.through}</div>`;
}

const NEEDS_YOU_GROUP_LABEL: Record<NeedsYouGroup, string> = {
  broken: "Broken",
  approval: "Waiting on your yes",
  slipping: "Slipping",
};

/** The single per-site triage feed. Every row is navigation-only: one Open ▸ to the
 *  site page (where approve / Trigger Renovate / checklist already live). */
function renderNeedsYouFeed(feed: NeedsYouItem[]): string {
  if (feed.length === 0) return "";
  const groups: NeedsYouGroup[] = ["broken", "approval", "slipping"];
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

/** Most submissions to render in the cockpit strip. The heading still shows the
 *  true fleet total; overflow is triaged on each site's page (which lists 25). */
const SUBMISSIONS_STRIP_CAP = 10;

function submissionsStrip(model: CockpitModel): string {
  const subs: SubmissionEntry[] = model.submissions ?? [];
  if (subs.length === 0) return "";
  // Render the newest N only — the strip is a triage prompt, not the inbox. Sort
  // defensively (the builder preserves input order, which is already newest-first).
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
      : "";
  return `<section class="approve-strip subm-strip" data-tier="submissions">
    <h2>📥 New submissions (${subs.length}) <a class="subm-viewall" href="/submissions">View all →</a></h2>
    ${rows}${more}
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
    const cls = it.autoFixExhausted
      ? "chip critical stuck"
      : it.severity === "critical"
        ? "chip critical"
        : "chip";
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
  if (c.items.some((it) => it.autoFixExhausted)) kinds.add("auto-fix-failed");
  for (const sig of c.watchSignals) kinds.add(sig);
  return [...kinds].join(" ");
}

/** On-demand Renovate trigger button — only for repo-backed sites (nothing to
 *  dispatch otherwise). Posts to the authed /api/sites/:slug/trigger-renovate. */
function triggerRenovateBtn(c: SiteCard): string {
  if (!c.site.gitRepo?.trim()) return "";
  const url = `/api/sites/${escapeHtml(siteSlug(c.site.name))}/trigger-renovate`;
  return `<button class="trigger-renovate" data-trigger-url="${url}">Trigger Renovate</button>`;
}

function cockpitCard(c: SiteCard): string {
  const base = card(c.site); // existing header + metrics markup
  const pill = `<span class="pill ${c.tier}">${PILL_LABEL[c.tier]}</span>`;
  const extra = `${pill}${chips(c)}${submBadge(c)}${triggerRenovateBtn(c)}`;
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
  // trigger-renovate buttons: fire the on-demand dispatch (async, fire-and-forget).
  document.querySelectorAll('button.trigger-renovate').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Dispatching…';
      try { var res = await fetch(b.dataset.triggerUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Dispatched ✓' : 'Failed';
        if (!res.ok) b.disabled = false; }
      catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
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
 * feed + three <details> tier sections of cards.
 */
export function renderCockpitHtml(model: CockpitModel): string {
  const total = model.cards.length;
  const feed = buildNeedsYouFeed(model);
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
  ${FAVICON_LINK}
  <title>Reddoor maintenance — fleet cockpit</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor fleet cockpit</h1>
  <div class="meta">${total} site${total === 1 ? "" : "s"} on the Reddoor stack.</div>
  ${verdictBar(model, feed.length)}
  ${renderNeedsYouFeed(feed)}
  ${sections}
  ${spamRollup(model)}
  ${submissionsStrip(model)}
  ${FILTER_SCRIPT}
</body>
</html>`;
}
