import { describe, it, expect, beforeEach, vi } from "vitest";
import { runReportCommand, parseSingleSiteReportType } from "../../src/cli/commands/report.js";

// draftReportForSite is the IO the guard sits between; mock it so the test
// exercises ONLY the skip/draft decision, not GA/render/upload. The fleet roster
// and the report list are no longer mocked modules: since #646 step 4 they are
// injected READS (from Turso in production), so a case seeds them directly.
// #612: the composition roots build real mirror factories, which under the
// freeze constant REFUSE to build without libSQL creds. Mocked here so this
// suite asserts what it claims to (the summary behaviour) rather than tracking
// which side of the freeze the constant currently points at — the flip must be
// a one-line change, not a change plus eleven test files.
vi.mock("../../src/db/site-mirror.js", () => ({
  makeSiteMirror: async () => ({
    health: async () => {},
    site: async () => {},
  }),
}));
vi.mock("../../src/reports/report-mirror.js", () => ({
  makeReportMirror: async () => ({
    create: async (rec: { id: string }) => ({ id: rec.id }),
    forSite: async () => [],
    body: async () => {},
    patch: async () => {},
  }),
}));
vi.mock("../../src/reports/draft.js", () => ({ draftReportForSite: vi.fn() }));
import { draftReportForSite } from "../../src/reports/draft.js";
import { draftDueReports, findExistingForPeriod } from "../../src/cli/commands/report.js";
import { makeFakeReportWriter } from "../reports/_helpers/fake-report-writer.js";
import { reportRowsFrom, type RawRow } from "../_helpers/raw-rows.js";
import type { WebsiteRow } from "../../src/fleet/site-row.js";

/** The fleet, as the batch reads it from Turso (#646 step 4). Set per case. */
let rosterRows: WebsiteRow[] = [];

/** `draftDueReports` deps for a case. The two reads come from Turso in
 *  production; here they are the case's own fixtures. */
function dueDeps(reports: RawRow[] = [], over: Record<string, unknown> = {}) {
  return {
    roster: async () => rosterRows,
    allReports: async () => reportRowsFrom(reports),
    reportMirror: makeFakeReportWriter(),
    redate: fakeRedate(),
    ...over,
  };
}

/** #2157's re-date IO, recorded in call order. `unapprove` answers `took`
 *  (false = a send or a withdraw won the race); `rerender` answers `status` and
 *  `stored` (false = an approve, send or withdraw landed while it rendered).
 *  `unapproveThrows` / `rerenderThrows` make that call throw the value given. */
function fakeRedate(
  opts: {
    took?: boolean;
    status?: string;
    stored?: boolean;
    unapproveThrows?: unknown;
    rerenderThrows?: unknown;
  } = {},
) {
  const calls: string[] = [];
  const unapproves: Array<{ id: string; by: string }> = [];
  return {
    calls,
    unapproves,
    unapprove: async (id: string, _at: Date, by: string) => {
      calls.push(`unapprove ${id}`);
      unapproves.push({ id, by });
      if (opts.unapproveThrows !== undefined) throw opts.unapproveThrows;
      return opts.took ?? true;
    },
    rerender: async (id: string, dueOn: string) => {
      calls.push(`rerender ${id} ${dueOn}`);
      if (opts.rerenderThrows !== undefined) throw opts.rerenderThrows;
      return { status: opts.status ?? "rendered", stored: opts.stored ?? true };
    },
  };
}

