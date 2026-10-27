import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  overviewFromSnapshot,
  HOW_WE_COUNT,
  NIGHTLY_STEPS,
  NOT_YET,
  windowed,
} from "../../src/lib/overview/view.js";
import type { CockpitSnapshot } from "../../../src/dashboard/snapshot-views.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import type { ReportRow } from "../../../src/reports/report-row.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import { NIGHTLIES } from "../../../scripts/nightly-conductor.mjs";
import { DEFAULT_COPY } from "../../../src/reports/copy.js";
import { makeWebsiteRow } from "../../../tests/_helpers/website-row.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";

/**
 * P1-78g: the overview's model (workspace briefs/2026-10-26-p1-78g-overview.md).
 * Every number it shows is pinned here against fixture rows.
 */

const NOW = new Date("2026-10-27T18:00:00.000Z");
const FRESH = "2026-10-27T06:30:00.000Z";
const STALE = "2026-10-20T06:30:00.000Z";

/** A maintained site whose every check passed last night. */
function healthy(over: Partial<WebsiteRow> = {}): WebsiteRow {
  return makeWebsiteRow({
    status: "maintained",
    urlResolves: "pass",
    urlCheckedAt: FRESH,
    reachableOk: "pass",
    browserCheckedAt: FRESH,
    certDaysRemaining: 60,
    domainCheckedAt: FRESH,
    deployStatus: "ready",
    lastDeployAt: "2026-10-25T18:00:00.000Z",
    formE2eOk: "pass",
    formE2eCheckedAt: FRESH,
    ...over,
  });
}

function report(over: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "recREP",
    reportId: "REP-1",
    siteId: "recA",
    reportType: "Maintenance",
    period: "2026-09",
    periodStart: null,
    periodEnd: null,
    completedOn: null,
    lighthouse: null,
    gaUsersCurrent: null,
    gaUsersPrevious: null,
    searchFoundPage1: null,
    searchPosition: null,
    lastTestedDate: null,
    commentary: null,
    subjectOverride: null,
    draftReady: true,
    approvedToSend: true,
    sentAt: "2026-09-02T16:07:00.000Z",
    approvedAt: "2026-09-01T20:00:00.000Z",
    approvedBy: "op@example.com",
    deliveryStatus: "delivered",
    renderedHtmlAttachment: null,
    resendMessageId: null,
    checklist: {},
    autoEvidence: null,
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

function night(date: string, over: Partial<OverviewNight["counts"]> = {}): OverviewNight {
  return {
    night: date,
    counts: {
      schema: 1,
      ladderVersion: 2,
      run: {
        id: 1,
        attempt: 1,
        event: "workflow_dispatch",
        createdAt: `${date}T06:07:00Z`,
        startedAt: `${date}T06:07:00Z`,
        conclusion: "success",
      },
      steps: Object.fromEntries(
        NIGHTLIES.map((n: { file: string }) => [
          n.file,
          { outcome: "completed", runId: 1, conclusion: "success" },
        ]),
      ),
      merges: [],
      sites: { value: { cards: 2, tiers: {}, preLaunch: 0, setup: 0 } },
      signals: { value: {} },
      coverage: {
        value: {
          security_audit_at: { value: 2 },
          lighthouse_at: { value: 2 },
          form_e2e_checked_at: { value: 1 },
        },
      },
      deps: { value: { behind: 5 } },
      leads: { value: { new: 0, read: 0, archived: 0, spamAuto: 0, spam: 0, notified: 0 } },
      screenouts: { value: { honeypot: 240, tooFast: 8 } },
      reportsSent: { value: 3 },
      events: { value: { pr_automerged: 100, vuln_cleared: 10 } },
      prsMerged: { value: 600 },
      ...over,
    },
  };
}

function snapshot(over: Partial<CockpitSnapshot> = {}): CockpitSnapshot {
  return {
    takenAt: NOW.toISOString(),
    version: 0,
    baseUrl: "https://dash.example",
    gaps: [],
    sites: [healthy({ id: "recA", name: "Acme" }), healthy({ id: "recR", name: "Rsvp Site" })],
    slugById: new Map(),
    reports: [],
    digest: {},
    rollup: null,
    recentEvents: [],
    deadLetters: new Map(),
    deadLetterOldest: new Map(),
    submissions: [],
    rawSubmissionEnums: new Map(),
    screenOuts: [],
    audits: [],
    deps: null,
    nights: [],
    ...over,
  };
}

describe("section 1: the one-line status", () => {
  it("counts the sites in our care and says all are live", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    expect(v.status.line).toBe("2 sites in our care. All live. Nothing needs attention.");
    expect(v.status.broken).toEqual([]);
  });

  it("names a Broken site, in plain words, with its age", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme" }),
          healthy({ id: "recB", name: "Bravo", reachableOk: "fail" }),
        ],
        digest: { "uptime:recB": { metric: 1, firstFlaggedAt: "2026-10-25" } },
      }),
      NOW,
    );
    expect(v.status.cls).toBe("broken");
    expect(v.status.line).toBe("2 sites in our care. 1 not live. 1 broken.");
    expect(v.status.broken).toEqual([
      {
        siteName: "Bravo",
        url: "/s/bravo",
        reasons: expect.stringContaining("did not answer"),
        age: "for 2 days",
      },
    ]);
  });
});

