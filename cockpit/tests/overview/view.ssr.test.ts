import { describe, it, expect } from "vitest";
import {
  overviewFromSnapshot,
  CHECK_PROOF,
  HOW_WE_COUNT,
  NIGHTLY_STEPS,
  NOT_YET,
  UNREADABLE,
  liveCell,
  outcomeText,
  pacificMonthStart,
  stepNumber,
  windowed,
} from "../../src/lib/overview/view.js";
import type { OverviewNight } from "../../../src/fleet-daily/read.js";
import type { WebsiteRow } from "../../../src/fleet/site-row.js";
import { NIGHTLIES } from "../../../scripts/nightly-conductor.mjs";
import { DEFAULT_COPY } from "../../../src/reports/copy.js";
import { makeSubmissionRow } from "../../../tests/_helpers/submission-row.js";
import { PRODUCTION_STALE_DAYS } from "../../../src/alerts/production-signals.js";

/**
 * P1-78g: the overview's model (workspace briefs/2026-10-26-p1-78g-overview.md).
 * Every number it shows is pinned here against fixture rows.
 */

import { NOW, FRESH, STALE, healthy, report, night, snapshot } from "./fixtures.js";

describe("section 1: the one-line status", () => {
  it("counts the sites in our care and says all are live", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    // Dated: a nightly reading, never "now" (FRESH is 06:30Z, 11:30pm PT the night before).
    expect(v.status.line).toBe(
      "2 sites in our care. All live at the last check, Oct 26, 11:30pm PT. Nothing needs attention.",
    );
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
    expect(v.status.line).toBe(
      "2 sites in our care. 1 not live. 1 live at the last check, Oct 26, 11:30pm PT. 1 broken.",
    );
    // In plain words, not the triage title ("a sampled page did not answer 2xx or 3xx").
    expect(v.status.broken).toEqual([
      {
        key: "bravo",
        siteName: "Bravo",
        url: "/s/bravo",
        reasons: "a page on the site did not answer at the last check",
        age: "for 2 days",
      },
    ]);
    expect(v.status.parts.find((p) => p.text === "1 broken.")?.href).toBe("/triage#broken");
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
    expect(v.live[0]!.live).toEqual({
      ok: true,
      text: "Live",
      at: "Oct 26, 11:30pm PT",
      atIso: FRESH,
    });
    expect(v.live[0]!.domain.text).toBe("60 days left");
  });

  it("Live names a fresh uptime fail even when the address resolves", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", reachableOk: "fail" })] }),
      NOW,
    );
    expect(v.live[0]!.live).toMatchObject({ ok: false, text: "A page not answering" });
    expect(v.status.line).toContain("1 not live.");
  });

  it("Live names an address that does not resolve", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recA", name: "Acme", urlResolves: "fail", urlStatus: "404" })],
      }),
      NOW,
    );
    expect(v.live[0]!.live).toMatchObject({ ok: false, text: "Address not answering (404)" });
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
    expect(v.live.find((r) => r.siteName === "Acme")!.lastLead).toBe("last real lead 5h ago");
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
    expect(v.leads.since).toBe("Jun 15, 2026");
    // Stopped before storage stands alone: 248, never 248 + 1 screened.
    expect(v.leads.stoppedAllTime).toBe("248");
    expect(v.leads.stoppedAsOf).toBe("Oct 26");
    expect(v.leads.stoppedThisMonth).toBe("5");
  });

  it("keeps the RSVP site in the per-site table beside the total", () => {
    const v = overviewFromSnapshot(snapshot({ submissions: subs }), NOW);
    expect(
      v.leads.perSite.map((s) => [
        s.siteName,
        s.submissions,
        s.accepted,
        s.notified,
        s.screened,
        s.byHand,
      ]),
    ).toEqual([
      ["Acme", 4, 2, 1, 1, 1],
      ["Rsvp Site", 3, 3, 3, 0, 0],
    ]);
    // The headline names the biggest site and its share: 4 of the 7.
    expect(v.leads.biggest).toEqual({ siteName: "Acme", submissions: 4, share: 57 });
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
    // Kinds of check that ran, and the most sites one reached; never "checks on each".
    expect(v.nightly.scale).toBe(
      "3 kinds of check ran on the newest night, reaching up to 2 sites",
    );
    expect(v.nightly.reliability).toBe("15 of 16 runs green over the last 2 nights");
    expect(v.nightly.steps[6]!.sites).toBe("1 site");
    expect(v.nightly.steps[0]!.sites).toBe("the whole database, every site's records in one copy");
    expect(v.nightly.steps[7]!.sites).toBe("sites with a report due");
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
    expect(v.upkeep.automerged).toBe("68 over the last 6 nights");
    expect(v.upkeep.vulnsCleared).toBe("26 over the last 6 nights");
    expect(v.prsMerged).toBe("62 over the last 6 nights");
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
      {
        siteId: "recA",
        siteName: "Acme",
        text: expect.stringMatching(/^2 critical or high vulnerabilities: /),
      },
    ]);
  });
});

