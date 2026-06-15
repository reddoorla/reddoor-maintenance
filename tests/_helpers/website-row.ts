import type { WebsiteRow } from "../../src/reports/airtable/websites.js";

/**
 * Shared WebsiteRow test factory. Every field of the real `WebsiteRow` type has a
 * sensible nulled/empty default here, so adding a NEW field to `WebsiteRow` only
 * needs THIS factory updated — not the ~8 test files that build site rows.
 *
 * Per-test tweaks come in via `over`; per-file defaults are themselves expressed as
 * an `over` layer at each call site (e.g. `makeWebsiteRow({ id: "rec1", ...over })`),
 * so the merge order is canonical → per-file → per-test, identical to the inline
 * literals these factories replaced.
 */
export function makeWebsiteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return {
    id: "recSITE",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintenance",
    pointOfContact: null,
    maintenanceFreq: "None",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: null,
    rScore: null,
    bpScore: null,
    seoScore: null,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    copyIntro: null,
    copyContact: null,
    copyFooter: null,
    launchedAt: null,
    newsletterWebhook: null,
    renovateFailingCis: null,
    defaultBranchCi: null,
    lastCommitAt: null,
    // Default to a freshly-swept timestamp so the GitHub-signal collectors
    // (collectCiAlerts / collectRenovateAlerts, which now ignore a >3-day-stale
    // sweep) flag the signal fields the factory's callers set. A test exercising
    // the staleness gate overrides this with an old/null value via `over`.
    githubSignalsAt: new Date().toISOString(),
    ...over,
  };
}
