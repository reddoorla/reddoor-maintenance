import { buildCockpitModel } from "../../../src/dashboard/fleet-cockpit.js";
import type { CockpitModel, SiteCard } from "../../../src/dashboard/fleet-cockpit.js";
import type { AttentionItem } from "../../../src/alerts/attention.js";
import type { FleetEvent } from "../../../src/db/fleet-events.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import { gatingFields } from "../../../src/reports/checklist.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";

/** Cockpit models for the `/` port's tests, built the ways the old render tests
 *  built them: real models from site rows, and hand-built cards where a test
 *  needs a badge, a chip or a deploy state the collectors are slow to reach. */

export const BASE = "https://reddoor-maintenance.netlify.app";
export const NOW = new Date("2026-06-11T12:00:00Z");

export const healthCleanEvidence = () =>
  Object.fromEntries(
    gatingFields("Maintenance").map((f) => [
      f,
      { result: "pass" as const, checkedAt: "2026-07-06T00:00:00.000Z", note: "" },
    ]),
  );

/** A fully set-up, healthy site row. */
export function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    pointOfContact: "Tucker",
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:acme.example.com",
    searchConsoleOutcome: "resolved",
    searchConsoleResolved: "sc-domain:acme.example.com",
    searchConsoleCheckedAt: NOW.toISOString(),
    gitRepo: "reddoorla/acme",
    netlifyId: "11111111-2222-3333-4444-555555555555",
    headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    reportRecipientsTo: "tucker@reddoorla.com",
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    a11yViolations: 0,
    depsDrifted: 0,
    depsMajorBehind: 0,
    securityVulnsCritical: 0,
    securityVulnsHigh: 0,
    securityVulnsModerate: 0,
    securityVulnsLow: 0,
    ...over,
  });
}

export function built(
  sites: WebsiteRow[],
  reports: Parameters<typeof buildCockpitModel>[1] = [],
  extra: {
    prior?: Parameters<typeof buildCockpitModel>[2];
    submissions?: Parameters<typeof buildCockpitModel>[5];
    spam?: Parameters<typeof buildCockpitModel>[6];
    events?: FleetEvent[];
    autoFiltered?: number;
    deadLetters?: Map<string, number>;
  } = {},
): CockpitModel {
  return buildCockpitModel(
    sites,
    reports,
    extra.prior ?? {},
    BASE,
    NOW,
    extra.submissions ?? [],
    extra.spam ?? null,
    extra.events ?? [],
    extra.autoFiltered ?? 0,
    new Map(),
    extra.deadLetters ?? new Map(),
  );
}

export function item(over: Partial<AttentionItem> = {}): AttentionItem {
  return {
    key: "vuln:x",
    kind: "vuln",
    siteName: "Acme Co",
    title: "2 critical vulns",
    severity: "critical",
    metric: 2,
    ...over,
  };
}

export function card(over: Partial<SiteCard> = {}): SiteCard {
  return {
    site: siteRow(),
    tier: "healthy",
    items: [],
    watchReasons: [],
    watchSignals: [],
    acceptedReasons: [],
    ...over,
  };
}

export function handModel(over: Partial<CockpitModel> = {}): CockpitModel {
  return {
    summary: {
      attention: 0,
      watch: 0,
      healthy: 0,
      preLaunch: 0,
      criticalHighVulns: 0,
      lighthouseBelowFloor: 0,
      deliveryFailures: 0,
      renovateFailing: 0,
      ciRed: 0,
      autoFixStuck: 0,
      pending: 0,
      newSubmissions: 0,
    },
    cards: [],
    pending: [],
    submissions: [],
    ...over,
  };
}

const HOSTILE = `<script>alert("x")</script> & 'tick'`;