describe("review round 1: the counts behind every shown number", () => {
  const draft = (id: string, siteId: string) =>
    report({ id, siteId, approvedToSend: false, sentAt: null, approvedAt: null });

  it("counts every draft waiting for a yes, on any site (C1)", () => {
    // Two drafts on one site and one on an Attention site: 3.
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme" }),
          healthy({ id: "recB", name: "Bravo", pScore: 50 }),
          healthy({ id: "recW", name: "Wren", pScore: 80 }),
        ],
        reports: [draft("p1", "recA"), draft("p2", "recA"), draft("p3", "recB")],
      }),
      NOW,
    );
    // Acme's drafts cannot be approved yet (no recipients), which puts Acme in
    // Attention too: the feed's approval group, which holds only sites with nothing
    // worse, would count 0 here.
    expect(v.status.counts).toEqual({ attention: 2, fleetAttention: 0, watch: 1, approval: 3 });
    expect(v.status.parts.map((p) => [p.text, p.href])).toEqual([
      ["3 sites in our care.", undefined],
      ["All live at the last check, Oct 26, 11:30pm PT.", undefined],
      ["2 sites need attention this week.", "/triage#attention"],
      ["1 site to watch.", "/triage#watch"],
      ["3 reports wait for your yes.", "/triage#approval"],
    ]);
    expect(v.reports.perSite.map((r) => [r.siteName, r.waiting])).toEqual([
      ["Acme", 2],
      ["Bravo", 1],
      ["Wren", 0],
    ]);
  });

  it("a key missing from a measured running total is 0, not unmeasured (C2)", () => {
    const nights = [
      night("2026-10-26", { events: { value: { pr_automerged: 5 } } }),
      night("2026-10-25", { events: { value: { pr_automerged: 2, vuln_cleared: 1 } } }),
      night("2026-10-24", { events: { value: {} } }),
    ];
    const v = overviewFromSnapshot(snapshot({ nights }), NOW);
    // vuln_cleared: 0 (missing on the newest) less 0 (missing on the base).
    expect(v.upkeep.vulnsCleared).toBe("0 over the last 2 nights");
    expect(v.upkeep.automerged).toBe("5 over the last 2 nights");
  });

  it("Deploy reads a stale check as unknown, never a green 'published' (C3)", () => {
    const at = (over: Partial<WebsiteRow>) =>
      overviewFromSnapshot(
        snapshot({ sites: [healthy({ id: "recA", name: "Acme", ...over })] }),
        NOW,
      ).live[0]!.deploy;
    expect(at({})).toEqual({ ok: true, text: "Published 2d ago" });
    expect(at({ deployCheckedAt: STALE })).toEqual({ ok: null, text: "Not checked lately" });
    expect(at({ deployStatus: "error" })).toEqual({ ok: false, text: "Latest deploy failed" });
    // No raw Netlify status in the cell.
    expect(at({ deployStatus: "building" })).toEqual({
      ok: null,
      text: "A deploy was in progress",
    });
  });

  it("a stored status the code does not know is no kind of lead (C4)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({ id: "x1", siteId: "recA", status: "new", submittedAt: FRESH }),
        ],
        rawSubmissionEnums: new Map([["x1", { status: "quarantined", formType: "contact" }]]),
      }),
      NOW,
    );
    expect(v.leads.allTime).toEqual({
      submissions: 1,
      accepted: 0,
      notified: 0,
      screened: 0,
      byHand: 0,
    });
    expect(v.live.find((r) => r.siteName === "Acme")!.lastLead).toBe("no real lead yet");
  });

  it("approved first compares instants, not strings (C5)", () => {
    // Same moment, two spellings: "…00Z" sorts after "…00.000Z" as text.
    const v = overviewFromSnapshot(
      snapshot({
        reports: [
          report({
            id: "s1",
            approvedAt: "2026-09-02T16:07:00Z",
            sentAt: "2026-09-02T16:07:00.000Z",
          }),
        ],
      }),
      NOW,
    );
    expect(v.reports.sent).toEqual({ real: 1, approvedFirst: 1, aroundGate: 0, testSends: 0 });
  });

  it("a failed fleet_daily read says not readable, never not yet collected (C6)", () => {
    const v = overviewFromSnapshot(snapshot({ nights: null }), NOW);
    expect(v.nightly.scale).toBe(UNREADABLE);
    expect(v.nightly.reliability).toBe(UNREADABLE);
    expect(v.nightly.steps.map((s) => s.outcome)).toEqual(Array(8).fill(UNREADABLE));
    expect(v.upkeep.automerged).toBe(UNREADABLE);
    expect(v.upkeep.depsBehind).toBe(UNREADABLE);
    expect(v.prsMerged).toBe(UNREADABLE);
    expect(v.leads.stoppedAllTime).toBe(UNREADABLE);
    expect(v.nightsCollected).toBeNull();
  });

  it("names the Lighthouse medians, each area on its own (T4, O7)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "a", name: "A", pScore: 90, rScore: 100, bpScore: 70, seoScore: null }),
          healthy({ id: "b", name: "B", pScore: 60, rScore: 80, bpScore: 90, seoScore: 91 }),
          healthy({ id: "c", name: "C", pScore: 70, rScore: 90, bpScore: 80, seoScore: 99 }),
        ],
      }),
      NOW,
    );
    expect(v.reports.lighthouse).toEqual([
      { label: "Performance", median: "70" },
      { label: "Accessibility", median: "90" },
      { label: "Best practices", median: "80" },
      { label: "SEO", median: "95" },
    ]);
  });

  it("names each site's next report due (T4)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme", maintenanceFreq: "Monthly" }),
          healthy({ id: "recR", name: "Rsvp Site" }),
        ],
        reports: [report({ id: "m1", siteId: "recA", sentAt: "2026-10-02T16:07:00.000Z" })],
      }),
      NOW,
    );
    expect(v.reports.perSite.map((r) => [r.siteName, r.nextDue])).toEqual([
      ["Acme", "Maintenance, Nov 2"],
      ["Rsvp Site", "none scheduled"],
    ]);
  });

  it("names each step's result and when it last finished, with data present (T4, O5, O13)", () => {
    const newest = night("2026-10-26");
    newest.counts.steps["fleet-smoke.yml"] = {
      outcome: "completed",
      runId: 2,
      conclusion: "timed_out",
    };
    newest.counts.steps["fleet-prismic-sync.yml"] = {
      outcome: "running",
      runId: 2,
      conclusion: null,
    };
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme", lastSecurityAuditAt: "2026-10-27T06:40:00.000Z" }),
          healthy({ id: "recR", name: "Rsvp Site", lastSecurityAuditAt: STALE }),
        ],
        nights: [newest, night("2026-10-25")],
      }),
      NOW,
    );
    const step = (file: string) => v.nightly.steps[stepNumber(file) - 1]!;
    expect(step("fleet-security.yml")).toMatchObject({
      outcome: "green",
      lastFinished: "Oct 26, 11:40pm PT",
    });
    // GitHub's own words never show raw.
    expect(step("fleet-smoke.yml").outcome).toBe("ran out of time");
    // A step that stamps no site: the run it last finished in, and how.
    expect(step("fleet-db-backup.yml").lastFinished).toBe(
      "in the run that started Oct 25, 11:07pm PT (green)",
    );
    // Still running on the newest night, so the night before is its last finish.
    expect(step("fleet-prismic-sync.yml")).toMatchObject({
      outcome: "still running when the night was written",
      lastFinished: "in the run that started Oct 24, 11:07pm PT (green)",
    });
    // A stamping step no site has stamped.
    expect(step("fleet-smoke.yml").lastFinished).toBe("no site stamped yet");
  });

  it("outcomeText words every GitHub conclusion, and an unknown one plainly (O13)", () => {
    expect(outcomeText({ outcome: "completed", runId: 1, conclusion: "failure" })).toBe("failed");
    expect(outcomeText({ outcome: "completed", runId: 1, conclusion: "weird_new" })).toBe(
      "did not succeed",
    );
    expect(
      outcomeText({ outcome: "failed", runId: null, conclusion: "dispatch-failed", error: "x" }),
    ).toBe("could not start");
    expect(outcomeText(null)).toBe("not recorded");
  });

  it("counts the nights collected (T4)", () => {
    expect(overviewFromSnapshot(snapshot({ nights: [] }), NOW).nightsCollected).toBe(0);
    expect(
      overviewFromSnapshot(snapshot({ nights: [night("2026-10-26"), night("2026-10-24")] }), NOW)
        .nightsCollected,
    ).toBe(2);
  });

  it("reliability counts calendar nights and says which were not recorded (O14)", () => {
    const v = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26"), night("2026-10-24")] }),
      NOW,
    );
    expect(v.nightly.reliability).toBe(
      "16 of 16 runs green over the last 3 nights (1 night not recorded)",
    );
  });

  it("the domain cell flags 30 days or fewer (O8)", () => {
    const cell = (d: number) =>
      overviewFromSnapshot(
        snapshot({ sites: [healthy({ id: "recA", name: "Acme", certDaysRemaining: d })] }),
        NOW,
      ).live[0]!.domain;
    expect(cell(31)).toEqual({ ok: true, text: "31 days left" });
    expect(cell(30)).toEqual({ ok: false, text: "30 days left" });
  });

  it("a fresh stamp with no verdict says the test may have skipped it (O17)", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", formE2eOk: null })] }),
      NOW,
    );
    expect(v.live[0]!.forms).toEqual({
      ok: null,
      text: "No result (no form, or the test skipped it)",
    });
  });

  it("fleet-wide items are counted apart from sites (O15)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recA", name: "Acme", urlCheckedAt: STALE, urlResolves: "pass" })],
      }),
      NOW,
    );
    // The probe falling behind is fleet-wide (url-probe-stale), not a site.
    expect(v.status.counts.attention).toBe(0);
    expect(v.status.counts.fleetAttention).toBe(1);
    expect(v.status.parts.map((p) => [p.text, p.href])).toContainEqual([
      "1 fleet-wide item needs attention too.",
      "/triage#cardless",
    ]);
    // Not checked lately reads as such, never "The rest live;".
    expect(v.status.line).toContain("1 not checked lately.");
  });
});

