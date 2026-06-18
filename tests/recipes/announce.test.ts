import { describe, it, expect, beforeEach, vi } from "vitest";
import { announce } from "../../src/recipes/announce.js";
import { makeFakeBase } from "../reports/_helpers/fake-airtable-base.js";

// GA + Search enrichment is the report pipeline's soft-failing wrappers. Mock them so the
// recipe never hits Google in tests; the default is "not configured" (null) so existing
// tests behave exactly as before, and the enrichment test overrides with real data.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";

// uploadAttachment (src/reports/airtable/attachments.ts) POSTs to content.airtable.com
// via global fetch. Stub fetch so the preview upload "succeeds" without a network call;
// AIRTABLE_PAT/BASE_ID are also required by uploadAttachment before it fetches.
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: async () => "",
  }) as unknown as typeof global.fetch;
  process.env.AIRTABLE_PAT = "pat_test";
  process.env.AIRTABLE_BASE_ID = "app_test";
  // Default: enrichment not configured → null (no GA/search written), matching the live
  // soft-skip when GA_SUBJECT / a property ID is unset.
  vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: false });
  vi.mocked(fetchSearch).mockResolvedValue({ value: null, softFailed: false });
});

/** A Websites-row field record carrying the four stored Lighthouse scores. */
function scoredFields(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    pScore: 87,
    rScore: 91,
    bpScore: 100,
    seoScore: 95,
    ...over,
  };
}

const NOW = new Date("2026-06-17T12:00:00.000Z");
const PERIOD = "2026-06";

