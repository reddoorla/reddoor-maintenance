import { describe, it, expect } from "vitest";
import {
  overviewFromSnapshot,
  CHECK_PROOF,
  FORM_TEST_FAILED,
  HOW_WE_COUNT,
  LADDER_LINES,
  NIGHTLY_STEPS,
  NOT_YET,
  UNREADABLE,
  expectedNight,
  liveCell,
  outcomeText,
  pacificMonthStart,
  stepNumber,
  urlStatusText,
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
      "2 sites in our care. 1 not live at the last check. 1 live at the last check, Oct 26, 11:30pm PT. 1 site broken.",
    );
    // In plain words, not the triage title ("a sampled page did not answer 2xx or 3xx").
    expect(v.status.broken).toEqual([
      {
        key: "bravo",
        siteName: "Bravo",
        url: "/s/bravo",
        reasons: "a page on the site did not answer at the last check",
        age: "flagged 2 days ago",
      },
    ]);
    expect(v.status.parts.find((p) => p.text === "1 site broken.")?.href).toBe("/triage#broken");
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
      unsampled: false,
    });
    expect(v.live[0]!.domain.text).toBe("60 days left");
  });

  it("Live names a fresh uptime fail even when the address resolves", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", reachableOk: "fail" })] }),
      NOW,
    );
    expect(v.live[0]!.live).toMatchObject({ ok: false, text: "A page not answering" });
    expect(v.status.line).toContain("1 not live at the last check.");
  });

  it("Live names an address that does not resolve", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recA", name: "Acme", urlResolves: "fail", urlStatus: "404" })],
      }),
      NOW,
    );
    expect(v.live[0]!.live).toMatchObject({
      ok: false,
      text: "Address not answering (page not found, 404)",
    });
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
    expect(v.live.find((r) => r.siteName === "Acme")!.lastLead).toBe("last real lead 5 hours ago");
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
    expect(v.leads.biggest).toEqual({
      siteName: "Acme",
      submissions: 4,
      share: 57,
      formKind: "a contact form",
      accepted: 2,
    });
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
    expect(v.reports.perSite.find((r) => r.siteName === "Acme")!.waiting).toBe("1");
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
      "3 kinds of check ran on the night of Oct 26, reaching up to 2 sites",
    );
    expect(v.nightly.reliability).toBe(
      "15 of 16 nightly steps ran to the end over the last 2 nights",
    );
    expect(v.nightly.steps[6]!.sites).toBe("1 site that night");
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
    // Review round 3 (O4): it says when counting started, never 0, and agrees with
    // How we count's one night.
    expect(v.upkeep.automerged).toBe(
      "counting started on the night of Oct 26; the first figure comes after a second night",
    );
    // Review round 3 (O5): dated, and how many sites the sum covers.
    expect(v.upkeep.depsBehind).toBe(
      "5, added up across the 2 sites read on the night of Oct 26 (one package behind on three sites counts three times)",
    );
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
        text: expect.stringMatching(/^has 2 critical or high vulnerabilities; /),
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
    expect(v.status.counts).toEqual({
      broken: 0,
      fleetBroken: 0,
      attention: 2,
      fleetAttention: 0,
      watch: 1,
      approval: 3,
    });
    expect(v.status.parts.map((p) => [p.text, p.href])).toEqual([
      ["3 sites in our care.", undefined],
      ["All live at the last check, Oct 26, 11:30pm PT.", undefined],
      ["2 sites need attention this week.", "/triage#attention"],
      ["1 site to watch.", "/triage#watch"],
      // Every draft is on an Attention site, so the Triage page has no approval
      // group: the count opens this page's own table (review round 2, C4).
      ["3 reports wait for your yes.", "#ov-reports"],
    ]);
    expect(v.reports.perSite.map((r) => [r.siteName, r.waiting])).toEqual([
      ["Acme", "2"],
      ["Bravo", "1"],
      ["Wren", "0"],
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
    expect(at({})).toEqual({ ok: true, text: "Published 2 days ago" });
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
      outcome: "ran to the end",
      lastFinished: "Oct 26, 11:40pm PT",
    });
    // GitHub's own words never show raw.
    expect(step("fleet-smoke.yml").outcome).toBe("ran out of time");
    // A step that stamps no site: the run it last finished in, and how.
    expect(step("fleet-db-backup.yml").lastFinished).toBe(
      "in the run that started Oct 26, 11:07pm PT (ran to the end)",
    );
    // Still running on the newest night, so the night before is its last finish.
    expect(step("fleet-prismic-sync.yml")).toMatchObject({
      outcome: "still running when the night was written",
      lastFinished: "in the run that started Oct 25, 11:07pm PT (ran to the end)",
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
    expect(overviewFromSnapshot(snapshot({ nights: [] }), NOW).nightsCollected).toBe("0 nights");
    expect(
      overviewFromSnapshot(snapshot({ nights: [night("2026-10-26"), night("2026-10-24")] }), NOW)
        .nightsCollected,
    ).toBe("2 nights");
  });

  it("reliability counts calendar nights and says which were not recorded (O14)", () => {
    const v = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26"), night("2026-10-24")] }),
      NOW,
    );
    expect(v.nightly.reliability).toBe(
      "16 of 16 nightly steps ran to the end over the last 3 nights (1 night not recorded)",
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
      "1 item not tied to one site needs attention too.",
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
        text: "has 2 critical or high vulnerabilities; we are waiting until Oct 29 for an automatic update to fix them; if they are still open then, they come to us",
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
      "has 2 critical or high vulnerabilities; they sit deeper in the site's packages, so they wait for Monday's weekly package refresh and 2 days after it, until Nov 4; if they are still open then, they come to us",
    );
  });

  it("past its wait: ours this week, with the date it ran out", () => {
    expect(open(vulnSite(), "2026-10-20")[0]!.text).toBe(
      "has 2 critical or high vulnerabilities; the automatic update did not clear them by Oct 23, so they are ours to fix this week",
    );
  });

  it("the automatic fix gave up: ours by hand", () => {
    expect(open(vulnSite({ securityAutoFixAttempts: 3 }), "2026-10-26")[0]!.text).toBe(
      "has 2 critical or high vulnerabilities; the automatic update tried and gave up, so they are ours to fix by hand",
    );
  });

  it("with no first sighting to read, nothing waits, and it says so", () => {
    const v = overviewFromSnapshot(snapshot({ sites: [vulnSite()] }), NOW);
    expect(v.upkeep.open[0]!.text).toBe(
      "has 2 critical or high vulnerabilities; we could not confirm when they were first seen, so they are ours to look at this week",
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
      "16 of 16 nightly steps ran to the end over the last 30 nights (28 nights not recorded)",
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

describe("review round 2", () => {
  const draft = (id: string, siteId: string) =>
    report({ id, siteId, approvedToSend: false, sentAt: null, approvedAt: null });

  it("with no reports read, each site's next due and waiting read not readable (C1)", () => {
    const v = overviewFromSnapshot(snapshot({ reports: null }), NOW);
    expect(v.reports.sent).toBeNull();
    expect(v.reports.perSite.map((r) => [r.nextDue, r.waiting])).toEqual([
      [UNREADABLE, UNREADABLE],
      [UNREADABLE, UNREADABLE],
    ]);
  });

  it("past the reader's 31 rows, the nights counted are a floor (C2)", () => {
    const days = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        night(new Date(Date.UTC(2026, 9, 26) - i * 86_400_000).toISOString().slice(0, 10)),
      );
    expect(overviewFromSnapshot(snapshot({ nights: days(30) }), NOW).nightsCollected).toBe(
      "30 nights",
    );
    expect(overviewFromSnapshot(snapshot({ nights: days(31) }), NOW).nightsCollected).toBe(
      "at least 31 nights",
    );
    expect(
      overviewFromSnapshot(snapshot({ nights: [night("2026-10-26")] }), NOW).nightsCollected,
    ).toBe("1 night");
  });

  it("an older night's coverage is dated as that night, never the newest (C3, O5)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        nights: [
          night("2026-10-26", { coverage: { value: null, reason: "read failed" } }),
          night("2026-10-25"),
        ],
      }),
      NOW,
    );
    expect(v.nightly.nightOf).toBe("Night of Oct 26");
    expect(v.nightly.scale).toBe(
      "3 kinds of check ran on the night of Oct 25, reaching up to 2 sites",
    );
    expect(v.nightly.steps[stepNumber("fleet-form-e2e.yml") - 1]!.sites).toBe(
      "1 site on the night of Oct 25",
    );
    // With no night at all, nothing claims a night.
    expect(overviewFromSnapshot(snapshot({ nights: [] }), NOW).nightly.nightOf).toBe(
      "Newest night",
    );
  });

  it("links the approval count to the Triage group only when it is there (C4)", () => {
    // Every draft on an Attention site (no recipients): no approval group there.
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme" })], reports: [draft("p1", "recA")] }),
      NOW,
    );
    expect(v.status.parts.find((p) => p.text === "1 report waits for your yes.")?.href).toBe(
      "#ov-reports",
    );
  });

  it("counts a fleet-wide Broken item on its own and names it (C5, T4)", () => {
    const v = overviewFromSnapshot(snapshot({ deadLetters: new Map([["ghost-site", 2]]) }), NOW);
    expect(v.status.cls).toBe("broken");
    expect(v.status.counts).toMatchObject({ broken: 0, fleetBroken: 1 });
    expect(v.status.parts.map((p) => [p.text, p.href])).toContainEqual([
      "1 item not tied to one site is broken.",
      "/triage#cardless",
    ]);
    expect(v.status.line).not.toContain("site broken");
    expect(v.status.broken).toEqual([
      {
        key: "deadletter:ghost-site",
        siteName: "(unknown site: ghost-site)",
        url: "/triage#cardless",
        reasons: "leads are stuck and have not reached the client",
        age: "flagged today",
      },
    ]);
  });

  it("says this month's screen-outs are kept in UTC days (C6)", () => {
    const stopped = HOW_WE_COUNT.find((h) => h.term === "Stopped before storage")!.text;
    expect(stopped).toContain("whole days by UTC time, not Pacific");
  });

  it("a fresh check that sampled no page is neither live nor unchecked (C7)", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", reachableOk: null })] }),
      NOW,
    );
    expect(v.live[0]!.live).toEqual({
      ok: null,
      text: "Address answers; no page sampled",
      at: "Oct 26, 11:30pm PT",
      atIso: FRESH,
      unsampled: true,
    });
    expect(v.status.line).toBe(
      "1 site in our care. 1 answers at its address, but no page was sampled. Nothing needs attention.",
    );
    expect(v.status.line).not.toContain("not checked lately");
  });

  it("a night with no run says its night instead (C8)", () => {
    const older = night("2026-10-25", { run: null });
    const newest = night("2026-10-26");
    newest.counts.steps["fleet-db-backup.yml"] = { outcome: "running", runId: 2, conclusion: null };
    const v = overviewFromSnapshot(snapshot({ nights: [newest, older] }), NOW);
    expect(v.nightly.steps[stepNumber("fleet-db-backup.yml") - 1]!.lastFinished).toBe(
      "on the night of Oct 25 (ran to the end)",
    );
  });

  it("a vulnerability count from a stale audit is not open now (C9)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme", securityVulnsHigh: 2, lastSecurityAuditAt: STALE }),
        ],
      }),
      NOW,
    );
    expect(v.upkeep.open).toEqual([
      {
        siteId: "recA",
        siteName: "Acme",
        text: "had 2 critical or high vulnerabilities at the last security check, Oct 19; not checked lately, so we cannot say what is open now",
      },
    ]);
  });

  it("one vulnerability reads in the singular (minor)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme", securityVulnsHigh: 1, lastSecurityAuditAt: FRESH }),
        ],
        digest: { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-10-20" } },
      }),
      NOW,
    );
    expect(v.upkeep.open[0]!.text).toBe(
      "has 1 critical or high vulnerability; the automatic update did not clear it by Oct 23, so it is ours to fix this week",
    );
  });

  it("with no fleet_daily row, each step's reach and last finish say not yet collected (T3)", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme" })], nights: [] }),
      NOW,
    );
    expect(v.nightly.steps.map((s) => [s.sites, s.lastFinished])).toEqual([
      ["the whole database, every site's records in one copy", NOT_YET],
      [NOT_YET, "no site stamped yet"],
      ["sites on Prismic, with a pull request only where something changed", NOT_YET],
      [NOT_YET, "Oct 26, 11:30pm PT"],
      [NOT_YET, "Oct 26, 11:30pm PT"],
      [NOT_YET, "no site stamped yet"],
      [NOT_YET, "Oct 26, 11:30pm PT"],
      ["sites with a report due", NOT_YET],
    ]);
  });

  it("a failed screen-out read says not readable this month, never 0 (T5)", () => {
    const v = overviewFromSnapshot(snapshot({ screenOuts: null }), NOW);
    expect(v.leads.stoppedThisMonth).toBe(UNREADABLE);
  });

  it("names the biggest site's form and how many of the accepted are its (O3)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          ...["r1", "r2", "r3"].map((id) =>
            makeSubmissionRow({ id, siteId: "recR", formType: "rsvp", status: "read" }),
          ),
          makeSubmissionRow({ id: "a1", siteId: "recA", status: "new" }),
        ],
      }),
      NOW,
    );
    expect(v.leads.biggest).toEqual({
      siteName: "Rsvp Site",
      submissions: 3,
      share: 75,
      formKind: "an RSVP form",
      accepted: 3,
    });
  });

  it("an RSVP site's last real entry is a submission, not a lead (nit)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({
            id: "r1",
            siteId: "recR",
            formType: "rsvp",
            status: "read",
            submittedAt: "2026-10-27T13:00:00.000Z",
          }),
        ],
      }),
      NOW,
    );
    expect(v.live.find((r) => r.siteName === "Rsvp Site")!.lastLead).toBe(
      "last real submission 5 hours ago",
    );
  });

  it("a Broken item flagged today says so (nit)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recB", name: "Bravo", reachableOk: "fail" })],
        digest: { "uptime:recB": { metric: 1, firstFlaggedAt: "2026-10-27" } },
      }),
      NOW,
    );
    expect(v.status.broken[0]!.age).toBe("flagged today");
  });

  it("dates the Lighthouse medians by the oldest audit behind them (minor)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "a", name: "A", pScore: 90, lastLighthouseAuditAt: FRESH }),
          healthy({ id: "b", name: "B", pScore: 70, lastLighthouseAuditAt: STALE }),
          healthy({ id: "c", name: "C", lastLighthouseAuditAt: "2026-09-01T00:00:00.000Z" }),
        ],
      }),
      NOW,
    );
    // C has no score, so its older stamp is not behind any median.
    expect(v.reports.lighthouseAsOf).toBe("Oct 19");
  });

  it("puts the URL probe's status in plain words (minor)", () => {
    expect(urlStatusText("error: ENOTFOUND")).toBe("no such address");
    expect(urlStatusText("503")).toBe("server error 503");
    expect(urlStatusText("404")).toBe("page not found, 404");
    expect(urlStatusText("404 netlify-site-not-found")).toBe("our host serves no site there");
    expect(urlStatusText("error: EWEIRD")).toBe("a network error, code EWEIRD");
  });

  it("says one night as the one night counted so far (minor)", () => {
    const v = overviewFromSnapshot(snapshot({ nights: [night("2026-10-26")] }), NOW);
    expect(v.nightly.reliability).toBe(
      "8 of 8 nightly steps ran to the end on the 1 night counted so far",
    );
  });

  it("the ladder's OK says nothing open, not every check passed (O4)", () => {
    // Review round 3 (O3): nothing for us to act on, since a vulnerability waiting
    // on an automatic update leaves a site at OK and is listed under Open now.
    expect(LADDER_LINES.at(-1)).toBe(
      'OK: nothing for us to act on at the last checks. A vulnerability waiting on an automatic update is listed under Open now, and a cell that reads "not checked lately" says what we could not confirm.',
    );
  });
});