describe("review round 1: open vulnerabilities name the one wait that applies (O6)", () => {
  const vulnSite = (over: Partial<WebsiteRow> = {}) =>
    healthy({
      id: "recA",
      name: "Acme",
      securityVulnsHigh: 2,
      lastSecurityAuditAt: FRESH,
      ...over,
    });
  const open = (site: WebsiteRow, firstFlaggedAt: string) =>
    overviewFromSnapshot(
      snapshot({
        sites: [site],
        digest: { "vuln:recA": { metric: 2, firstFlaggedAt } },
      }),
      NOW,
    ).upkeep.open;

  it("a direct one inside its wait: the automatic update, and the date it comes to us", () => {
    // First seen Oct 26; a direct vuln waits 4 days: Oct 30 00:00Z, Oct 29 in Pacific time.
    expect(open(vulnSite(), "2026-10-26")).toEqual([
      {
        siteId: "recA",
        siteName: "Acme",
        text: "2 critical or high vulnerabilities: an automatic update should clear it; if it is still here on Oct 29, it comes to us",
      },
    ]);
  });

  it("a transitive one inside its wait: Monday's refresh, and its own date", () => {
    const transitive = vulnSite({
      securityAdvisories: [
        {
          module: "x",
          severity: "high",
          title: "t",
          cves: [],
          url: null,
          relationship: "transitive",
        },
      ],
    });
    // The Monday after Oct 26 closes Nov 2 18:00Z; two days on is Nov 4.
    expect(open(transitive, "2026-10-26")[0]!.text).toBe(
      "2 critical or high vulnerabilities: it sits deeper in the site's packages, so Monday's weekly package refresh should clear it; if it is still here on Nov 4, it comes to us",
    );
  });

  it("past its wait: ours this week, with the date it ran out", () => {
    expect(open(vulnSite(), "2026-10-20")[0]!.text).toBe(
      "2 critical or high vulnerabilities: the automatic update did not clear it by Oct 23, so it is ours to fix this week",
    );
  });

  it("the automatic fix gave up: ours by hand", () => {
    expect(open(vulnSite({ securityAutoFixAttempts: 3 }), "2026-10-26")[0]!.text).toBe(
      "2 critical or high vulnerabilities: the automatic update tried and gave up, so it is ours to fix by hand",
    );
  });

  it("with no first sighting to read, nothing waits, and it says so", () => {
    const v = overviewFromSnapshot(snapshot({ sites: [vulnSite()] }), NOW);
    expect(v.upkeep.open[0]!.text).toBe(
      "2 critical or high vulnerabilities: we could not confirm when it was first seen, so it is ours to look at this week",
    );
  });
});

