import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import type { ReportRow } from "../../../src/reports/report-fields.js";
import type { EvidenceRecord } from "../../../src/reports/auto-tick.js";
import type { SubmissionRow } from "../../../src/reports/submission-row.js";
import type { ScreenOutTotals } from "../../../src/db/screenouts.js";
import type { SiteAlarmContext } from "../../../src/dashboard/fleet-cockpit.js";
import { gatingFields } from "../../../src/reports/checklist.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";

/** Site-page fixtures for the port's parity and behaviour tests, shaped after
 *  tests/dashboard/render.test.ts's. */

export const cleanEvidence = (type: ReportRow["reportType"]): Record<string, EvidenceRecord> =>
  Object.fromEntries(
    gatingFields(type).map((f) => [
      f,
      { result: "pass" as const, checkedAt: "2026-06-01T00:00:00.000Z", note: "" },
    ]),
  );

export function siteRow(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    ga4PropertyId: "123456789",
    searchConsoleProperty: "sc-domain:acme.example.com",
    searchConsoleOutcome: "resolved",
    searchConsoleResolved: "sc-domain:acme.example.com",
    searchConsoleCheckedAt: "2026-06-10T00:00:00.000Z",
    // makeWebsiteRow defaults this to the wall clock; pin it, fresh against
    // input()'s now, so no fixture field reads the clock (#1601).
    githubSignalsAt: "2026-06-15T06:00:00.000Z",
    maintenanceFreq: "Monthly",
    testingFreq: "Quarterly",
    maintenanceDay: "2026-05-01",
    testingDay: "2026-04-10",
    pointOfContact: "owner@site.example.com",
    headerImage: { url: "https://x/h.png", filename: "h.png", type: "image/png" },
    pScore: 87,
    rScore: 95,
    bpScore: 90,
    seoScore: 100,
    lastLighthouseAuditAt: "2026-05-27T18:00:00Z",
    gitRepo: "reddoorla/acme",
    ...over,
  });
}

export function reportRow(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP1",
    reportId: "rep_001",
    siteId: "recSITE",
    reportType: "Maintenance",
    period: null,
    periodStart: "2026-04-01",
    periodEnd: "2026-04-30",
    completedOn: "2026-05-01",
    lighthouse: { performance: 87, accessibility: 95, bestPractices: 90, seo: 100 },
    gaUsersCurrent: 2100,
    gaUsersPrevious: 1900,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: "2026-04-10",
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-05-02T09:00:00Z",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: {
      url: "https://files.example/attach/rep_001.html",
      filename: "rep_001.html",
    },
    resendMessageId: "msg_001",
    approvedAt: null,
    approvedBy: null,
    checklist: {},
    autoEvidence: cleanEvidence(over.reportType ?? "Maintenance"),
    sendOverride: false,
    overrideReason: null,
    overrideBy: null,
    overrideAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    sendStartedAt: null,
    ...over,
  };
}

/** A pending (draft-ready, unapproved, unsent) report. */
export function pending(over: Partial<ReportRow> = {}): ReportRow {
  return reportRow({
    approvedToSend: false,
    sentAt: null,
    deliveryStatus: "pending",
    resendMessageId: null,
    ...over,
  });
}

export type SiteInput = {
  site: WebsiteRow;
  reports: ReportRow[];
  submissions: SubmissionRow[];
  spam: ScreenOutTotals | null;
  now: Date;
  alarm: SiteAlarmContext | null;
};

export function input(over: Partial<SiteInput> = {}): SiteInput {
  return {
    site: siteRow(),
    reports: [],
    submissions: [],
    spam: null,
    now: new Date("2026-06-15T10:00:00.000Z"),
    alarm: null,
    ...over,
  };
}

const HOSTILE = `<img src=x onerror=alert(1)> "q" & 'a'`;

/** `n` submissions, one a day from 2026-05-18 to 06-14 (then round again):
 *  all before `input()`'s now and inside the spam panel's 30-day window, so
 *  each row pins a real age, not a floored "just now" (#1603). */
export function submissions(n: number): SubmissionRow[] {
  const first = Date.parse("2026-05-18T12:00:00.000Z");
  return Array.from({ length: n }, (_, i) =>
    makeSubmissionRow({
      id: `sub${i}`,
      submittedAt: new Date(first + (i % 28) * 86_400_000).toISOString(),
    }),
  );
}