describe("section 2: is every site live?", () => {
  it("one row per maintained site, launching ones left out", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme" }),
          healthy({ id: "recL", name: "Launchy", status: "launching" }),
        ],
      }),
      NOW,
    );
    expect(v.live.map((r) => r.siteName)).toEqual(["Acme"]);
    expect(v.live[0]!.live).toEqual({ ok: true, text: "Live" });
    expect(v.live[0]!.domain.text).toBe("60 days left");
  });

  it("Live names a fresh uptime fail even when the address resolves", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", reachableOk: "fail" })] }),
      NOW,
    );
    expect(v.live[0]!.live).toEqual({ ok: false, text: "A page not answering" });
    expect(v.status.line).toContain("1 not live.");
  });

  it("Live names an address that does not resolve", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recA", name: "Acme", urlResolves: "fail", urlStatus: "404" })],
      }),
      NOW,
    );
    expect(v.live[0]!.live).toEqual({ ok: false, text: "Address not answering (404)" });
  });

  it("a stale form-test pass reads 'not tested lately', never working", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", formE2eCheckedAt: STALE })] }),
      NOW,
    );
    expect(v.live[0]!.forms).toEqual({ ok: null, text: "Not tested lately" });
  });

  it("names the newest real lead, not spam", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({
            id: "s1",
            siteId: "recA",
            status: "spam_auto",
            submittedAt: "2026-10-27T17:00:00.000Z",
          }),
          makeSubmissionRow({
            id: "s2",
            siteId: "recA",
            status: "read",
            submittedAt: "2026-10-27T13:00:00.000Z",
          }),
        ],
      }),
      NOW,
    );
    expect(v.live.find((r) => r.siteName === "Acme")!.lastLead).toBe("last real one 5h ago");
  });
});