describe("runReportCommand", () => {
  it("throws a usage error when no slug, no --due, no --send-ready", async () => {
    await expect(runReportCommand(undefined, {})).rejects.toThrow(/Usage:/);
  });

  it("attaches exitCode=2 to the usage error", async () => {
    try {
      await runReportCommand(undefined, {});
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("requires TURSO_DATABASE_URL for --due", async () => {
    await expect(runReportCommand(undefined, { due: true })).rejects.toThrow(/TURSO_DATABASE_URL/);
  });

  it("requires TURSO_DATABASE_URL for <slug>", async () => {
    await expect(runReportCommand("some-site", {})).rejects.toThrow(/TURSO_DATABASE_URL/);
  });

  it("requires TURSO_DATABASE_URL for <slug> --preview (still reads the Turso roster)", async () => {
    await expect(runReportCommand("some-site", { preview: true })).rejects.toThrow(
      /TURSO_DATABASE_URL/,
    );
  });

  it("requires RESEND_API_KEY for --send-ready, before reading the queue", async () => {
    await expect(runReportCommand(undefined, { sendReady: true })).rejects.toThrow(
      /RESEND_API_KEY/,
    );
  });

  it("requires TURSO_DATABASE_URL for --send-ready (the queue is Turso's)", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_fake");
    try {
      await expect(runReportCommand(undefined, { sendReady: true })).rejects.toThrow(
        /TURSO_DATABASE_URL/,
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("validates --type BEFORE touching the store (a bad type fails fast, no creds needed)", async () => {
    // The single-site path parses --type before reading the roster, so this
    // rejects with the type error even though no credentials are set.
    const p = runReportCommand("some-site", { type: "Launch" });
    await expect(p).rejects.toThrow(/launch <site>/);
    await expect(p).rejects.not.toThrow(/TURSO_DATABASE_URL/);
  });
});

describe("parseSingleSiteReportType", () => {
  it("defaults to Maintenance when unset or blank", () => {
    expect(parseSingleSiteReportType(undefined)).toBe("Maintenance");
    expect(parseSingleSiteReportType("   ")).toBe("Maintenance");
  });

  it("accepts Maintenance and Testing, case-insensitively", () => {
    expect(parseSingleSiteReportType("Testing")).toBe("Testing");
    expect(parseSingleSiteReportType("testing")).toBe("Testing");
    expect(parseSingleSiteReportType("MAINTENANCE")).toBe("Maintenance");
  });

  it("rejects Launch/Announcement, pointing at their own commands (exitCode 2)", () => {
    expect(() => parseSingleSiteReportType("Launch")).toThrow(/launch <site>/);
    expect(() => parseSingleSiteReportType("Announcement")).toThrow(/announce <site>/);
    try {
      parseSingleSiteReportType("Launch");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });

  it("rejects an unknown type (exitCode 2)", () => {
    expect(() => parseSingleSiteReportType("bogus")).toThrow(/Maintenance or Testing/);
    try {
      parseSingleSiteReportType("bogus");
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as { exitCode?: number }).exitCode).toBe(2);
    }
  });
});

function siteRow(over = {}) {
  return {
    id: "rec_site_acme",
    name: "Acme Co",
    url: "https://acme.example.com",
    status: "maintained",
    pointOfContact: null,
    maintenanceFreq: "Monthly",
    testingFreq: "None",
    maintenanceDay: null,
    testingDay: null,
    ga4PropertyId: null,
    searchQuery: null,
    searchConsoleProperty: null,
    analyticsSoftFailAt: null,
    gitRepo: null,
    reportRecipientsTo: null,
    reportRecipientsCc: null,
    headerImage: null,
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    lastLighthouseAuditAt: null,
    a11yViolations: null,
    depsDrifted: null,
    depsMajorBehind: null,
    depsOutdated: null,
    securityVulnsCritical: null,
    securityVulnsHigh: null,
    securityVulnsModerate: null,
    securityVulnsLow: null,
    ...over,
  } as unknown as Parameters<typeof draftReportForSite>[0];
}

const TODAY = new Date("2026-05-26T12:00:00Z");

describe("draftDueReports period guard", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    rosterRows = [];
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
  });

  it("drafts a due (site, type) when no Reports row exists for its period", async () => {
    rosterRows = [siteRow()];
    // no prior reports → due now, period = 2026-05
    const res = await draftDueReports(TODAY, dueDeps());
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    // The guard's search key is passed down as the stamped Period (idempotency invariant).
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05" }),
    );
    expect(res.output).toMatch(/drafted/);
  });

  it("SKIPS a (site, type) already drafted-AND-READY for that period (idempotent re-run)", async () => {
    rosterRows = [siteRow()];
    // A READY row already exists for this site+type with Period = 2026-05 (the dueDate's
    // YYYY-MM when no prior Sent at → dueDate is today, 2026-05-26). Draft ready = true
    // means it's truly done → skip.
    const reports: RawRow[] = [
      {
        id: "rec_already",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-05",
          "Draft ready": true,
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/skipped|already drafted/i);
    // Cron contract: a skip is not an error; exit 0 so the scheduler doesn't page.
    expect(res.code).toBe(0);
  });

  it("drafts a new period when the prior period's draft was SENT (recurrence follows the due month)", async () => {
    // Semantic pin — this test documents INTENDED behaviour, not a regression fix.
    // A site with a prior SENT report (period 2026-04) is now due again at TODAY
    // (2026-05-26), period key 2026-05. A SENT earlier-period draft must NOT block the
    // new draft — the guard keys on YYYY-MM, and the pile-up guard (Fix #2) only blocks
    // when the prior draft is still UNSENT.
    rosterRows = [siteRow()];
    const reports: RawRow[] = [
      {
        id: "rec_prior_sent",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-04", // previous month, already sent — must not block 2026-05
          "Sent at": "2026-04-26T10:00:00.000Z",
        },
      },
    ];
    // TODAY = 2026-05-26, so dueDate = today, period = 2026-05
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05" }),
    );
    expect(res.code).toBe(0);
  });

  it("reads every report ONCE, from the injected store", async () => {
    rosterRows = [siteRow(), siteRow({ id: "rec_site_two", name: "Two Co" })];
    let reads = 0;
    await draftDueReports(
      TODAY,
      dueDeps([], {
        allReports: async () => {
          reads++;
          return [];
        },
      }),
    );
    expect(reads).toBe(1);
  });

  it("COMPLETES a half-made (not-ready) row for this period instead of skipping (Fix #1)", async () => {
    rosterRows = [siteRow()];
    // A row exists for THIS period (2026-05) but Draft ready is false — a crash
    // between createDraft and setDraftReady. It must be completed in place, not
    // skipped forever (skip → never sendable, since listSendable needs Draft ready).
    const reports: RawRow[] = [
      {
        id: "rec_halfmade",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-05",
          // no "Draft ready" → mapRow → draftReady false
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    // Completed via the completeRowId path against the EXISTING row id — no createDraft.
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05", completeRowId: "rec_halfmade" }),
    );
    expect(res.output).toMatch(/completed half-made draft/i);
    expect(res.code).toBe(0);
  });

  it("does NOT re-complete a not-ready row that was intentionally superseded by a higher-tier pending report", async () => {
    rosterRows = [siteRow()];
    // The not-ready Maintenance row looks like a crash, but it was deliberately un-queued by
    // queueDraft because a higher-tier Testing is still pending. Re-completing it would re-render
    // and APPEND a duplicate HTML attachment every run — so it must be skipped, not completed.
    const reports: RawRow[] = [
      {
        id: "rec_blocked_maint",
        fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-05" },
      },
      {
        id: "rec_pending_test",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Testing",
          Period: "2026-05",
          "Draft ready": true, // higher tier, pending approval
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).not.toHaveBeenCalled(); // not re-completed → no re-render/append
    expect(res.output).toMatch(/superseded — a higher-or-equal-tier report is pending/i);
    expect(res.code).toBe(0);
  });

  it("surfaces a created-but-NOT-queued draft (blocked by the single-queue rule)", async () => {
    rosterRows = [siteRow()];
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: false,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
    const res = await draftDueReports(TODAY, dueDeps());
    expect(res.output).toMatch(/NOT queued/);
    expect(res.code).toBe(0);
  });

  it("surfaces superseded lower-tier drafts in the summary (with plural)", async () => {
    rosterRows = [siteRow()];
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Testing — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: ["a", "b"],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
    const res = await draftDueReports(TODAY, dueDeps());
    expect(res.output).toMatch(/superseded 2 lower-tier drafts/);
    expect(res.code).toBe(0);
  });

  it("does NOT create a NEW-period draft while an EARLIER-period draft is unsent (pile-up guard, Fix #2)", async () => {
    rosterRows = [siteRow()];
    // Site is due now (2026-05) but already has an UNSENT 2026-04 draft pending
    // approval. Don't accrue another — skip the new-period draft.
    const reports: RawRow[] = [
      {
        id: "rec_pending",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-04",
          "Draft ready": true, // ready but never approved/sent (sentAt null)
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/already has an unsent 2026-04 draft pending approval/i);
    expect(res.code).toBe(0);
  });

  it("DOES create the new-period draft once the earlier pending draft has been sent (Fix #2 boundary)", async () => {
    rosterRows = [siteRow()];
    const reports: RawRow[] = [
      {
        id: "rec_prior",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-04",
          "Draft ready": true,
          "Sent at": "2026-04-26T10:00:00.000Z", // sent → no longer pending
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05" }),
    );
    expect(res.code).toBe(0);
  });

  it("DOES create the new-period draft when the earlier-period draft was SUPERSEDED, not pending (HIGH-2 regression)", async () => {
    rosterRows = [siteRow()];
    // A 2026-04 Maintenance row that a higher-tier Testing report once superseded:
    // queueDraft set Draft ready = false and it never got a Sent at. It is NOT pending
    // approval, so it must NOT block the new 2026-05 Maintenance draft. Before the fix,
    // the pile-up guard matched ANY unsent earlier-period row (sentAt null + period <
    // current) and wedged the site's Maintenance reports forever (Reddoor's live failure).
    const reports: RawRow[] = [
      {
        id: "rec_superseded",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-04",
          // no "Draft ready" → draftReady false (superseded); no "Sent at" → sentAt null
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05" }),
    );
    expect(res.code).toBe(0);
  });
});

describe("draftDueReports next-due write-back", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    rosterRows = [];
  });

  it("writes each site's code-computed next-due dates through the schedule mirror, even on a run where nothing is due", async () => {
    // Quarterly maintenance anchored Jun 30 → next due Sep 30 (FUTURE vs TODAY, so nothing
    // drafts), Testing None → no schedule. The write-back must still fire before the
    // "No reports due" early return, and draftDueReports must forward its
    // scheduleMirror to writeNextDueDates — the pass-through is load-bearing.
    rosterRows = [
      siteRow({
        id: "rec_a",
        maintenanceFreq: "Quarterly",
        maintenanceDay: "2026-06-30",
        testingFreq: "None",
      }),
    ];
    const mirrored: Array<{
      siteId: string;
      fields: Record<string, unknown>;
      computedAt: string;
    }> = [];
    const res = await draftDueReports(
      TODAY,
      dueDeps([], {
        scheduleMirror: async (
          siteId: string,
          fields: Record<string, unknown>,
          computedAt: string,
        ) => {
          mirrored.push({ siteId, fields, computedAt });
          return true;
        },
      }),
    );
    expect(res.output).toBe("No reports due.");
    expect(mirrored).toEqual([
      {
        siteId: "rec_a",
        fields: { "Next maintenance at": "2026-09-30", "Next testing at": null },
        computedAt: TODAY.toISOString(),
      },
    ]);
  });

  it("forwards the draft mirror into every draftReportForSite call (#539 Phase 5)", async () => {
    // The create-side twin of the schedule-mirror pass-through above, and it
    // fails the same way if dropped: the nightly batch is the ONLY caller that
    // creates report rows unattended, so a lost pass-through means every
    // drafted row is written nowhere.
    rosterRows = [siteRow()]; // Monthly, no anchor → due now
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
    const reportMirror = makeFakeReportWriter();

    await draftDueReports(TODAY, dueDeps([], { reportMirror }));

    const calls = vi.mocked(draftReportForSite).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call[2]?.reportMirror).toBe(reportMirror);
  });

  it("swallows a per-site write-back failure and still drafts the due report", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    rosterRows = [siteRow()]; // Monthly, no anchor → due now
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);

    const res = await draftDueReports(
      TODAY,
      dueDeps([], {
        scheduleMirror: async () => {
          throw new Error("turso down");
        },
      }),
    );
    // The write-back threw but was isolated per-site: the due report still drafted.
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(res.output).toMatch(/drafted/);
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/\[schedule-mirror\] Acme Co: turso down/),
    );
    warn.mockRestore();
  });
});