/** Every variant of the page the parity test walks. */
export const CASES: Array<[string, SiteInput]> = [
  [
    "a bare site with nothing measured",
    input({
      site: siteRow({
        pScore: null,
        rScore: null,
        bpScore: null,
        seoScore: null,
        gitRepo: null,
        lastLighthouseAuditAt: null,
      }),
    }),
  ],
  [
    "scores, health tiles and failing audits",
    input({
      site: siteRow({
        a11yViolations: 3,
        a11yRoutesScanned: 2,
        a11yRoutesTotal: 5,
        depsDrifted: 4,
        depsMajorBehind: 1,
        securityVulnsCritical: 1,
        securityVulnsHigh: 0,
        securityVulnsModerate: 2,
        securityVulnsLow: null,
        lighthouseFailingAudits: "color-contrast, image-alt",
      }),
    }),
  ],
  [
    "all routes scanned, clean security",
    input({
      site: siteRow({
        a11yViolations: 0,
        a11yRoutesScanned: 5,
        a11yRoutesTotal: 5,
        depsDrifted: 0,
        depsMajorBehind: 0,
        securityVulnsCritical: 0,
        securityVulnsHigh: 0,
        securityVulnsModerate: 0,
        securityVulnsLow: 0,
      }),
    }),
  ],
  [
    "vulnerabilities, severity-sorted, dev scope, CVEs, unsafe link",
    input({
      site: siteRow({
        securityAdvisories: [
          { severity: "low", module: "a", title: "", cves: [], url: null, scope: "runtime" },
          {
            severity: "critical",
            module: "esbuild",
            title: "RCE",
            cves: ["CVE-1", "CVE-2"],
            url: "https://gh/adv",
            scope: "development",
          },
          {
            severity: "high",
            module: HOSTILE,
            title: HOSTILE,
            cves: [HOSTILE],
            url: "javascript:alert(1)",
            scope: "runtime",
          },
        ],
      } as Partial<WebsiteRow>),
    }),
  ],
  [
    "a clean pending report with a preview and commentary",
    input({
      reports: [pending({ commentary: "Thanks for a good month", period: "2026-05" })],
    }),
  ],
  [
    "a pending report with no preview",
    input({
      reports: [pending({ renderedHtmlAttachment: null })],
    }),
  ],
  [
    "a pending report blocked by preflight (no recipients, no header)",
    input({
      site: siteRow({ pointOfContact: null, headerImage: null }),
      reports: [pending()],
    }),
  ],
  [
    "a pending report with a warn preflight",
    input({
      site: siteRow({ pointOfContact: "not-an-email" }),
      reports: [pending()],
    }),
  ],
  [
    "recipients with To and CC",
    input({
      site: siteRow({ reportRecipientsTo: "a@x.com, b@x.com", reportRecipientsCc: "c@x.com" }),
      reports: [pending()],
    }),
  ],
  [
    "a health-red pending report: gate fails, override shown",
    input({
      reports: [
        pending({
          autoEvidence: {
            ...cleanEvidence("Maintenance"),
            [gatingFields("Maintenance")[0]!]: {
              result: "fail",
              checkedAt: "2026-06-01T00:00:00.000Z",
              note: `broke ${HOSTILE}`,
            },
          },
        }),
      ],
    }),
  ],
  [
    "a pending report with unknown and n/a evidence",
    input({
      reports: [
        pending({
          autoEvidence: {
            [gatingFields("Maintenance")[0]!]: {
              result: "n/a",
              checkedAt: "2026-06-01T00:00:00.000Z",
              note: "",
            },
          },
        }),
      ],
    }),
  ],
  [
    "a pending Testing report",
    input({
      reports: [pending({ reportType: "Testing", autoEvidence: cleanEvidence("Testing") })],
    }),
  ],
  [
    "a pending Launch report (no checklist, no commentary)",
    input({
      reports: [pending({ reportType: "Launch", autoEvidence: {} })],
    }),
  ],
  [
    "a pending Announcement",
    input({
      reports: [pending({ reportType: "Announcement", autoEvidence: {} })],
    }),
  ],
  [
    "history: sent, approved-awaiting-send, sending, withdrawn, unsent draft",
    input({
      reports: [
        reportRow({
          id: "r1",
          reportId: "rep_1",
          completedOn: "2026-05-01",
          searchFoundPage1: true,
          searchPosition: 3,
        }),
        reportRow({
          id: "r2",
          reportId: "rep_2",
          completedOn: "2026-05-02",
          sentAt: null,
          approvedToSend: true,
          commentary: HOSTILE,
        }),
        reportRow({
          id: "r3",
          reportId: "rep_3",
          completedOn: "2026-05-03",
          sentAt: null,
          approvedToSend: true,
          sendStartedAt: "2026-05-03T16:08:30.000Z",
        }),
        reportRow({
          id: "r4",
          reportId: "rep_4",
          completedOn: "2026-05-04",
          sentAt: null,
          approvedToSend: false,
          withdrawnAt: "2026-05-05T10:00:00.000Z",
        }),
        reportRow({
          id: "r5",
          reportId: "rep_5",
          completedOn: "2026-05-05",
          sentAt: null,
          approvedToSend: false,
          draftReady: false,
          gaUsersPrevious: null,
          renderedHtmlAttachment: null,
        }),
        reportRow({
          id: "r6",
          reportId: "rep_6",
          completedOn: "2026-05-06",
          sentAt: null,
          approvedToSend: true,
          reportType: "Launch",
          gaUsersCurrent: 100,
          gaUsersPrevious: 150,
        }),
        reportRow({ id: "r7", reportId: "rep_7", completedOn: "2026-04-01", gaUsersCurrent: null }),
        reportRow({
          id: "r8",
          reportId: "rep_8",
          completedOn: "2026-03-01",
          gaUsersCurrent: 5,
          gaUsersPrevious: 5,
        }),
      ],
    }),
  ],
  [
    "a pending report shown in both the list and the history",
    input({
      reports: [
        pending({ id: "rp", reportId: "rep_p" }),
        reportRow({ id: "rs", reportId: "rep_s", completedOn: "2026-04-01" }),
      ],
    }),
  ],
  [
    "alarm: attention items, waiting, stuck, watch with accept key, accepted",
    input({
      alarm: {
        setup: [],
        tier: "broken",
        items: [
          // P1-78e: a real Broken item, so a Broken site renders a red chip (an
          // uptime fail is Broken on the ladder; the vuln below is Attention).
          { key: "uptime:recS", title: "Site down", severity: "critical", kind: "uptime" },
          { title: "Critical vuln", severity: "critical", kind: "vuln" },
          { title: "Stuck PR", severity: "warning", kind: "renovate", autoFixExhausted: true },
          { title: "Being fixed", severity: "warning", kind: "ci", waiting: true },
          { title: HOSTILE, severity: "warning", kind: "ci" },
        ],
        watchReasons: ["on *.netlify.app (no custom domain)", "no analytics"],
        watchAcceptKeys: ["no custom domain", ""],
        acceptedReasons: ["stale repo"],
      } as unknown as SiteAlarmContext,
    }),
  ],
  [
    "alarm: watch tier",
    input({
      alarm: {
        setup: [],
        tier: "watch",
        items: [],
        watchReasons: ["x"],
        watchAcceptKeys: [],
        acceptedReasons: [],
      } as unknown as SiteAlarmContext,
    }),
  ],
  [
    "alarm: healthy with nothing to show",
    input({
      alarm: {
        setup: [],
        tier: "healthy",
        items: [],
        watchReasons: [],
        watchAcceptKeys: [],
        acceptedReasons: [],
      } as unknown as SiteAlarmContext,
    }),
  ],
  [
    "alarm: healthy with an accepted condition",
    input({
      alarm: {
        setup: [],
        tier: "healthy",
        items: [],
        watchReasons: [],
        watchAcceptKeys: [],
        acceptedReasons: ["no analytics"],
      } as unknown as SiteAlarmContext,
    }),
  ],
  [
    "setup incomplete, every details field set, hostile values",
    input({
      site: siteRow({
        name: `Acme ${HOSTILE}`,
        url: "javascript:alert(1)",
        ga4PropertyId: null,
        statusRaw: "legacy",
        reportRecipientsTo: HOSTILE,
        notifyRoutingRaw: `{"a": "${HOSTILE}"}`,
        requireTurnstile: true,
        mailchimpApiKey: "secret-key",
        acceptedWatchConditions: ["no analytics", "SEO"],
        copyIntro: HOSTILE,
        maintenanceDay: "2026-08-01T00:00:00.000Z",
        lastCommitAt: "2026-06-01T00:00:00.000Z",
      } as Partial<WebsiteRow>),
    }),
  ],
  [
    "status in the list, no secret, no git repo",
    input({
      site: siteRow({
        statusRaw: "maintained",
        gitRepo: "  ",
        mailchimpApiKey: null,
      } as Partial<WebsiteRow>),
    }),
  ],
  [
    "spam panel with screen-out totals and in-window rows",
    input({
      spam: { honeypot: 4, tooFast: 2, markedSpam: 1 },
      submissions: [
        ...submissions(3),
        {
          ...submissions(1)[0]!,
          id: "auto",
          status: "spam_auto",
          spamScore: 9,
          spamReason: "link-heavy",
        },
        { ...submissions(1)[0]!, id: "old", submittedAt: "2026-01-01T00:00:00.000Z" },
      ],
    }),
  ],
  ["submissions over the cap", input({ submissions: submissions(30) })],
  [
    "only auto-spam submissions (strip hidden, spam panel shown)",
    input({
      submissions: [{ ...submissions(1)[0]!, status: "spam_auto", spamScore: 9 }],
    }),
  ],
];

export { HOSTILE };