describe("section 3: leads", () => {
  const subs = [
    ...Array.from({ length: 3 }, (_, i) =>
      makeSubmissionRow({
        id: `r${i}`,
        siteId: "recR",
        formType: "rsvp",
        status: "read",
        notifyStatus: "sent",
        submittedAt: "2026-10-10T12:00:00.000Z",
      }),
    ),
    makeSubmissionRow({
      id: "a1",
      siteId: "recA",
      status: "new",
      notifyStatus: "sent",
      submittedAt: "2026-09-10T12:00:00.000Z",
    }),
    makeSubmissionRow({
      id: "a2",
      siteId: "recA",
      status: "archived",
      notifyStatus: "failed",
      submittedAt: "2026-06-15T12:00:00.000Z",
    }),
    makeSubmissionRow({
      id: "a3",
      siteId: "recA",
      status: "spam_auto",
      submittedAt: "2026-10-02T12:00:00.000Z",
    }),
    makeSubmissionRow({
      id: "a4",
      siteId: "recA",
      status: "spam",
      submittedAt: "2026-10-03T12:00:00.000Z",
    }),
  ];

  it("splits the screening, all time and this month", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: subs,
        screenOuts: [
          { siteId: "recA", date: "2026-10-05", honeypot: 4, tooFast: 1 },
          { siteId: "recA", date: "2026-09-30", honeypot: 9, tooFast: 0 },
        ],
        nights: [night("2026-10-26")],
      }),
      NOW,
    );
    expect(v.leads.allTime).toEqual({
      submissions: 7,
      accepted: 5,
      notified: 4,
      screened: 1,
      byHand: 1,
    });
    expect(v.leads.thisMonth).toEqual({
      submissions: 5,
      accepted: 3,
      notified: 3,
      screened: 1,
      byHand: 1,
    });
    expect(v.leads.since).toBe("2026-06-15");
    // Stopped before storage stands alone: 248, never 248 + 1 screened.
    expect(v.leads.stoppedAllTime).toBe("248");
    expect(v.leads.stoppedThisMonth).toBe("5");
  });

  it("keeps the RSVP site in the per-site table beside the total", () => {
    const v = overviewFromSnapshot(snapshot({ submissions: subs }), NOW);
    expect(v.leads.perSite.map((s) => [s.siteName, s.submissions, s.accepted])).toEqual([
      ["Acme", 4, 2],
      ["Rsvp Site", 3, 3],
    ]);
  });

  it("with no fleet_daily night, stopped before storage is not yet collected", () => {
    const v = overviewFromSnapshot(snapshot({ nights: [] }), NOW);
    expect(v.leads.stoppedAllTime).toBe(NOT_YET);
  });
});

describe("section 4: client reports", () => {
  it("counts real sends: the test sends are left out", () => {
    const v = overviewFromSnapshot(
      snapshot({
        reports: [
          report({ id: "r1" }),
          report({ id: "r2", approvedBy: null }),
          report({ id: "t1", approvedBy: "test send via Claude" }),
          report({ id: "t2", approvedBy: "Test Send via Claude (preview)" }),
          report({ id: "g1", approvedAt: null }),
          report({ id: "d1", sentAt: null, approvedToSend: false }),
        ],
      }),
      NOW,
    );
    expect(v.reports.sent).toEqual({ real: 3, approvedFirst: 2, aroundGate: 1, testSends: 2 });
  });

  it("names the six checks a report carries, each with the job that proves it", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    expect(v.reports.checks.map((c) => c.name)).toEqual(DEFAULT_COPY.maintenanceChecks);
    for (const c of v.reports.checks) expect(c.proof).toMatch(/^Step \d/);
  });

  it("shows each site's waiting drafts", () => {
    const v = overviewFromSnapshot(
      snapshot({
        reports: [report({ id: "p1", approvedToSend: false, sentAt: null, approvedAt: null })],
      }),
      NOW,
    );
    expect(v.reports.perSite.find((r) => r.siteName === "Acme")!.waiting).toBe(1);
  });
});

describe("section 5: what runs every night", () => {
  it("derives the times from the cron, before daylight saving ends", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    expect(v.nightly.startsAt).toBe("11:07pm PT");
    expect(v.nightly.sendsAt).toBe("9:07am PT");
  });

  it("and after it ends on Nov 1", () => {
    const v = overviewFromSnapshot(snapshot(), new Date("2026-11-05T18:00:00.000Z"));
    expect(v.nightly.startsAt).toBe("10:07pm PT");
    expect(v.nightly.sendsAt).toBe("8:07am PT");
  });

  it("lists the conductor's eight steps in its own order", () => {
    expect(NIGHTLY_STEPS.map((s) => s.file)).toEqual(
      NIGHTLIES.map((n: { file: string }) => n.file),
    );
  });

  it("reads scale and reliability from fleet_daily", () => {
    const failed = night("2026-10-25");
    failed.counts.steps["fleet-smoke.yml"] = {
      outcome: "completed",
      runId: 2,
      conclusion: "failure",
    };
    const v = overviewFromSnapshot(snapshot({ nights: [night("2026-10-26"), failed] }), NOW);
    expect(v.nightly.scale).toBe("2 sites, 3 checks on each");
    expect(v.nightly.reliability).toBe("15 of 16 runs green over the last 2 nights");
    expect(v.nightly.steps[6]!.sites).toBe("1 site");
    expect(v.nightly.steps[0]!.sites).toBe("the whole fleet at once");
  });

  it("with no fleet_daily row, every count says not yet collected, never 0", () => {
    const v = overviewFromSnapshot(snapshot({ nights: [] }), NOW);
    expect(v.nightly.scale).toBe(NOT_YET);
    expect(v.nightly.reliability).toBe(NOT_YET);
    expect(v.nightly.steps.map((s) => s.outcome)).toEqual(Array(8).fill(NOT_YET));
    expect(v.upkeep.automerged).toBe(NOT_YET);
    expect(v.upkeep.vulnsCleared).toBe(NOT_YET);
    expect(v.upkeep.depsBehind).toBe(NOT_YET);
    expect(v.prsMerged).toBe(NOT_YET);
  });
});