describe("draftDueReports — a withdrawn draft (P1-28)", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    rosterRows = [siteRow()];
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
  });

  const WITHDRAWN = { "Withdrawn at": "2026-05-02T10:00:00.000Z", "Withdrawn by": "dashboard" };

  it("an earlier-period withdrawn draft does NOT block the new period", async () => {
    const reports: RawRow[] = [
      {
        id: "rec_skipped_april",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-04",
          "Completed on": "2026-04-20",
          "Draft ready": true,
          ...WITHDRAWN,
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ period: "2026-05" }),
    );
    expect(res.output).not.toMatch(/pending approval/);
  });

  it.each([true, false])(
    "a same-period withdrawn row (Draft ready %s) consumes the cycle: never re-completed, next period drafts",
    async (ready) => {
      const reports: RawRow[] = [
        {
          id: "rec_withdrawn_may",
          fields: {
            Site: ["rec_site_acme"],
            "Report type": "Maintenance",
            Period: "2026-05",
            "Completed on": "2026-05-02",
            ...(ready ? { "Draft ready": true } : {}),
            ...WITHDRAWN,
          },
        },
      ];
      // P1-117: the next period is due 06-02 and drafts from 05-26 (7 days before),
      // so the "nothing yet" check runs on 05-25.
      const res = await draftDueReports(new Date("2026-05-25T12:00:00Z"), dueDeps(reports));
      expect(draftReportForSite).not.toHaveBeenCalled();
      expect(res.output).toBe("No reports due.");
      await draftDueReports(new Date("2026-06-26T12:00:00Z"), dueDeps(reports));
      expect(draftReportForSite).toHaveBeenCalledTimes(1);
      expect(draftReportForSite).toHaveBeenCalledWith(
        expect.anything(),
        "Maintenance",
        expect.not.objectContaining({ completeRowId: expect.anything() }),
      );
      expect(draftReportForSite).toHaveBeenCalledWith(
        expect.anything(),
        "Maintenance",
        expect.objectContaining({ period: "2026-06" }),
      );
    },
  );

  it("a withdrawn higher-tier draft does not hold a crashed half-draft un-completed", async () => {
    const reports: RawRow[] = [
      {
        id: "rec_halfmade",
        fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-05" },
      },
      {
        id: "rec_withdrawn_test",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Testing",
          Period: "2026-05",
          "Draft ready": true,
          ...WITHDRAWN,
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports));
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({ completeRowId: "rec_halfmade" }),
    );
    expect(res.output).not.toMatch(/superseded — a higher-or-equal-tier/);
  });
});

