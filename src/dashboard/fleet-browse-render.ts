import type { WebsiteRow } from "../reports/airtable/websites.js";
import { siteSlug } from "../reports/airtable/websites.js";
import type { CockpitModel, SiteCard, Tier } from "./fleet-cockpit.js";
import { isReadyDeployStatus, isFailedDeployStatus } from "./fleet-cockpit.js";
import { onboardingStatus, missingOnboarding } from "./onboarding.js";
import { relativeTimeFromNow } from "./relative-time.js";
import { escapeHtml, safeUrl } from "../util/html.js";

const DASH = "—";

// ---- MOVED VERBATIM from fleet-render.ts (do not change their bodies) ----

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
  majorOutdated: number | null,
): string {
  if (drifted === null || majorBehind === null) {
    return `<span class="metric deps">${DASH}</span>`;
  }
  // Declared-range drift vs baseline, plus the real outdated-install count when
  // it was determined (null = not checked this run → omit, don't imply clean).
  const driftPart = drifted === 0 ? "0" : `${drifted} drifted (${majorBehind} major)`;
  // The outdated part carries its own "(N major)" — majors behind npm latest,
  // distinct from the baseline "(major)" on driftPart. Shown only when known.
  const outdatedPart =
    outdated === null
      ? ""
      : ` · ${outdated} outdated${majorOutdated === null ? "" : ` (${majorOutdated} major)`}`;
  return `<span class="metric deps">${escapeHtml(driftPart + outdatedPart)}</span>`;
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
        <span class="metric-label">deps</span> ${depsSpan(site.depsDrifted, site.depsMajorBehind, site.depsOutdated, site.depsMajorOutdated)}
        <span class="metric-label">sec</span> ${securitySpan(
          site.securityVulnsCritical,
          site.securityVulnsHigh,
          site.securityVulnsModerate,
          site.securityVulnsLow,
        )}
        <span class="metric-label">deploy</span> ${deployBadge(site)}
      </span>
    </div>
  </article>`;
}

/** Small colored deploy badge: green = ready/success, red = failed, grey =
 *  unknown/none. Shows the deploy state + a relative "Xd ago" timestamp, and links
 *  to the deploy log when one is known. PURE. A null state renders a grey "—" (the
 *  site has no Netlify id wired, or no deploy was read this run). */
function deployBadge(site: WebsiteRow): string {
  const state = site.deployStatus;
  if (state === null) {
    return `<span class="metric deploy unknown" title="No deploy data">${DASH}</span>`;
  }
  const cls = isReadyDeployStatus(state)
    ? "deploy ready"
    : isFailedDeployStatus(state)
      ? "deploy failed"
      : "deploy building";
  const when = relativeTimeFromNow(site.lastDeployAt);
  const label = escapeHtml(`${state}${when !== DASH ? ` · ${when}` : ""}`);
  // Only link when we have a real http(s) URL — scheme-allowlist it via safeUrl (which
  // returns "#" for anything non-http), since deployLogUrl is data that flowed in from
  // the Netlify API via Airtable. A "#" fallback would be a dead link, so drop it.
  const url = site.deployLogUrl ? safeUrl(site.deployLogUrl) : "#";
  if (url !== "#") {
    return `<a class="metric ${cls}" href="${escapeHtml(url)}" target="_blank" rel="noopener">${label}</a>`;
  }
  return `<span class="metric ${cls}">${label}</span>`;
}

function submBadge(c: SiteCard): string {
  const n = c.newSubmissions ?? 0;
  return n > 0 ? `<span class="chip">📥 ${n} new</span>` : "";
}

const PILL_LABEL: Record<Tier, string> = {
  attention: "failing",
  watch: "watch",
  healthy: "ok",
  "pre-launch": "pre-launch",
};

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
  for (const reason of c.acceptedReasons)
    items.push(`<span class="chip accepted">✓ accepted: ${escapeHtml(reason)}</span>`);
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

/** Signal filters for the Fleet panel — card-derived tags only. `pending` lives in the
 *  Needs-you feed and `submissions` in the Inbox lane, so they are not card filters. */
const FLEET_FILTERS = [
  "all",
  "vulns",
  "lighthouse",
  "delivery",
  "prs",
  "ci",
  "auto-fix-failed",
  "stale",
  "no-domain",
] as const;

/** The fleet browser: one collapsed <details> holding the filter chips and a single flat
 *  card grid (cards already ordered attention→watch→healthy by buildCockpitModel).
 *  Flattening — no nested per-tier <details> — is what makes the filters actually work:
 *  a filtered card can never hide inside a collapsed tier. */
export function renderFleetBrowsePanel(model: CockpitModel): string {
  const total = model.cards.length;
  const chips = FLEET_FILTERS.map(
    (f) =>
      `<button type="button" data-filter="${f}" aria-pressed="${f === "all" ? "true" : "false"}">${f}</button>`,
  ).join("");
  const body =
    total === 0
      ? `<div class="empty">No sites on the fleet view yet.</div>`
      : `<div class="cards">${model.cards.map(cockpitCard).join("")}</div>`;
  return `<details class="fleet-browse">
    <summary>Fleet (${total})</summary>
    <div class="filters">${chips}</div>
    ${body}
  </details>`;
}

/** Client behavior scoped to the Fleet panel: tag-based card filtering + the per-card
 *  Trigger Renovate dispatch. String-concat only (lives inside a TS template literal). */
export const FLEET_BROWSE_SCRIPT = `<script>
(function(){
  var btns = document.querySelectorAll('.fleet-browse .filters button');
  var cards = document.querySelectorAll('.fleet-browse .cards .card');
  btns.forEach(function(b){
    b.addEventListener('click', function(){
      var f = b.getAttribute('data-filter');
      btns.forEach(function(x){ x.setAttribute('aria-pressed', x===b ? 'true':'false'); });
      cards.forEach(function(c){
        var sig = (c.getAttribute('data-signals')||'').split(' ');
        c.style.display = (f==='all' || sig.indexOf(f)!==-1) ? '' : 'none';
      });
    });
  });
  document.querySelectorAll('.fleet-browse button.trigger-renovate').forEach(function(b){
    b.addEventListener('click', async function(){
      b.disabled = true; b.textContent = 'Dispatching…';
      try { var res = await fetch(b.dataset.triggerUrl, { method: 'POST' });
        b.textContent = res.ok ? 'Dispatched ✓' : 'Failed';
        if (!res.ok) b.disabled = false; }
      catch(e){ b.textContent = 'Failed'; b.disabled = false; }
    });
  });
})();
</script>`;