describe("sections 6 and 7: windows over fleet_daily", () => {
  it("one night alone has nothing to subtract", () => {
    const v = overviewFromSnapshot(snapshot({ nights: [night("2026-10-26")] }), NOW);
    expect(v.upkeep.automerged).toBe(NOT_YET);
    expect(v.upkeep.depsBehind).toBe("5 packages");
  });

  it("subtracts the oldest night inside 30 from the newest", () => {
    const nights = [
      night("2026-10-26", {
        events: { value: { pr_automerged: 168, vuln_cleared: 36 } },
        prsMerged: { value: 662 },
      }),
      night("2026-10-25", {
        events: { reason: "read failed", value: null },
        prsMerged: { reason: "x", value: null },
      }),
      night("2026-10-20"),
      night("2026-09-20", {
        events: { value: { pr_automerged: 1, vuln_cleared: 1 } },
        prsMerged: { value: 1 },
      }),
    ];
    const v = overviewFromSnapshot(snapshot({ nights }), NOW);
    expect(v.upkeep.automerged).toBe("68 merged over the last 6 nights");
    expect(v.upkeep.vulnsCleared).toBe("26 cleared over the last 6 nights");
    expect(v.prsMerged).toBe("62 merged over the last 6 nights");
  });

  it("windowed skips an unmeasured night rather than reading it as 0", () => {
    const w = windowed(
      [night("2026-10-26"), night("2026-10-25", { prsMerged: { reason: "x", value: null } })],
      (c) => c.prsMerged.value,
    );
    expect(w).toBeNull();
  });

  it("names open vulnerabilities with what is fixing them", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({
            id: "recA",
            name: "Acme",
            securityVulnsHigh: 2,
            lastSecurityAuditAt: FRESH,
            securityAdvisories: [],
          }),
        ],
      }),
      NOW,
    );
    expect(v.upkeep.open).toEqual([
      { siteName: "Acme", text: expect.stringMatching(/^2 critical or high vulnerabilities: /) },
    ]);
  });
});

describe("How we count", () => {
  it("has one line for every number the page shows", () => {
    const page = readFileSync(new URL("../../src/routes/+page.svelte", import.meta.url), "utf8");
    const terms = HOW_WE_COUNT.map((h) => h.term);
    for (const t of [
      "Sites in our care",
      "Live",
      "Domain",
      "Deploy",
      "Forms",
      "Submissions",
      "Accepted as real",
      "Client notified",
      "Screened as spam",
      "Marked spam by hand",
      "Stopped before storage",
      "Reports sent",
      "Lighthouse",
      "Next report due",
      "Times",
      "Steps",
      "Scale",
      "Runs green",
      "Updates merged automatically",
      "Vulnerabilities cleared",
      "Open now",
      "Dependencies behind",
      "PRs merged",
    ])
      expect(terms).toContain(t);
    // No count is typed into the page: every digit there is markup or a token.
    expect(page.replace(/<style[\s\S]*?<\/style>/g, "")).not.toMatch(/>\s*\d{2,}\s*</);
  });
});