describe("findExistingForPeriod (P1-28)", () => {
  const rows = (records: RawRow[]) => reportRowsFrom(records);
  const row = (id: string, over: Record<string, unknown> = {}): RawRow => ({
    id,
    fields: { Site: ["s"], "Report type": "Maintenance", Period: "2026-05", ...over },
  });

  it("prefers the live row over a withdrawn one for the same period, in either order", () => {
    const w = row("w", { "Withdrawn at": "2026-05-02T00:00:00.000Z" });
    const live = row("live");
    expect(findExistingForPeriod(rows([w, live]), "s", "Maintenance", "2026-05")?.id).toBe("live");
    expect(findExistingForPeriod(rows([live, w]), "s", "Maintenance", "2026-05")?.id).toBe("live");
  });

  it("falls back to the withdrawn row when it is the only one, and matches on site, type and period", () => {
    const w = row("w", { "Withdrawn at": "2026-05-02T00:00:00.000Z" });
    expect(findExistingForPeriod(rows([w]), "s", "Maintenance", "2026-05")?.id).toBe("w");
    expect(findExistingForPeriod(rows([w]), "x", "Maintenance", "2026-05")).toBeUndefined();
    expect(findExistingForPeriod(rows([w]), "s", "Testing", "2026-05")).toBeUndefined();
    expect(findExistingForPeriod(rows([w]), "s", "Maintenance", "2026-06")).toBeUndefined();
  });
});