describe("review round 3", () => {
  const draft = (id: string, siteId: string) =>
    report({ id, siteId, approvedToSend: false, sentAt: null, approvedAt: null });
  const days = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) =>
      night(new Date(Date.parse(`${from}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10)),
    );

  it("expects last night's row from 6am Pacific, by the writer's own rule (C1)", () => {
    // 13:00Z on Oct 27 is 6am PDT: the night of Oct 26 should be written by now.
    expect(expectedNight(new Date("2026-10-27T13:00:00.000Z"))).toBe("2026-10-26");
    expect(expectedNight(new Date("2026-10-27T12:59:00.000Z"))).toBe("2026-10-25");
    expect(expectedNight(NOW)).toBe("2026-10-26");
  });

  it("a nightly that stopped writing dates every window and counts the nights since (C1)", () => {
    // NOW is Oct 27; the newest row is Oct 14, so 12 nights have no row.
    const nights = [
      night("2026-10-14", {
        events: { value: { pr_automerged: 168, vuln_cleared: 36 } },
        prsMerged: { value: 662 },
      }),
      night("2026-10-08"),
    ];
    const v = overviewFromSnapshot(snapshot({ nights }), NOW);
    expect(v.upkeep.automerged).toBe(
      "68 over the 6 nights to the night of Oct 14; no count in the 12 nights since",
    );
    expect(v.upkeep.vulnsCleared).toBe(
      "26 over the 6 nights to the night of Oct 14; no count in the 12 nights since",
    );
    expect(v.prsMerged).toBe(
      "62 over the 6 nights to the night of Oct 14; no count in the 12 nights since",
    );
    expect(v.nightly.reliability).toBe(
      "16 of 16 nightly steps ran to the end over the last 19 nights (17 nights not recorded, none since the night of Oct 14)",
    );
    expect(v.nightly.nightOf).toBe("Night of Oct 14");
    expect(v.upkeep.depsBehind).toContain("read on the night of Oct 14");
    // The reviewer's case: 30 nights of rows ending Oct 14. Never "240 of 240 over
    // the last 30 nights" with nothing said about the 12 since.
    const month = overviewFromSnapshot(snapshot({ nights: days("2026-10-14", 30) }), NOW);
    expect(month.nightly.reliability).toBe(
      "144 of 144 nightly steps ran to the end over the last 30 nights (12 nights not recorded, none since the night of Oct 14)",
    );
    // A single stale night says when counting started, and the nights since.
    const one = overviewFromSnapshot(snapshot({ nights: [night("2026-10-14")] }), NOW);
    expect(one.prsMerged).toBe(
      "counting started on the night of Oct 14; the first figure comes after a second night; no count in the 12 nights since",
    );
    // Rows all older than the window: said, never "not yet collected".
    const old = overviewFromSnapshot(snapshot({ nights: [night("2026-09-01")] }), NOW);
    expect(old.nightly.reliability).toBe(
      "no night recorded in the last 30; the newest is the night of Sep 1",
    );
    // Control: with last night's row in, the windows read as before.
    const current = overviewFromSnapshot(
      snapshot({
        nights: [night("2026-10-26", { prsMerged: { value: 662 } }), night("2026-10-20")],
      }),
      NOW,
    );
    expect(current.prsMerged).toBe("62 over the last 6 nights");
    expect(current.nightly.reliability).toBe(
      "16 of 16 nightly steps ran to the end over the last 7 nights (5 nights not recorded)",
    );
  });

  it("counts the drafts waiting over the sites in our care, as the table does (C3)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme" }),
          healthy({ id: "recL", name: "Launchy", status: "launching" }),
        ],
        reports: [draft("p1", "recA"), draft("p2", "recL"), draft("p3", "recL")],
      }),
      NOW,
    );
    expect(v.status.counts.approval).toBe(1);
    expect(v.status.line).toContain("1 report waits for your yes.");
    const waiting = v.reports.perSite.reduce((t, r) => t + Number(r.waiting), 0);
    expect(waiting).toBe(v.status.counts.approval);
    expect(HOW_WE_COUNT.find((h) => h.term === "Waiting for your yes")!.text).toContain(
      "on a site in our care",
    );
  });

  it("a failed form test is shown, but not as a verdict, and the level is unchanged (O1)", () => {
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", formE2eOk: "fail" })] }),
      NOW,
    );
    expect(v.live[0]!.forms).toEqual({ ok: null, text: FORM_TEST_FAILED });
    expect(FORM_TEST_FAILED).toBe(
      "Test failed, but the test itself is being fixed, so this is not yet a verdict",
    );
    // The ladder is settled: the form test places no site (collectFormTestAlerts is
    // not registered), so the level stays OK and the status line says nothing.
    expect(v.live[0]!.level).toEqual({ tier: "healthy", text: "OK" });
    expect(v.status.line).toBe(
      "1 site in our care. It was live at the last check, Oct 26, 11:30pm PT. Nothing needs attention.",
    );
    expect(HOW_WE_COUNT.find((h) => h.term === "Forms")!.text).toContain(
      "does not change the site's level",
    );
    // The ladder's Broken example is one that can happen today.
    expect(LADDER_LINES[0]).toBe(
      "Broken: a visitor or a client is affected now, such as a site that does not answer, or leads not reaching the client.",
    );
    expect(LADDER_LINES[0]).not.toMatch(/form/);
  });

  it("How we count agrees with the ladder and names one check one way (C2, O2, O9)", () => {
    const line = (t: string) => HOW_WE_COUNT.find((h) => h.term === t)!.text;
    expect(line("Broken, attention, watch")).toContain("These are the Triage page's counts");
    expect(line("Certificate")).toContain(
      "30 days or fewer is shown in bold and puts the site at Attention",
    );
    expect(line("Certificate")).not.toContain("only matters");
    expect(line("Live")).not.toContain("uptime check");
    const v = overviewFromSnapshot(
      snapshot({ sites: [healthy({ id: "recA", name: "Acme", certDaysRemaining: 28 })] }),
      NOW,
    );
    expect(v.live[0]!.level.tier).toBe("attention");
  });

  it("glosses Prismic where the steps name it (O6)", () => {
    const labels = NIGHTLY_STEPS.map((s) => s.label).filter((l) => l.startsWith("Prismic"));
    expect(labels).toHaveLength(2);
    for (const l of labels) expect(l).toMatch(/^Prismic \(the CMS/);
  });
});

describe("review round 4", () => {
  const sites = (...xs: WebsiteRow[]) => overviewFromSnapshot(snapshot({ sites: xs }), NOW);

  it("a fresh domain check with no certificate days is Broken in the cell too (C1a)", () => {
    const v = sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: null }));
    // The ladder names it Broken (collectDomainAlerts); the cell agrees, in plain words.
    expect(v.status.broken.map((b) => [b.siteName, b.reasons])).toEqual([
      ["Acme", "the domain does not answer, or has no working security certificate"],
    ]);
    expect(v.live[0]!.domain).toEqual({
      ok: false,
      text: "Domain does not answer, or no working certificate",
    });
    // A stale check with no days is still unknown, never Broken.
    expect(
      sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: null, domainCheckedAt: STALE }))
        .live[0]!.domain,
    ).toEqual({ ok: null, text: "Not checked lately" });
  });

  it("the cell counts the days down from the check, as the ladder does (C1b)", () => {
    // 9 days stored 2.5 days ago: 2 whole days used, so 7 now, which is Broken.
    const v = sites(
      healthy({
        id: "recB",
        name: "Bravo",
        certDaysRemaining: 9,
        domainCheckedAt: "2026-10-25T06:00:00.000Z",
      }),
    );
    expect(v.live[0]!.domain).toEqual({ ok: false, text: "7 days left" });
    expect(v.live[0]!.level.tier).toBe("broken");
    expect(HOW_WE_COUNT.find((h) => h.term === "Certificate")!.text).toContain(
      "less the whole days since",
    );
  });

  it("0 days left is not yet expired; below 0 is (T5)", () => {
    const cell = (d: number, at = FRESH) =>
      sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: d, domainCheckedAt: at }))
        .live[0]!.domain;
    expect(cell(0)).toEqual({ ok: false, text: "0 days left" });
    expect(cell(-1)).toEqual({ ok: false, text: "Certificate expired" });
    // Aged to 0: 2 stored, 2.5 days ago.
    expect(cell(2, "2026-10-25T06:00:00.000Z")).toEqual({ ok: false, text: "0 days left" });
    expect(cell(1, "2026-10-25T06:00:00.000Z")).toEqual({
      ok: false,
      text: "Certificate expired",
    });
  });

  it("Open now checks freshness first: a site with no fresh audit is listed, whatever its count (C2)", () => {
    const v = sites(
      healthy({
        id: "recA",
        name: "Acme",
        lastSecurityAuditAt: null,
        securityVulnsCritical: null,
        securityVulnsHigh: null,
      }),
      healthy({ id: "recB", name: "Bravo", lastSecurityAuditAt: STALE }),
      healthy({ id: "recD", name: "Delta" }),
    );
    expect(v.upkeep.open).toEqual([
      {
        siteId: "recA",
        siteName: "Acme",
        text: "has no security check on record, so we cannot say what is open now",
      },
      {
        siteId: "recB",
        siteName: "Bravo",
        text: "had no critical or high vulnerability at the last security check, Oct 19; not checked lately, so we cannot say what is open now",
      },
    ]);
    // Every site freshly audited with none open: the list is empty, and the page's
    // "none open" sentence may stand.
    expect(sites(healthy({ id: "recD", name: "Delta" })).upkeep.open).toEqual([]);
  });

  it("a ready deploy with no date says the date was not recorded (C3, O8)", () => {
    expect(
      sites(healthy({ id: "recA", name: "Acme", lastDeployAt: null })).live[0]!.deploy,
    ).toEqual({ ok: true, text: "Published (date not recorded)" });
  });

  it("reliability counts only the steps that finished (T2)", () => {
    const n = night("2026-10-26");
    n.counts.steps["fleet-prismic-sync.yml"] = { outcome: "running", runId: 1, conclusion: null };
    n.counts.steps["fleet-smoke.yml"] = { outcome: "skipped", runId: null, conclusion: null };
    n.counts.steps["fleet-form-e2e.yml"] = {
      outcome: "completed",
      runId: 1,
      conclusion: "failure",
    };
    n.counts.steps["daily-reports.yml"] = {
      outcome: "failed",
      runId: null,
      conclusion: "dispatch-failed",
      error: "x",
    };
    const v = overviewFromSnapshot(snapshot({ nights: [n] }), NOW);
    // 8 steps: 4 ran to the end, 1 failed, 1 could not start, 1 running, 1 skipped.
    expect(v.nightly.reliability).toBe(
      "4 of 6 nightly steps ran to the end on the 1 night counted so far",
    );
  });

  it("a step's Reached is the most sites any of its checks stamped (T3)", () => {
    const n = night("2026-10-26", {
      coverage: { value: { lighthouse_at: { value: 17 }, browser_checked_at: { value: 15 } } },
    });
    const v = overviewFromSnapshot(snapshot({ nights: [n] }), NOW);
    expect(v.nightly.steps[stepNumber("fleet-lighthouse.yml") - 1]!.sites).toBe(
      "17 sites that night",
    );
  });

  it("the biggest share rounds to the nearest whole percent (T6)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        submissions: [
          makeSubmissionRow({ id: "r1", siteId: "recR", formType: "rsvp", status: "read" }),
          makeSubmissionRow({ id: "r2", siteId: "recR", formType: "rsvp", status: "read" }),
          makeSubmissionRow({ id: "a1", siteId: "recA", status: "new" }),
        ],
      }),
      NOW,
    );
    expect(v.leads.biggest!.share).toBe(67);
  });

  it("a step that succeeded ran to the end, and says no more than that (O1)", () => {
    const v = overviewFromSnapshot(snapshot({ nights: [night("2026-10-26")] }), NOW);
    expect(v.nightly.steps.map((s) => s.outcome)).toEqual(Array(8).fill("ran to the end"));
    expect(v.nightly.reliability).toBe(
      "8 of 8 nightly steps ran to the end on the 1 night counted so far",
    );
    const line = (t: string) => HOW_WE_COUNT.find((h) => h.term === t)!.text;
    const caveat =
      "A step that runs to the end can still find problems; what it found is in the tables above.";
    expect(line("Steps")).toContain(caveat);
    expect(line("Runs completed")).toContain(caveat);
    expect(HOW_WE_COUNT.map((h) => h.term)).not.toContain("Runs green");
    expect(JSON.stringify(v)).not.toMatch(/green/);
  });

  it("an open vulnerability's wait reads right for one and for several (O2, O3)", () => {
    const open = (over: Partial<WebsiteRow>) =>
      overviewFromSnapshot(
        snapshot({
          sites: [healthy({ id: "recA", name: "Acme", lastSecurityAuditAt: FRESH, ...over })],
          digest: { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-10-26" } },
        }),
        NOW,
      ).upkeep.open[0]!.text;
    expect(open({ securityVulnsHigh: 1 })).toBe(
      "has 1 critical or high vulnerability; we are waiting until Oct 29 for an automatic update to fix it; if it is still open then, it comes to us",
    );
    const deep = [
      {
        module: "x",
        severity: "high" as const,
        title: "t",
        cves: [],
        url: null,
        relationship: "transitive" as const,
      },
    ];
    expect(open({ securityVulnsHigh: 1, securityAdvisories: deep })).toBe(
      "has 1 critical or high vulnerability; it sits deeper in the site's packages, so it waits for Monday's weekly package refresh and 2 days after it, until Nov 4; if it is still open then, it comes to us",
    );
  });

  it("the copy says what each count is, in plain words (O4-O7, O9-O11)", () => {
    const line = (t: string) => HOW_WE_COUNT.find((h) => h.term === t)!.text;
    expect(line("Certificate")).toContain(
      "At Attention we confirm it renews; we act only if it does not.",
    );
    expect(line("Accepted as real")).toBe(
      "Leads, signups and RSVPs kept as real: new, read or archived. Only contact, inquiry and reservation forms bring leads; a newsletter signup or an RSVP is not one.",
    );
    expect(line("Broken, attention, watch")).toContain(
      "each count opens that group on the Triage page.",
    );
    const down = sites(
      healthy({ id: "recA", name: "Acme" }),
      healthy({ id: "recB", name: "Bravo", reachableOk: "fail" }),
    );
    expect(down.status.line).toContain("1 not live at the last check.");
    expect(NIGHTLY_STEPS[stepNumber("fleet-lighthouse.yml") - 1]!.label).toContain(
      "browsers (each site opened in a real browser)",
    );
    expect(CHECK_PROOF["Google Indexed"]!(stepNumber)).toContain(
      "Google Search Console (Google's report on which pages it has indexed)",
    );
    // Relative times in words, never "1w ago".
    const lead = (submittedAt: string) =>
      overviewFromSnapshot(
        snapshot({
          submissions: [
            makeSubmissionRow({ id: "a1", siteId: "recA", status: "new", submittedAt }),
          ],
        }),
        NOW,
      ).live[0]!.lastLead;
    expect(lead("2026-10-20T12:00:00.000Z")).toBe("last real lead 1 week ago");
    expect(lead("2026-10-27T13:00:00.000Z")).toBe("last real lead 5 hours ago");
    expect(lead("2026-09-27T12:00:00.000Z")).toBe("last real lead 1 month ago");
    expect(lead("2026-10-27T17:59:30.000Z")).toBe("last real lead just now");
  });
});

describe("review round 5", () => {
  const sites = (...xs: WebsiteRow[]) => overviewFromSnapshot(snapshot({ sites: xs }), NOW);
  const reasonsOf = (v: ReturnType<typeof sites>) =>
    v.status.broken.map((b) => [b.siteName, b.reasons]);

  it("an expired certificate reads as expired in section 1, as its cell does (R5-1)", () => {
    const v = sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: -2 }));
    expect(reasonsOf(v)).toEqual([["Acme", "its security certificate has expired"]]);
    expect(v.live[0]!.domain).toEqual({ ok: false, text: "Certificate expired" });
    // Not yet expired, but within 7 days: the other words.
    expect(reasonsOf(sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: 3 })))).toEqual([
      ["Acme", "its security certificate runs out within 7 days"],
    ]);
  });

  it("a domain with no usable certificate is said in both halves, beside a live site (R5-2)", () => {
    const v = sites(healthy({ id: "recA", name: "Acme", certDaysRemaining: null }));
    expect(reasonsOf(v)).toEqual([
      ["Acme", "the domain does not answer, or has no working security certificate"],
    ]);
    expect(v.live[0]!.domain).toEqual({
      ok: false,
      text: "Domain does not answer, or no working certificate",
    });
  });

  it("a failed reports read is said in the status line, never 'Nothing needs attention' (R5-3)", () => {
    const v = overviewFromSnapshot(snapshot({ reports: null, gaps: ["reports"] }), NOW);
    expect(v.status.line).toBe(
      "2 sites in our care. All live at the last check, Oct 26, 11:30pm PT. Reports waiting for your yes: not readable.",
    );
    expect(v.status.line).not.toContain("Nothing needs attention");
    // With the read there and nothing waiting, the line is unchanged.
    expect(overviewFromSnapshot(snapshot(), NOW).status.line).toContain("Nothing needs attention.");
  });

  it("a stale failed deploy in section 1 is dated as an old reading, as its cell says (R5-4)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({ id: "recA", name: "Acme" }),
          healthy({ id: "recB", name: "Bravo", deployStatus: "error", deployCheckedAt: STALE }),
        ],
        digest: { "deploy:recB": { metric: 1, firstFlaggedAt: "2026-10-19" } },
      }),
      NOW,
    );
    expect(reasonsOf(v)).toEqual([
      [
        "Bravo",
        "the latest deploy had failed when last checked (Oct 19, 11:30pm PT, no check since)",
      ],
    ]);
    expect(v.live.find((r) => r.siteName === "Bravo")!.deploy.text).toBe("Not checked lately");
    // A fresh failed deploy keeps the plain words.
    const fresh = sites(healthy({ id: "recB", name: "Bravo", deployStatus: "error" }));
    expect(reasonsOf(fresh)).toEqual([["Bravo", "the latest deploy failed"]]);
  });

  it("a night with no step results never reads '0 of 0' (R5-5; round 6, R6-1)", () => {
    // No step results at all (no block, or every step null) was never collected: it
    // is not a night of steps that did not finish.
    const lone = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26", { steps: {} })] }),
      NOW,
    );
    expect(lone.nightly.reliability).toBe(NOT_YET);
    const nulls = Object.fromEntries(NIGHTLIES.map((n: { file: string }) => [n.file, null]));
    expect(
      overviewFromSnapshot(snapshot({ nights: [night("2026-10-26", { steps: nulls })] }), NOW)
        .nightly.reliability,
    ).toBe(NOT_YET);
    // Beside a full night, it is a night not recorded, never counted as measured.
    const two = overviewFromSnapshot(
      snapshot({ nights: [night("2026-10-26", { steps: {} }), night("2026-10-25")] }),
      NOW,
    );
    expect(two.nightly.reliability).toBe(
      `${NIGHTLIES.length} of ${NIGHTLIES.length} nightly steps ran to the end over the last 2 nights (1 night not recorded)`,
    );
    // Steps written while still running are results: none had finished.
    const running = Object.fromEntries(
      NIGHTLIES.map((n: { file: string }) => [
        n.file,
        { outcome: "running" as const, runId: 1, conclusion: null },
      ]),
    );
    expect(
      overviewFromSnapshot(snapshot({ nights: [night("2026-10-26", { steps: running })] }), NOW)
        .nightly.reliability,
    ).toBe("no nightly step had finished on the 1 night counted so far");
  });

  it("last night is expected from 6am Pacific by the clock, on the days the clock changes (R5-6)", () => {
    // Nov 1 (PDT ends at 2am): 5:30am PST is 13:30Z, before 6am, so the night of Oct 30.
    expect(expectedNight(new Date("2026-11-01T13:30:00Z"))).toBe("2026-10-30");
    expect(expectedNight(new Date("2026-11-01T14:00:00Z"))).toBe("2026-10-31");
    expect(expectedNight(new Date("2026-11-02T13:30:00Z"))).toBe("2026-10-31");
    expect(expectedNight(new Date("2026-11-02T14:00:00Z"))).toBe("2026-11-01");
    expect(expectedNight(new Date("2026-11-05T13:59:00Z"))).toBe("2026-11-03");
    expect(expectedNight(new Date("2026-11-05T14:00:00Z"))).toBe("2026-11-04");
    // Mar 8 (PDT starts at 2am): 6:30am PDT is 13:30Z, after 6am, so the night of Mar 7.
    expect(expectedNight(new Date("2026-03-08T13:30:00Z"))).toBe("2026-03-07");
    expect(expectedNight(new Date("2026-03-09T13:30:00Z"))).toBe("2026-03-08");
    expect(expectedNight(new Date("2026-03-09T12:59:00Z"))).toBe("2026-03-07");
  });
});

describe("review round 6 (on the round-5 fix)", () => {
  const sites = (...xs: WebsiteRow[]) => overviewFromSnapshot(snapshot({ sites: xs }), NOW);
  const reasonsOf = (v: ReturnType<typeof sites>) =>
    v.status.broken.map((b) => [b.siteName, b.reasons, b.age]);

  it("a stale failed deploy is one clause, and the age says it is the flag's (R6-2)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [
          healthy({
            id: "recB",
            name: "Bravo",
            deployStatus: "error",
            deployCheckedAt: "2026-10-23T06:30:00.000Z",
          }),
        ],
        digest: { "deploy:recB": { metric: 1, firstFlaggedAt: "2026-10-01" } },
      }),
      NOW,
    );
    expect(reasonsOf(v)).toEqual([
      [
        "Bravo",
        "the latest deploy had failed when last checked (Oct 22, 11:30pm PT, no check since)",
        "flagged 26 days ago",
      ],
    ]);
    expect(v.status.broken[0]!.reasons).not.toContain(";");
    // With no check date recorded.
    const undated = sites(
      healthy({ id: "recB", name: "Bravo", deployStatus: "error", deployCheckedAt: null }),
    );
    expect(undated.status.broken[0]!.reasons).toBe(
      "the latest deploy had failed when last checked (date not recorded, no check since)",
    );
    // Just past the cell's freshness window, the words agree with the cell.
    const past = new Date(NOW.getTime() - (PRODUCTION_STALE_DAYS + 0.5) * 86_400_000).toISOString();
    const justStale = sites(
      healthy({ id: "recB", name: "Bravo", deployStatus: "error", deployCheckedAt: past }),
    );
    expect(justStale.status.broken[0]!.reasons).toMatch(
      /^the latest deploy had failed when last checked/,
    );
    expect(justStale.live[0]!.deploy.text).toBe("Not checked lately");
  });

  it("an aged certificate past its last day reads expired in section 1 (R6, R5-1's gap)", () => {
    // 1 day stored, checked 2.5 days ago: 2 whole days used, so -1 now.
    const v = sites(
      healthy({
        id: "recA",
        name: "Acme",
        certDaysRemaining: 1,
        domainCheckedAt: "2026-10-25T06:30:00.000Z",
      }),
    );
    expect(v.status.broken.map((b) => b.reasons)).toEqual(["its security certificate has expired"]);
    expect(v.live[0]!.domain.text).toBe("Certificate expired");
  });

  it("a failed reports read is said beside a Broken site too (R6, R5-3's gap)", () => {
    const v = overviewFromSnapshot(
      snapshot({
        sites: [healthy({ id: "recB", name: "Bravo", reachableOk: "fail" })],
        reports: null,
        gaps: ["reports"],
      }),
      NOW,
    );
    expect(v.status.line).toContain("1 site broken.");
    expect(v.status.line).toContain("Reports waiting for your yes: not readable.");
    expect(v.status.cls).toBe("broken");
    // Alone, the level is still worked out from the sites read, which are all fine.
    expect(overviewFromSnapshot(snapshot({ reports: null }), NOW).status.cls).toBe("ok");
  });

  it("a failed submissions read reads 'last lead not readable' in the Forms cell", () => {
    const v = overviewFromSnapshot(snapshot({ submissions: null, gaps: ["submissions"] }), NOW);
    expect(v.live.map((r) => r.lastLead)).toEqual([
      "last lead not readable",
      "last lead not readable",
    ]);
  });

  it("a one-night window after a stop says the night, not '1 night'", () => {
    const nights = [
      night("2026-10-14", { prsMerged: { value: 610 } }),
      night("2026-10-13", { prsMerged: { value: 600 } }),
    ];
    const v = overviewFromSnapshot(snapshot({ nights }), NOW);
    expect(v.prsMerged).toMatch(/^10 over the night of Oct 14; no count in the 12 nights since$/);
  });
});