/** Every case the parity test compares, by name. */
export function cases(): Array<[string, CockpitModel]> {
  const events: FleetEvent[] = [
    {
      id: "pr:1",
      ts: "2026-06-11T09:00:00.000Z",
      type: "pr_automerged",
      siteId: "recC",
      siteName: "Caltex",
      summary: "auto-merged vite→7.3.5",
      data: { url: "https://github.com/reddoorla/caltex/pull/14" },
    },
    {
      id: "swept:1",
      ts: "2026-06-10T07:00:00.000Z",
      type: "fleet_swept",
      siteId: null,
      siteName: null,
      summary: "security-swept 11 sites",
      data: null,
    },
    {
      id: "launch:1",
      ts: "2026-06-01T07:00:00.000Z",
      type: "site_launched",
      siteId: "recA",
      siteName: "Acme Co",
      summary: HOSTILE,
      data: null,
    },
  ];
  const subs = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    siteId: "recSITE",
    formType: i % 4 === 0 ? "newsletter" : "contact",
    name: i === 3 ? "" : `Lead ${i} ${HOSTILE}`,
    email: `lead${i}@x.com`,
    submittedAt: `2026-06-${String(10 - (i % 9)).padStart(2, "0")}T12:00:00Z`,
  })) as never;
  const pendingReport = {
    id: "recREP",
    reportId: "rep_1",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: "2026-06",
    draftReady: true,
    approvedToSend: false,
    sentAt: null,
    withdrawnAt: null,
    autoEvidence: healthCleanEvidence(),
  } as never;

  return [
    ["an empty fleet", built([])],
    ["all clear, one healthy site", built([siteRow()])],
    [
      "broken: an attention site beside a healthy one",
      built([
        siteRow({ id: "recA", name: "Acme Co", securityVulnsCritical: 2 }),
        siteRow({ id: "recB", name: "Beta", url: "https://beta.example.com" }),
      ]),
    ],
    [
      "setup: roster gaps only, so all clear (#672 step 2)",
      built([
        siteRow({
          id: "recW",
          name: "Watchful",
          gitRepo: null,
          netlifyId: null,
          ga4PropertyId: null,
        }),
      ]),
    ],
    ["approvals only", built([siteRow({ id: "recSITE", name: "Acme Co" })], [pendingReport])],
    [
      "pre-launch and archived",
      built([
        siteRow({ id: "recP", name: "Prelaunch", status: "launching" }),
        siteRow({ id: "recL", name: "Legacy", status: "archived", statusRaw: "legacy" }),
        siteRow({ id: "recA", name: "Acme Co" }),
      ]),
    ],
    [
      "cardless dead letters",
      built([siteRow({ id: "recA", name: "Acme Co" })], [], {
        deadLetters: new Map([["ghost-co", 2]]),
      }),
    ],
    [
      "inbox with overflow, spam and auto-filtered, and the Recently lane",
      built([siteRow({ id: "recSITE", name: "Acme Co" })], [], {
        submissions: subs,
        spam: { caught: 5, through: 1, computedAt: "2026-06-11T06:07:00.000Z" } as never,
        events,
        autoFiltered: 4,
      }),
    ],
    ["spam only, no submissions", handModel({ spam: { caught: 3, through: 0 } })],
    ["auto-filtered only", handModel({ autoFiltered: 2 })],
    [
      "hand-built cards: badges, stuck, accept keys, deploys, submissions, hostile strings",
      handModel({
        cards: [
          card({
            site: siteRow({
              id: "recA",
              name: HOSTILE,
              url: `https://x.example/?a="1"&b=<2>`,
              deployStatus: "ready",
              lastDeployAt: "2026-06-10T12:00:00Z",
              deployLogUrl: "https://app.netlify.com/sites/x/deploys/1",
              a11yViolations: 4,
              a11yRoutesScanned: 3,
              a11yRoutesTotal: 9,
              depsDrifted: 3,
              depsMajorBehind: 1,
              depsOutdated: 5,
              depsMajorOutdated: 2,
              securityVulnsCritical: 1,
              securityVulnsHigh: 2,
              securityVulnsModerate: 0,
              securityVulnsLow: 4,
            }),
            tier: "attention",
            items: [
              item({ status: "new", title: `New ${HOSTILE} $& $1` }),
              item({ key: "vuln:y", status: "worse", autoFixExhausted: true, title: "stuck" }),
              item({ key: "ci:z", kind: "ci", severity: "warning" as never, title: "CI red" }),
              item({ key: "ren:z", kind: "renovate", severity: "warning" as never, title: "PRs" }),
            ],
            watchReasons: ["on *.netlify.app (no custom domain)", "stale commit"],
            watchAcceptKeys: ["no custom domain"],
            watchSignals: ["no-domain", "stale"],
            acceptedReasons: [`old ${HOSTILE}`],
            newLeads: 2,
            newSignups: 3,
          }),
          card({
            site: siteRow({
              id: "recB",
              name: "Beta",
              deployStatus: "error",
              lastDeployAt: null,
              deployLogUrl: "javascript:alert(1)",
              gitRepo: "  ",
              pScore: null,
              depsDrifted: null,
              securityVulnsLow: null,
            }),
            tier: "watch",
            watchReasons: ["Lighthouse below floor"],
            watchSignals: ["lighthouse"],
            newSubmissions: 4,
          }),
          card({
            site: siteRow({
              id: "recC",
              name: "Gamma",
              deployStatus: "building",
              deployLogUrl: null,
            }),
            tier: "healthy",
            newSignups: 1,
          }),
          card({
            site: siteRow({ id: "recD", name: "Delta", deployStatus: null, url: "not a url" }),
            tier: "pre-launch",
          }),
        ],
        archived: [{ name: HOSTILE, slug: "x", status: "legacy" }],
        cardless: [item({ siteName: "(unknown site: ghost)", title: HOSTILE })],
        summary: { ...handModel().summary, preLaunch: 1 },
      }),
    ],
  ];
}