describe("draftDueReports — P1-117 early drafts", () => {
  beforeEach(() => {
    vi.mocked(draftReportForSite).mockReset();
    rosterRows = [];
    vi.mocked(draftReportForSite).mockResolvedValue({
      reportRow: { reportId: "Acme Co — Maintenance — 2026-05-26" },
      htmlPath: null,
      html: "",
      softFailures: [],
      queued: true,
      supersededIds: [],
    } as unknown as Awaited<ReturnType<typeof draftReportForSite>>);
  });

  it("drafts a report due in 7 days tonight, with its due month as the period and its due date stored", async () => {
    rosterRows = [siteRow({ maintenanceDay: "2026-05-02" })];
    await draftDueReports(TODAY, dueDeps());
    expect(draftReportForSite).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(draftReportForSite).mock.calls[0]![2]!;
    expect(opts.period).toBe("2026-06");
    expect(opts.dueOn?.toISOString().slice(0, 10)).toBe("2026-06-02");
  });

  it("re-completing a half-made row stores its due date (a row made before it was known)", async () => {
    rosterRows = [siteRow({ maintenanceDay: "2026-05-02" })];
    const reportMirror = makeFakeReportWriter();
    const reports: RawRow[] = [
      {
        id: "rec_halfmade",
        fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-06" },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports, { reportMirror }));
    expect(reportMirror.patches).toContainEqual({
      id: "rec_halfmade",
      patch: { due_on: "2026-06-02" },
    });
    // The row handed to the completing render already carries the date, so the
    // body it stores is dated as the send will date it.
    expect(draftReportForSite).toHaveBeenCalledWith(
      expect.anything(),
      "Maintenance",
      expect.objectContaining({
        completeRowId: "rec_halfmade",
        existingRow: expect.objectContaining({ dueOn: "2026-06-02" }),
      }),
    );
    expect(res.output).toContain("• due date (none) → 2026-06-02: Acme Co Maintenance");
  });

  // #2157 (the operator, 2026-11-21: "Re-draft on new date"). An anchor edit
  // after the early draft exists moves the held row's cycle inside its period;
  // the row loses its approval and is re-rendered on the send's path with the
  // new date, which is stored with the body in one write. TODAY is 05-26
  // (Pacific 05-26), so a row due 06-01 is held.
  const readyRow = (over: Record<string, unknown> = {}): RawRow => ({
    id: "rec_drafted",
    fields: {
      Site: ["rec_site_acme"],
      "Report type": "Maintenance",
      Period: "2026-06",
      "Draft ready": true,
      "Approved to send": true,
      "Approved At": "2026-05-25T18:00:00Z",
      "Due on": "2026-06-01",
      ...over,
    },
  });
  const unapproved = { "Approved to send": false, "Approved At": undefined };
  const redateRun = async (
    site: Record<string, unknown>,
    rows: RawRow[],
    redate = fakeRedate(),
  ) => {
    rosterRows = [siteRow(site)];
    const w = makeFakeReportWriter();
    const res = await draftDueReports(TODAY, dueDeps(rows, { reportMirror: w, redate }));
    return { res, calls: redate.calls, unapproves: redate.unapproves, patches: w.patches };
  };
  const MOVED = "due date 2026-06-01 → 2026-06-02: Acme Co Maintenance";

  it("re-dates an approved held row on the cycle's new date: approval back, then re-rendered and stored with the date", async () => {
    // The cycle now says 06-02; the ready, approved row was drafted for 06-01.
    const { res, calls, unapproves, patches } = await redateRun({ maintenanceDay: "2026-05-02" }, [
      readyRow(),
    ]);
    expect(calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-02"]);
    expect(unapproves).toEqual([
      { id: "rec_drafted", by: "nightly: due date moved 2026-06-01 → 2026-06-02" },
    ]);
    expect(patches).toEqual([]);
    // Re-rendered from the row, not completed as a new draft.
    expect(draftReportForSite).not.toHaveBeenCalled();
    const line = `• ${MOVED} — approval taken back, preview re-rendered; approve again`;
    expect(res.output).toContain(line);
    // The pass runs after the draft loop, so its line follows the loop's.
    const out = res.output.split("\n");
    expect(out.indexOf(line)).toBeGreaterThan(
      out.findIndex((l) => l.includes("skipped (already drafted 2026-06)")),
    );
    expect(res.code).toBe(0);
  });

  it("says when a send-anyway override goes with the approval", async () => {
    const { res } = await redateRun({ maintenanceDay: "2026-05-02" }, [
      readyRow({ "Send override": true }),
    ]);
    expect(res.output).toContain(
      "— approval and send-anyway override taken back, preview re-rendered; approve again",
    );
  });

  it("re-dates a held row that was never approved without an unapprove", async () => {
    const { res, calls } = await redateRun({ maintenanceDay: "2026-05-02" }, [
      readyRow(unapproved),
    ]);
    expect(calls).toEqual(["rerender rec_drafted 2026-06-02"]);
    expect(res.output).toContain(`• ${MOVED} — preview re-rendered`);
    expect(res.code).toBe(0);
  });

  it("re-dates a held Testing row on its own cycle", async () => {
    // Quarterly Testing anchored 03-03 → due 06-03; drafted for 06-01.
    const { res, calls } = await redateRun(
      { maintenanceFreq: "None", testingFreq: "Quarterly", testingDay: "2026-03-03" },
      [readyRow({ "Report type": "Testing" })],
    );
    expect(calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-03"]);
    expect(res.output).toContain(
      "• due date 2026-06-01 → 2026-06-03: Acme Co Testing — approval taken back, preview re-rendered; approve again",
    );
  });

  it("catches a move weeks out, past the 7-day draft window", async () => {
    // Anchor 05-20 → due 06-20, same period, nothing due tonight.
    const { res, calls } = await redateRun({ maintenanceDay: "2026-05-20" }, [readyRow()]);
    expect(calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-20"]);
    expect(res.output).toBe(
      "• due date 2026-06-01 → 2026-06-20: Acme Co Maintenance — approval taken back, preview re-rendered; approve again\nNo reports due.",
    );
  });

  it("never chases a site with no anchor and no send, whose cycle says 'due today' every day", async () => {
    const { res, calls } = await redateRun({ maintenanceDay: null }, [
      readyRow({ Period: "2026-05", "Due on": "2026-05-27" }),
    ]);
    expect(calls).toEqual([]);
    expect(res.output).not.toContain("due date 2026-05-27");
  });

  it("leaves a row whose due day has come: it sends on this cycle", async () => {
    // Due 05-26 (today, Pacific); the anchor now says 05-28, same period.
    const { calls } = await redateRun({ maintenanceDay: "2026-04-28" }, [
      readyRow({ Period: "2026-05", "Due on": "2026-05-26" }),
    ]);
    expect(calls).toEqual([]);
  });

  it("leaves a move into another period alone (not covered by #2157)", async () => {
    // Anchor 06-05 → due 07-05, period 2026-07.
    const { calls } = await redateRun({ maintenanceDay: "2026-06-05" }, [readyRow()]);
    expect(calls).toEqual([]);
  });

  it("leaves a withdrawn ready row, and one with no period, alone", async () => {
    for (const over of [{ "Withdrawn at": "2026-05-25T20:00:00Z" }, { Period: undefined }]) {
      const { calls } = await redateRun({ maintenanceDay: "2026-05-02" }, [readyRow(over)]);
      expect(calls).toEqual([]);
    }
  });

  it("leaves the row alone when a send or a withdraw wins the unapprove race", async () => {
    const { res, calls } = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow()],
      fakeRedate({ took: false }),
    );
    expect(calls).toEqual(["unapprove rec_drafted"]);
    expect(res.output).toContain(
      `⚠ ${MOVED} — not re-dated: its approval could not be taken back (it is sent, being sent, withdrawn or no longer approved)`,
    );
    expect(res.code).toBe(0);
  });

  it("keeps an approval given while the body rendered on the date and body it was given for", async () => {
    // The approval came back, the operator approved again mid-render, and the
    // conditioned write matched nothing.
    const { res, calls } = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow()],
      fakeRedate({ stored: false }),
    );
    expect(calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-02"]);
    expect(res.output).toContain(
      `⚠ ${MOVED} — approval taken back, but not re-dated: it was approved, sent, withdrawn or superseded while this run worked`,
    );
    expect(res.output).not.toContain("approve again");
    expect(res.code).toBe(0);
  });

  it("says a row sent while it rendered was not re-dated", async () => {
    const { res } = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow(unapproved)],
      fakeRedate({ status: "already-sent" }),
    );
    expect(res.output).toContain(`⚠ ${MOVED} — not re-dated: it was sent while this run worked`);
    expect(res.code).toBe(0);
  });

  it("a failed render changes neither date nor body, and says it is retried only while held", async () => {
    const { res, calls } = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow()],
      fakeRedate({ status: "no-header" }),
    );
    expect(calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-02"]);
    expect(res.output).toContain(
      `✗ ${MOVED} — approval taken back, but preview not re-rendered (no-header); its date and preview are unchanged; the next nightly tries again only while it is still held (before 2026-06-01)`,
    );
    expect(res.code).toBe(1);
  });

  it("names a thrown value with no message", async () => {
    const { res } = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow()],
      fakeRedate({ rerenderThrows: "libsql: database is locked" }),
    );
    expect(res.output).toContain(
      `✗ ${MOVED} — approval taken back, but preview not re-rendered (libsql: database is locked); its date and preview are unchanged`,
    );
    const r2 = await redateRun(
      { maintenanceDay: "2026-05-02" },
      [readyRow()],
      fakeRedate({ unapproveThrows: "socket hang up" }),
    );
    expect(r2.res.output).toContain(`✗ ${MOVED} — approval not taken back: socket hang up`);
    expect(r2.res.code).toBe(1);
  });

  it("plans every move from the rows as read: the result is the same in either row order", async () => {
    // Maintenance monthly, anchored 05-01 (due 06-01); Quarterly Testing
    // anchored 03-03 (due 06-03). The held, approved Testing row on 06-01 covers
    // Maintenance (pushing it to 07-01, another period), so the held Maintenance
    // row on 06-05 has no move. Taking the Testing approval back must not lift
    // that cover inside this run, in either order.
    const site = {
      maintenanceDay: "2026-05-01",
      testingFreq: "Quarterly",
      testingDay: "2026-03-03",
    };
    const testing = readyRow({ "Report type": "Testing" });
    const maint: RawRow = {
      id: "rec_maint",
      fields: { ...readyRow(unapproved).fields, "Due on": "2026-06-05" },
    };
    const a = await redateRun(site, [testing, maint]);
    vi.mocked(draftReportForSite).mockClear();
    const b = await redateRun(site, [maint, testing]);
    for (const run of [a, b]) {
      expect(run.calls).toEqual(["unapprove rec_drafted", "rerender rec_drafted 2026-06-03"]);
    }
    // And the draft loop drafted no Maintenance report beside them.
    expect(draftReportForSite).not.toHaveBeenCalled();
  });

  it("leaves a ready row drafted before P1-117 (no due date) as it is", async () => {
    rosterRows = [siteRow({ maintenanceDay: "2026-05-02" })];
    const w = makeFakeReportWriter();
    const legacy: RawRow = {
      id: "rec_legacy",
      fields: {
        Site: ["rec_site_acme"],
        "Report type": "Maintenance",
        Period: "2026-06",
        "Draft ready": true,
      },
    };
    await draftDueReports(TODAY, dueDeps([legacy], { reportMirror: w }));
    expect(w.patches).toEqual([]);
  });

  it("a rejected due-date patch skips the row's completion that night and fails the run (#2154)", async () => {
    rosterRows = [siteRow({ maintenanceDay: "2026-05-02" })];
    const reportMirror = makeFakeReportWriter();
    reportMirror.patch = async () => {
      throw new Error("libsql: database is locked");
    };
    const reports: RawRow[] = [
      {
        id: "rec_halfmade",
        fields: { Site: ["rec_site_acme"], "Report type": "Maintenance", Period: "2026-06" },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports, { reportMirror }));
    // Completing it would send it on its stale date, here none, so on approval
    // and up to 7 days early, instead of on the cycle's 06-02.
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toContain(
      "✗ due date not updated: Acme Co Maintenance — libsql: database is locked",
    );
    expect(res.code).toBe(1);
  });

  it("stamps a superseded row's stale due date and still skips it (#2158)", async () => {
    // The cycle says 06-02; the Maintenance row a pending Testing un-queued was
    // made for 06-01. It takes the cycle's date now, so when the blocker clears
    // it is completed and held on 06-02, not 06-01.
    rosterRows = [siteRow({ maintenanceDay: "2026-05-02" })];
    const reportMirror = makeFakeReportWriter();
    const reports: RawRow[] = [
      {
        id: "rec_blocked_maint",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Maintenance",
          Period: "2026-06",
          "Due on": "2026-06-01",
        },
      },
      {
        id: "rec_pending_test",
        fields: {
          Site: ["rec_site_acme"],
          "Report type": "Testing",
          Period: "2026-06",
          "Draft ready": true,
        },
      },
    ];
    const res = await draftDueReports(TODAY, dueDeps(reports, { reportMirror }));
    expect(reportMirror.patches).toContainEqual({
      id: "rec_blocked_maint",
      patch: { due_on: "2026-06-02" },
    });
    expect(res.output).toContain("• due date 2026-06-01 → 2026-06-02: Acme Co Maintenance");
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toMatch(/superseded — a higher-or-equal-tier report is pending/i);
    expect(res.code).toBe(0);
  });

  it("does not draft a report due in 8 days", async () => {
    rosterRows = [siteRow({ maintenanceDay: "2026-05-03" })];
    const res = await draftDueReports(TODAY, dueDeps());
    expect(draftReportForSite).not.toHaveBeenCalled();
    expect(res.output).toBe("No reports due.");
  });
});
