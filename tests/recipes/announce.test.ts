import { describe, it, expect, beforeEach, vi } from "vitest";
import { announce } from "../../src/recipes/announce.js";
import {
  makeFakeReportWriter,
  type FakeReportWriter,
} from "../reports/_helpers/fake-report-writer.js";
import { reportRowsFrom, websiteRowsFrom, type RawRow } from "../_helpers/raw-rows.js";

// GA + Search enrichment is the report pipeline's soft-failing wrappers. Mock them so the
// recipe never hits Google in tests; the default is "not configured" (null) so existing
// tests behave exactly as before, and the enrichment test overrides with real data.
vi.mock("../../src/reports/draft.js", async (orig) => ({
  ...(await orig<typeof import("../../src/reports/draft.js")>()),
  fetchGaUsers: vi.fn(),
  fetchSearch: vi.fn(),
}));
import { fetchGaUsers, fetchSearch } from "../../src/reports/draft.js";

beforeEach(() => {
  // readGaConfig() reads GA_SUBJECT; keep it unset by default so the analytics-health
  // write is skipped (matches the live "GA unconfigured" path). Tests that exercise the
  // health write set it explicitly.
  delete process.env.GA_SUBJECT;
  // Default: enrichment not configured → null (no GA/search written), matching the live
  // soft-skip when GA_SUBJECT / a property ID is unset.
  vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: false });
  vi.mocked(fetchSearch).mockResolvedValue({
    value: null,
    softFailed: false,
    defaultQueryMissed: false,
    propertyMissing: false,
    notConfigured: false,
  });
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

type Seed = { Websites: RawRow[]; Reports: RawRow[] };

/** The Turso report writer the recipe writes through (#646 step 4), exposed so a
 *  case can read what was written. Built by `A(seed, …)`. */
let writer: FakeReportWriter;

/** Every `siteMirror.health` write the default site mirror recorded. */
let siteHealth: Array<{ id: string; fields: Record<string, unknown> }>;

/** `announce` deps for a case: the Turso roster, report writer and site mirror. */
function A(seed: Seed, over: Record<string, unknown> = {}) {
  writer = makeFakeReportWriter(reportRowsFrom(seed.Reports));
  siteHealth = [];
  return {
    roster: async () => websiteRowsFrom(seed.Websites),
    reportMirror: writer,
    siteMirror: {
      health: async (id: string, fields: Record<string, unknown>) => {
        siteHealth.push({ id, fields });
      },
      site: async () => {},
    },
    now: NOW,
    refreshHeader: false as const,
    ...over,
  };
}

const NOW = new Date("2026-06-17T12:00:00.000Z");
const PERIOD = "2026-06";

/** The fields of the `Analytics soft-fail at` write to the site row, or undefined
 *  if announce never wrote it (GA unconfigured / no property). */
function analyticsHealthWrite(): Record<string, unknown> | undefined {
  return siteHealth.find((h) => "Analytics soft-fail at" in h.fields)?.fields;
}