describe("recipes/announce", () => {
  it("processes only maintenance sites (skips launch-period and hosting)", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_maint",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
        {
          id: "rec_launch",
          fields: {
            Name: "Beta Co",
            url: "https://beta.example.com",
            Status: "launch period",
            ...scoredFields(),
          },
        },
        {
          id: "rec_hosting",
          fields: {
            Name: "Gamma Co",
            url: "https://gamma.example.com",
            Status: "hosting",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    const result = await announce({ base, now: NOW });

    expect(result.results.map((r) => r.site)).toEqual(["Acme Co"]);
  });

  it("filters to a single site by slug when deps.site is set", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scoredFields(),
          },
        },
        {
          id: "rec_delta",
          fields: {
            Name: "Delta Co",
            url: "https://delta.example.com",
            Status: "maintenance",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    const result = await announce({ base, site: "Delta Co", now: NOW });

    expect(result.results.map((r) => r.site)).toEqual(["Delta Co"]);
  });

  it("skips a maintenance site missing any of the four scores (no create)", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_no_scores",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            // seoScore intentionally omitted → null → skip
            pScore: 87,
            rScore: 91,
            bpScore: 100,
          },
        },
      ],
      Reports: [],
    });

    const result = await announce({ base, now: NOW });

    expect(result.results).toEqual([{ site: "Acme Co", status: "skipped-no-scores" }]);
    const reportCreates = base.__calls.filter((c) => c.kind === "create" && c.table === "Reports");
    expect(reportCreates).toHaveLength(0);
  });

  it("drafts an Announcement report with a Subject override and flips Draft ready", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    const result = await announce({ base, now: NOW });

    expect(result.results).toEqual([
      { site: "Acme Co", status: "drafted", reportId: expect.any(String), recipientMissing: false },
    ]);

    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Reports");
    if (!create || create.kind !== "create") throw new Error("expected a Reports create");
    const fields = create.records[0]!.fields;
    expect(fields["Report type"]).toBe("Announcement");
    expect(typeof fields["Subject override"]).toBe("string");
    expect((fields["Subject override"] as string).length).toBeGreaterThan(0);
    expect(fields["Lighthouse — Performance"]).toBe(87);
    expect(fields["Period"]).toBe(PERIOD);

    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("reports recipientMissing=true when the row has no Report recipients (To)", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    const result = await announce({ base, now: NOW });

    expect(result.results[0]).toMatchObject({
      site: "Acme Co",
      status: "drafted",
      recipientMissing: true,
    });
  });

  it("reuses a pre-existing Announcement row for (site, period) without a second create", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [
        {
          id: "rec_existing_announce",
          fields: {
            "Report ID": "Acme Co — Announcement — existing",
            Site: ["rec_acme"],
            "Report type": "Announcement",
            Period: PERIOD,
          },
        },
      ],
    });

    const result = await announce({ base, now: NOW });

    expect(result.results[0]).toMatchObject({
      site: "Acme Co",
      status: "reused",
      reportId: "rec_existing_announce",
    });
    const reportCreates = base.__calls.filter((c) => c.kind === "create" && c.table === "Reports");
    expect(reportCreates).toHaveLength(0);

    // The reused row's scores are refreshed and it is made Draft-ready.
    const scoreUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_announce" &&
        c.records[0]!.fields["Lighthouse — Performance"] === 87,
    );
    expect(scoreUpdate).toBeDefined();
    const draftReadyUpdate = base.__calls.find(
      (c) =>
        c.kind === "update" &&
        c.table === "Reports" &&
        c.records[0]!.id === "rec_existing_announce" &&
        c.records[0]!.fields["Draft ready"] === true,
    );
    expect(draftReadyUpdate).toBeDefined();
  });

  it("stores GA visitors + search presence on the drafted row when enrichment returns data", async () => {
    vi.mocked(fetchGaUsers).mockResolvedValue({
      value: { current: 280, previous: 275 },
      softFailed: false,
    });
    vi.mocked(fetchSearch).mockResolvedValue({
      value: { foundOnPage1: true, position: 3 },
      softFailed: false,
    });
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintenance",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    await announce({ base, now: NOW });

    const create = base.__calls.find((c) => c.kind === "create" && c.table === "Reports");
    if (!create || create.kind !== "create") throw new Error("expected a Reports create");
    const fields = create.records[0]!.fields;
    expect(fields["GA users (period)"]).toBe(280);
    expect(fields["GA users (prev period)"]).toBe(275);
    expect(fields["Search found page 1"]).toBe(true);
    expect(fields["Search position"]).toBe(3);
  });

  it("one site that throws does not abort the run — other sites still draft", async () => {
    const base = makeFakeBase({
      Websites: [
        {
          id: "rec_bad",
          fields: {
            Name: "Bad Co",
            url: "https://bad.example.com",
            Status: "maintenance",
            ...scoredFields(),
          },
        },
        {
          id: "rec_good",
          fields: {
            Name: "Good Co",
            url: "https://good.example.com",
            Status: "maintenance",
            "Report recipients (To)": "client@good.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    });

    // Force the FIRST site's createDraft to throw by making the create call fail
    // only when the payload is for "Bad Co". The good site must still draft.
    const realTableFn = base as unknown as (table: string) => {
      select: (opts?: Record<string, unknown>) => unknown;
      create: (recs: Array<{ fields: Record<string, unknown> }>) => Promise<unknown>;
      update: (recs: Array<{ id: string; fields: Record<string, unknown> }>) => Promise<unknown>;
    };
    const baseAsFn = realTableFn;
    const wrapped = ((table: string) => {
      const t = baseAsFn(table);
      if (table !== "Reports") return t;
      return {
        ...t,
        create: async (recs: Array<{ fields: Record<string, unknown> }>) => {
          const reportId = String(recs[0]?.fields["Report ID"] ?? "");
          if (reportId.startsWith("Bad Co")) throw new Error("boom on Bad Co");
          return t.create(recs);
        },
      };
    }) as unknown as typeof base;
    // Preserve the call-capture handles the fake exposes.
    (wrapped as unknown as { __calls: unknown }).__calls = base.__calls;
    (wrapped as unknown as { __records: unknown }).__records = base.__records;

    const result = await announce({ base: wrapped, now: NOW });

    const byName = new Map(result.results.map((r) => [r.site, r]));
    expect(byName.get("Bad Co")?.status).toBe("error");
    expect(byName.get("Good Co")?.status).toBe("drafted");
  });
});
