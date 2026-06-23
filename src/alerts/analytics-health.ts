import { escapeHtml } from "../util/html.js";

/**
 * The GA/Search enrichment outcome of one `report --due` draft run, aggregated
 * across the sites it drafted. `softFailedSites` is how many drafted sites had GA
 * OR Search enrichment ERROR (not "not configured" — that's a legitimate skip);
 * `configuredSites` is how many drafted sites had analytics configured at all
 * (the subject is set AND the site has a GA4 property or a search query). The ratio
 * is what distinguishes a fleet-wide subject outage from a single transient blip.
 */
export type AnalyticsRunHealth = {
  softFailedSites: number;
  configuredSites: number;
};

export type AnalyticsAlert = { fire: boolean; reason: string };

/** A lone failure never alerts — that's a per-site config issue, not the shared-
 *  subject SPOF. Two-plus AND a majority of configured sites is the fleet signature. */
const MIN_FAILED_SITES = 2;

/**
 * Decide whether a draft run's GA/Search soft-failures look FLEET-WIDE — i.e. the
 * one impersonated subject (`GA_SUBJECT`) lost access — rather than one site's
 * transient blip. PURE. Fires when at least {@link MIN_FAILED_SITES} configured
 * sites failed AND they are a majority (≥ half) of the analytics-configured sites
 * this run. With <2 configured sites it can't distinguish a SPOF from a one-off, so
 * it never fires (at fleet scale there are always many configured sites).
 */
export function assessAnalyticsAlert(h: AnalyticsRunHealth): AnalyticsAlert {
  const { softFailedSites, configuredSites } = h;
  const fire =
    configuredSites >= 2 &&
    softFailedSites >= MIN_FAILED_SITES &&
    softFailedSites * 2 >= configuredSites;
  const reason = fire
    ? `${softFailedSites} of ${configuredSites} analytics-configured sites had GA/Search enrichment fail this run — the shared GA_SUBJECT likely lost access (an offboarded user, revoked property access, or a botched role-account cutover). Reports were drafted with BLANK analytics.`
    : "";
  return { fire, reason };
}

/**
 * Compose the operator alert email for a fleet-wide analytics failure. PURE — the
 * caller (the `report --due` cron) sends it best-effort via Resend only when
 * {@link assessAnalyticsAlert} fires. `dashboardUrl` is the fleet homepage link.
 */
export function composeAnalyticsAlertEmail(
  h: AnalyticsRunHealth,
  dashboardUrl: string,
): { subject: string; html: string } {
  const subject = `⚠ Fleet analytics enrichment failing — ${h.softFailedSites}/${h.configuredSites} sites`;
  const { reason } = assessAnalyticsAlert(h);
  const html = `<p><strong>${escapeHtml(reason)}</strong></p>
<p>This usually means the Google Workspace user the service account impersonates can no longer read the GA4 / Search Console properties. Reports still send — but with blank analytics — until the subject is restored.</p>
<p>Next step: follow the GA/Search subject runbook (<code>docs/runbooks/ga-search-role-account-cutover.md</code>) to restore or move the subject, then re-run <code>reddoor-maint report --due</code> and confirm the warning clears.</p>
<p><a href="${escapeHtml(dashboardUrl)}">Open the fleet dashboard →</a></p>`;
  return { subject, html };
}