describe("recipes/announce", () => {
  it("processes only maintained sites (skips launching and hosted-only)", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_maint",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
        {
          id: "rec_launch",
          fields: {
            Name: "Beta Co",
            url: "https://beta.example.com",
            Status: "launching",
            ...scoredFields(),
          },
        },
        {
          id: "rec_hosting",
          fields: {
            Name: "Gamma Co",
            url: "https://gamma.example.com",
            Status: "hosted-only",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    const result = await announce(A(seed));

    expect(result.results.map((r) => r.site)).toEqual(["Acme Co"]);
  });

  it("hands the created row to deps.reportMirror (#539 Phase 5 create-side dual-write)", async () => {
    // announce is the second unattended creator of Reports rows. Without this
    // pass-through an announcement draft is invisible to the Turso-backed
    // console until the next hourly sync — the same defect Phase 4 closed for
    // every OTHER field on the page.
    const seed: Seed = {
      Websites: [
        {
          id: "rec_maint",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };
    await announce(A(seed));

    expect(writer.inserts).toHaveLength(1);
    expect(writer.inserts[0]!.id).toMatch(/^report_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(writer.inserts[0]!.fields["Report type"]).toBe("Announcement");
  });

  it("filters to a single site by slug when deps.site is set", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            ...scoredFields(),
          },
        },
        {
          id: "rec_delta",
          fields: {
            Name: "Delta Co",
            url: "https://delta.example.com",
            Status: "maintained",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    const result = await announce(A(seed, { site: "Delta Co" }));

    expect(result.results.map((r) => r.site)).toEqual(["Delta Co"]);
  });

  it("skips a maintained site missing any of the four scores (no create)", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_no_scores",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            // seoScore intentionally omitted → null → skip
            pScore: 87,
            rScore: 91,
            bpScore: 100,
          },
        },
      ],
      Reports: [],
    };

    const result = await announce(A(seed));

    expect(result.results).toEqual([{ site: "Acme Co", status: "skipped-no-scores" }]);
    expect(writer.inserts).toHaveLength(0);
  });

  it("drafts an Announcement report with a Subject override and flips Draft ready", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    const result = await announce(A(seed));

    expect(result.results).toEqual([
      {
        site: "Acme Co",
        status: "drafted",
        reportId: expect.any(String),
        recipientMissing: false,
        queued: true,
      },
    ]);

    // Written to TURSO since #646 step 4 — same field vocabulary, different store.
    expect(writer.inserts).toHaveLength(1);
    const fields = writer.inserts[0]!.fields;
    expect(fields["Report type"]).toBe("Announcement");
    // Subject: "report" (not "schedule"), and the full site name with its bare domain.
    expect(fields["Subject override"]).toBe(
      "Your testing & maintenance report for Acme Co (acme.example.com)",
    );
    expect(fields["Lighthouse — Performance"]).toBe(87);
    expect(fields["Period"]).toBe(PERIOD);

    expect(writer.patches).toEqual([{ id: writer.inserts[0]!.id, patch: { draft_ready: 1 } }]);
  });

  it("reports recipientMissing=true when the row has no Report recipients (To)", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    const result = await announce(A(seed));

    expect(result.results[0]).toMatchObject({
      site: "Acme Co",
      status: "drafted",
      recipientMissing: true,
    });
  });

  it("reuses a pre-existing Announcement row for (site, period) without a second create", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
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
    };

    const result = await announce(A(seed));

    expect(result.results[0]).toMatchObject({
      site: "Acme Co",
      status: "reused",
      reportId: "rec_existing_announce",
    });
    expect(writer.inserts).toHaveLength(0);

    // The reused row's scores are refreshed and it is made Draft-ready.
    const scoreUpdate = writer.patches.find(
      (p) => p.id === "rec_existing_announce" && p.patch.lighthouse_performance === 87,
    );
    expect(scoreUpdate).toBeDefined();
    expect(writer.patches).toContainEqual({
      id: "rec_existing_announce",
      patch: { draft_ready: 1 },
    });
  });

  it("mirrors the reused row's refreshed scores (#539 Phase 5)", async () => {
    // The reuse path exists so the eventually-sent email is not stale. The
    // console reads the same numbers from Turso, so a mirror that covered only
    // the CREATE path would leave a re-announced site showing last month's
    // scores next to this month's email.
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
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
    };
    await announce(A(seed));

    const scores = writer.patches.find((p) => p.patch.lighthouse_performance !== undefined);
    expect(scores).toMatchObject({
      id: "rec_existing_announce",
      patch: {
        lighthouse_performance: 87,
        lighthouse_accessibility: 91,
        lighthouse_best_practices: 100,
        lighthouse_seo: 95,
      },
    });
  });

  it("stores GA visitors + search presence on the drafted row when enrichment returns data", async () => {
    vi.mocked(fetchGaUsers).mockResolvedValue({
      value: { current: 280, previous: 275 },
      softFailed: false,
    });
    vi.mocked(fetchSearch).mockResolvedValue({
      value: { foundOnPage1: true, position: 3, propertyFound: true },
      softFailed: false,
      defaultQueryMissed: false,
      propertyMissing: false,
      notConfigured: false,
    });
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "Report recipients (To)": "client@acme.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    await announce(A(seed));

    const fields = writer.inserts[0]!.fields;
    expect(fields["GA users (period)"]).toBe(280);
    expect(fields["GA users (prev period)"]).toBe(275);
    expect(fields["Search found page 1"]).toBe(true);
    expect(fields["Search position"]).toBe(3);
  });

  it("one site that throws does not abort the run — other sites still draft", async () => {
    const seed: Seed = {
      Websites: [
        {
          id: "rec_bad",
          fields: {
            Name: "Bad Co",
            url: "https://bad.example.com",
            Status: "maintained",
            ...scoredFields(),
          },
        },
        {
          id: "rec_good",
          fields: {
            Name: "Good Co",
            url: "https://good.example.com",
            Status: "maintained",
            "Report recipients (To)": "client@good.example.com",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    // Force the FIRST site's report creation to throw. Since #646 step 4 the row
    // is written to TURSO, so the failure is injected there — the store that can
    // actually refuse a draft now.
    const deps = A(seed);
    const realCreate = deps.reportMirror.create;
    deps.reportMirror.create = async (rec) => {
      if (String(rec.fields["Report ID"] ?? "").startsWith("Bad Co")) {
        throw new Error("boom on Bad Co");
      }
      return realCreate(rec);
    };

    const result = await announce(deps);

    const byName = new Map(result.results.map((r) => [r.site, r]));
    expect(byName.get("Bad Co")?.status).toBe("error");
    expect(byName.get("Good Co")?.status).toBe("drafted");
  });

  // MEDIUM-B: an announcement-time GA/Search outage must surface the per-site
  // analytics-failure signal, not silently hide the traffic block (it reads identically
  // to "site has no GA configured"). Mirrors the `--due` draft path's analytics-health write.
  it("stamps the analytics soft-fail timestamp when GA errors during the announcement", async () => {
    process.env.GA_SUBJECT = "tucker@reddoorla.com"; // readGaConfig() != null
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "GA4 property ID": "G-123",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    await announce(A(seed));

    expect(analyticsHealthWrite()?.["Analytics soft-fail at"]).toBe(NOW.toISOString());
  });

  it("mirrors the analytics-health stamp into Turso (#539 Phase 5)", async () => {
    // This lands on the SITE row, not the report — a different Turso table and a
    // different mirror. The cockpit's per-site analytics-failure signal reads it.
    process.env.GA_SUBJECT = "tucker@reddoorla.com";
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "GA4 property ID": "G-123",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };
    const mirrored: Array<{ id: string; fields: Record<string, unknown> }> = [];

    await announce(
      A(seed, {
        siteMirror: {
          health: async (id: string, fields: Record<string, unknown>) => {
            mirrored.push({ id, fields });
          },
          site: async () => {},
        },
      }),
    );

    expect(mirrored).toEqual([
      { id: "rec_acme", fields: { "Analytics soft-fail at": NOW.toISOString() } },
    ]);
  });

  it("clears the analytics soft-fail (null) on a clean enrichment so the signal self-heals", async () => {
    process.env.GA_SUBJECT = "tucker@reddoorla.com";
    vi.mocked(fetchGaUsers).mockResolvedValue({
      value: { current: 1200, previous: 1000 },
      softFailed: false,
    });
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "GA4 property ID": "G-123",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    await announce(A(seed));

    expect(analyticsHealthWrite()).toBeDefined();
    expect(analyticsHealthWrite()?.["Analytics soft-fail at"]).toBeNull();
  });

  it("does NOT write analytics health when GA is unconfigured (GA_SUBJECT unset)", async () => {
    // GA_SUBJECT stays unset (beforeEach) → readGaConfig() null → skip the write entirely,
    // even though the fetch soft-failed.
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
    const seed: Seed = {
      Websites: [
        {
          id: "rec_acme",
          fields: {
            Name: "Acme Co",
            url: "https://acme.example.com",
            Status: "maintained",
            "GA4 property ID": "G-123",
            ...scoredFields(),
          },
        },
      ],
      Reports: [],
    };

    await announce(A(seed));

    expect(analyticsHealthWrite()).toBeUndefined();
  });
});

describe("announce's Turso writes on the reuse path", () => {
  const REUSE_SEED: Seed = {
    Websites: [
      {
        id: "rec_acme",
        fields: {
          Name: "Acme Co",
          url: "https://acme.example.com",
          Status: "maintained",
          "GA4 property ID": "G-123",
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
  };

  function captureWarn() {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    return () => {
      const text = warn.mock.calls.flat().join("\n");
      warn.mockRestore();
      return text;
    };
  }

  it("patches the reused row's scores and Completed on in one write", async () => {
    await announce(A(REUSE_SEED));
    expect(writer.patches[0]).toEqual({
      id: "rec_existing_announce",
      patch: {
        lighthouse_performance: 87,
        lighthouse_accessibility: 91,
        lighthouse_best_practices: 100,
        lighthouse_seo: 95,
        completed_on: "2026-06-17",
      },
    });
  });

  it("a failed score refresh errors the site", async () => {
    const deps = A(REUSE_SEED);
    const result = await announce({
      ...deps,
      reportMirror: {
        ...writer,
        patch: async () => {
          throw new Error("libsql down");
        },
      },
    });
    expect(result.results).toEqual([{ site: "Acme Co", status: "error", message: "libsql down" }]);
  });

  it("stores the reused row's rendered body (known-good control)", async () => {
    const result = await announce(A(REUSE_SEED));
    expect(writer.bodies).toHaveLength(1);
    expect(writer.bodies[0]!.id).toBe("rec_existing_announce");
    expect(writer.bodies[0]!.html).toContain("Acme Co");
    expect(result.results[0]).toMatchObject({ status: "reused", queued: true });
  });

  it("a failed body write warns, and the site still drafts and queues", async () => {
    const warned = captureWarn();
    const deps = A(REUSE_SEED);
    const result = await announce({
      ...deps,
      reportMirror: {
        ...writer,
        body: async () => {
          throw new Error("libsql down");
        },
      },
    });
    expect(warned()).toContain("⚠ Announcement preview upload skipped for Acme Co: libsql down");
    expect(writer.bodies).toHaveLength(0);
    expect(result.results[0]).toMatchObject({
      status: "reused",
      reportId: "rec_existing_announce",
      queued: true,
    });
  });

  it("a failed analytics-health mirror is warned and the draft continues", async () => {
    process.env.GA_SUBJECT = "tucker@reddoorla.com";
    vi.mocked(fetchGaUsers).mockResolvedValue({ value: null, softFailed: true });
    const warned = captureWarn();
    const result = await announce(
      A(REUSE_SEED, {
        siteMirror: {
          health: async () => {
            throw new Error("libsql down");
          },
          site: async () => {},
        },
      }),
    );
    expect(warned()).toContain("⚠ analytics-health Turso mirror failed for Acme Co: libsql down");
    expect(result.results[0]).toMatchObject({
      status: "reused",
      reportId: "rec_existing_announce",
    });
  });
});

describe("announce — search presence with no matching Search Console property (P1-19)", () => {
  type SearchValue = { foundOnPage1: boolean; position: number | null; propertyFound: boolean };

  function searchReturns(value: SearchValue | null, softFailed = false) {
    vi.mocked(fetchSearch).mockResolvedValue({
      value,
      softFailed,
      defaultQueryMissed: false,
      propertyMissing: value?.propertyFound === false,
      notConfigured: false,
    });
  }

  function site(): RawRow {
    return {
      id: "rec_acme",
      fields: {
        Name: "Acme Co",
        url: "https://acme.example.com",
        Status: "maintained",
        "Report recipients (To)": "client@acme.example.com",
        ...scoredFields(),
      },
    };
  }

  function existingAnnouncement(): RawRow {
    return {
      id: "rec_existing_announce",
      fields: {
        "Report ID": "Acme Co — Announcement — existing",
        Site: ["rec_acme"],
        "Report type": "Announcement",
        Period: PERIOD,
        "Search found page 1": true,
        "Search position": 3,
      },
    };
  }

  function refreshPatch(): Record<string, unknown> {
    const p = writer.patches.find(
      (x) => x.id === "rec_existing_announce" && x.patch.lighthouse_performance !== undefined,
    );
    expect(p).toBeDefined();
    return p!.patch;
  }

  it("create: writes no search fields, so the column is NULL", async () => {
    searchReturns({ foundOnPage1: false, position: null, propertyFound: false });
    await announce(A({ Websites: [site()], Reports: [] }));
    const fields = writer.inserts[0]!.fields;
    expect("Search found page 1" in fields).toBe(false);
    expect("Search position" in fields).toBe(false);
  });

  it("create: a property-found query with no rows still stores false", async () => {
    searchReturns({ foundOnPage1: false, position: null, propertyFound: true });
    await announce(A({ Websites: [site()], Reports: [] }));
    const fields = writer.inserts[0]!.fields;
    expect(fields["Search found page 1"]).toBe(false);
    expect("Search position" in fields).toBe(false);
  });

  it("reuse: patches search_found_page1 and search_position to explicit null over a prior page-1 result", async () => {
    searchReturns({ foundOnPage1: false, position: null, propertyFound: false });
    await announce(A({ Websites: [site()], Reports: [existingAnnouncement()] }));
    const patch = refreshPatch();
    expect("search_found_page1" in patch && patch.search_found_page1 === null).toBe(true);
    expect("search_position" in patch && patch.search_position === null).toBe(true);
  });

  it("reuse: a page-1 result still patches 1 and its position", async () => {
    searchReturns({ foundOnPage1: true, position: 4, propertyFound: true });
    await announce(A({ Websites: [site()], Reports: [existingAnnouncement()] }));
    const patch = refreshPatch();
    expect(patch.search_found_page1).toBe(1);
    expect(patch.search_position).toBe(4);
  });

  it("reuse: a property-found miss still patches 0", async () => {
    searchReturns({ foundOnPage1: false, position: 22, propertyFound: true });
    await announce(A({ Websites: [site()], Reports: [existingAnnouncement()] }));
    const patch = refreshPatch();
    expect(patch.search_found_page1).toBe(0);
  });

  it("reuse: a soft-fail patch carries no search keys, keeping the last value", async () => {
    searchReturns(null, true);
    await announce(A({ Websites: [site()], Reports: [existingAnnouncement()] }));
    const patch = refreshPatch();
    expect("search_found_page1" in patch).toBe(false);
    expect("search_position" in patch).toBe(false);
  });
});