describe("review round 1: boundaries (T6)", () => {
  const H = 3_600_000;
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

  it("freshness holds at 3 days less an hour, and lapses at 3 days and an hour", () => {
    const cell = (at: string) =>
      liveCell(healthy({ urlCheckedAt: FRESH, browserCheckedAt: at }), NOW);
    expect(cell(ago(72 * H - H)).ok).toBe(true);
    expect(cell(ago(72 * H + H)).ok).toBeNull();
  });

  it("a window reaches back 30 nights, and not 31", () => {
    const pick = (c: OverviewNight["counts"]) => c.prsMerged.value;
    const at30 = windowed(
      [
        night("2026-10-26", { prsMerged: { value: 9 } }),
        night("2026-09-26", { prsMerged: { value: 2 } }),
      ],
      pick,
    );
    expect(at30).toEqual({ value: 7, nights: 30 });
    const at31 = windowed(
      [
        night("2026-10-26", { prsMerged: { value: 9 } }),
        night("2026-09-25", { prsMerged: { value: 2 } }),
      ],
      pick,
    );
    expect(at31).toBeNull();
  });

  it("reliability counts 30 calendar nights, and not a 31st", () => {
    const v = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26"), night("2026-09-27"), night("2026-09-26")] }),
      NOW,
    );
    expect(v.nightly.reliability).toBe(
      "16 of 16 runs green over the last 30 nights (28 nights not recorded)",
    );
  });

  it("this month is the Pacific calendar month", () => {
    // Nov 1 00:00 PT is 07:00Z (still daylight time that night).
    expect(pacificMonthStart(new Date("2026-11-05T18:00:00.000Z"))).toEqual({
      at: Date.parse("2026-11-01T07:00:00.000Z"),
      day: "2026-11-01",
    });
    // Dec 1 00:00 PT is 08:00Z (standard time).
    expect(pacificMonthStart(new Date("2026-12-01T07:30:00.000Z")).day).toBe("2026-11-01");
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({ id: "o", siteId: "recA", submittedAt: "2026-11-01T06:30:00.000Z" }),
          makeSubmissionRow({ id: "n", siteId: "recA", submittedAt: "2026-11-01T07:30:00.000Z" }),
        ],
      }),
      new Date("2026-11-05T18:00:00.000Z"),
    );
    // 06:30Z on Nov 1 is still Oct 31 in Pacific time.
    expect(v.leads.thisMonth?.submissions).toBe(1);
  });
});

describe("review round 1: the check proofs are numbered from the nightly (T3)", () => {
  it("each proof names its step by the step's place in NIGHTLY_STEPS", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    const proof = (name: string) => v.reports.checks.find((c) => c.name === name)!.proof;
    expect(proof("Google Indexed")).toMatch(/^Step 8 /);
    expect(proof("Security Updates")).toMatch(/^Step 4 /);
    expect(proof("CMS Checked")).toMatch(/^Step 5 .*; step 2 /);
    // Renumbered with the order: a stub numbering moves every proof with it.
    expect(CHECK_PROOF["Google Indexed"]!(() => 42)).toMatch(/^Step 42 /);
    expect(stepNumber("daily-reports.yml")).toBe(NIGHTLY_STEPS.length);
    expect(() => stepNumber("no-such.yml")).toThrow();
  });

  it("no proof promises more than the nightly does (O12)", () => {
    const v = overviewFromSnapshot(snapshot(), NOW);
    const proof = (name: string) => v.reports.checks.find((c) => c.name === name)!.proof;
    expect(proof("Uptime Checked")).toContain("once a night");
    expect(proof("Security Updates")).not.toContain("fix them");
  });
});

describe("review round 1: How we count", () => {
  it("builds its freshness window from PRODUCTION_STALE_DAYS, not a typed 3", () => {
    const live = HOW_WE_COUNT.find((h) => h.term === "Live")!.text;
    expect(live).toContain(`more than ${PRODUCTION_STALE_DAYS} days old`);
  });
});
