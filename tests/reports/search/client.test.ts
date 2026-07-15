import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const request = vi.fn();
vi.mock("google-auth-library", () => ({
  // Constructable mock — `new JWT(...)`. Arrow fns can't be `new`ed.
  JWT: vi.fn().mockImplementation(function (opts: unknown) {
    return { __opts: opts, request };
  }),
}));

import {
  fetchSearchPresence,
  resolvePropertyCandidates,
  pickBrandQuery,
  selectBrandPosition,
  bareHost,
  BRAND_QUERY_ROW_LIMIT,
} from "../../../src/reports/search/client.js";
import { JWT } from "google-auth-library";

// Real temp key file (JWT is mocked, so contents need only be valid JSON).
const keyPath = join(tmpdir(), `sc-key-${process.pid}.json`);
writeFileSync(
  keyPath,
  JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: "PEM" }),
);

const start = new Date("2026-04-30T00:00:00Z");
const end = new Date("2026-05-30T00:00:00Z");

/** A gaxios-shaped response. */
function ok(data: unknown) {
  return { data };
}

beforeEach(() => {
  request.mockReset();
  vi.mocked(JWT).mockClear();
});

describe("bareHost", () => {
  it("strips sc-domain, scheme, www, path, and lowercases", () => {
    expect(bareHost("sc-domain:ERPFunds.com")).toBe("erpfunds.com");
    expect(bareHost("https://www.erpfunds.com/about")).toBe("erpfunds.com");
    expect(bareHost("http://erpfunds.com")).toBe("erpfunds.com");
  });
});

describe("resolvePropertyCandidates", () => {
  const entries = [
    { siteUrl: "https://www.erpfunds.com/" },
    { siteUrl: "sc-domain:erpfunds.com" },
    { siteUrl: "https://other.com/" },
  ];
  it("returns all matching properties, Domain (sc-domain:) form first", () => {
    expect(resolvePropertyCandidates(entries, "erpfunds.com")).toEqual([
      "sc-domain:erpfunds.com",
      "https://www.erpfunds.com/",
    ]);
  });
  it("returns a lone URL-prefix property when no Domain property exists", () => {
    expect(
      resolvePropertyCandidates([{ siteUrl: "https://www.only-prefix.com/" }], "only-prefix.com"),
    ).toEqual(["https://www.only-prefix.com/"]);
  });
  it("returns an empty list when nothing matches", () => {
    expect(resolvePropertyCandidates(entries, "nope.com")).toEqual([]);
  });
});

describe("pickBrandQuery", () => {
  it("returns undefined for no rows / no numeric position", () => {
    expect(pickBrandQuery([])).toBeUndefined();
    expect(pickBrandQuery([{ impressions: 50 }])).toBeUndefined();
  });
  it("returns the lone row's position (impressions optional)", () => {
    expect(pickBrandQuery([{ position: 8 }])).toBe(8);
  });
  it("picks the highest-impression row's position", () => {
    expect(
      pickBrandQuery([
        { position: 1, impressions: 2 },
        { position: 4, impressions: 30 },
        { position: 9, impressions: 5 },
      ]),
    ).toBe(4);
  });
  it("breaks an impressions tie by the better (lower) position", () => {
    expect(
      pickBrandQuery([
        { position: 6, impressions: 10 },
        { position: 2, impressions: 10 },
      ]),
    ).toBe(2);
  });
  it("treats a missing impressions count as 0 (a counted row outranks it)", () => {
    expect(
      pickBrandQuery([
        { position: 1 }, // impressions undefined → 0
        { position: 5, impressions: 1 },
      ]),
    ).toBe(5);
  });
});

describe("selectBrandPosition", () => {
  it("returns the exact-query row's position when present (case-insensitive on the key)", () => {
    expect(
      selectBrandPosition(
        [
          { keys: ["Red Door Creative"], position: 3, impressions: 7 },
          { keys: ["red door creative reviews"], position: 1, impressions: 80 },
        ],
        "red door creative",
      ),
    ).toBe(3);
  });
  it("falls back to the most-searched row when no key equals the query exactly", () => {
    expect(
      selectBrandPosition(
        [
          { keys: ["red door creative agency"], position: 5, impressions: 90 },
          { keys: ["red door creative reviews"], position: 2, impressions: 10 },
        ],
        "red door creative",
      ),
    ).toBe(5);
  });
  it("matches the exact row by KEY even when it is not first (not a positional rows[0] pick)", () => {
    // The exact row sits AFTER a non-exact, better-ranking, more-searched row. Selection must
    // still find it by key equality — a rows[0]/first-row shortcut would wrongly return 1.
    expect(
      selectBrandPosition(
        [
          { keys: ["red door creative reviews"], position: 1, impressions: 80 },
          { keys: ["red door creative"], position: 3, impressions: 7 },
        ],
        "red door creative",
      ),
    ).toBe(3);
  });
  it("ignores an exact-key row that has no numeric position, using most-searched instead", () => {
    expect(
      selectBrandPosition(
        [
          { keys: ["red door creative"], impressions: 999 }, // exact key but no position
          { keys: ["red door creative la"], position: 4, impressions: 5 },
        ],
        "red door creative",
      ),
    ).toBe(4);
  });
  it("returns undefined when no row has a numeric position", () => {
    expect(
      selectBrandPosition([{ keys: ["red door creative"] }], "red door creative"),
    ).toBeUndefined();
  });
});

describe("fetchSearchPresence", () => {
  it("queries the given property and returns rounded avg position + page-1 flag", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 1.52, impressions: 31 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["tucker@reddoorla.com"],
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "ERP funds",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 2 });
    // One call only — no sites.list when property is explicit.
    expect(request).toHaveBeenCalledTimes(1);
    const call = request.mock.calls[0]![0];
    expect(call.method).toBe("POST");
    expect(call.url).toContain(encodeURIComponent("sc-domain:erpfunds.com"));
    expect(call.data.startDate).toBe("2026-04-30");
    expect(call.data.endDate).toBe("2026-05-30");
    // Brand hint is matched as a lowercased SUBSTRING (`contains`), not an exact `equals`,
    // so a near-miss configured string still finds the real brand query.
    expect(call.data.dimensionFilterGroups[0].filters[0].operator).toBe("contains");
    expect(call.data.dimensionFilterGroups[0].filters[0].expression).toBe("erp funds");
  });

  it("with no exact match, picks the most-searched variant (highest impressions), reporting ITS position", async () => {
    // `contains` returns several brand-phrasing variants, none equal to the configured query.
    // We report the position of the one real users search most (highest impressions), not
    // whichever ranks best or comes first.
    request.mockResolvedValueOnce(
      ok({
        rows: [
          { keys: ["red door creative reviews"], position: 1.4, impressions: 3 }, // ranks best, barely searched
          { keys: ["red door creative agency"], position: 3.2, impressions: 90 }, // most searched
          { keys: ["red door creative pricing"], position: 7.0, impressions: 12 },
        ],
      }),
    );
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["s@x.com"],
        property: "sc-domain:reddoorla.com",
        host: "reddoorla.com",
        query: "red door creative",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 3 });
    // Pins the documented row budget (headroom so the exact query is never paged out).
    expect(request.mock.calls[0]![0].data.rowLimit).toBe(BRAND_QUERY_ROW_LIMIT);
  });

  it("reports the most-searched variant's position even when it is OFF page 1 (no page-1 clamp)", async () => {
    // The impressions winner ranks #13; a lower-impression variant ranks #2. We must report
    // the variant people actually search (13) and flag it not-on-page-1 — not silently prefer
    // the better-ranking row to keep the page-1 badge.
    request.mockResolvedValueOnce(
      ok({
        rows: [
          { keys: ["red door creative reviews"], position: 13, impressions: 90 },
          { keys: ["red door creative agency"], position: 2, impressions: 5 },
        ],
      }),
    );
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["s@x.com"],
        property: "sc-domain:reddoorla.com",
        host: "reddoorla.com",
        query: "red door creative",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: 13 });
  });

  it("prefers the exact-query row over a higher-impression, better-ranking variant", async () => {
    // The exact configured query is present among the contains results. Even though a longer
    // variant ranks better (#1) AND is searched far more, the operator's precise query wins.
    request.mockResolvedValueOnce(
      ok({
        rows: [
          { keys: ["red door creative"], position: 3, impressions: 7 }, // exact match
          { keys: ["red door creative reviews"], position: 1, impressions: 80 }, // variant
        ],
      }),
    );
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["s@x.com"],
        property: "sc-domain:reddoorla.com",
        host: "reddoorla.com",
        query: "red door creative",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 3 }); // exact #3, not the variant's #1
  });

  it("floors a sub-1 average position to 1 so the email never renders '#0'", async () => {
    // Search Console can return an averaged position below 1 (e.g. 0.4); Math.round
    // would yield 0 and the template renders "Page 1 Google Result (#0)".
    request.mockResolvedValueOnce(ok({ rows: [{ position: 0.4 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["tucker@reddoorla.com"],
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "erp funds",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 1 });
  });

  it("auto-resolves the property via sites.list when none is given", async () => {
    request
      .mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:erpfunds.com" }] })) // sites.list
      .mockResolvedValueOnce(ok({ rows: [{ position: 8 }] })); // query
    const out = await fetchSearchPresence(
      { keyPath, subjects: ["s@x.com"], host: "erpfunds.com", query: "erp funds" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 8 });
    expect(request.mock.calls[0]![0].url).toContain("/sites");
    expect(request.mock.calls[0]![0].method).toBe("GET");
    expect(request.mock.calls[1]![0].url).toContain(encodeURIComponent("sc-domain:erpfunds.com"));
  });

  it("falls back to the next matching property when the first has no data for the query", async () => {
    // A real case: a freshly-verified Domain property has no history, but the long-lived
    // URL-prefix property does. Try the Domain form first, fall back to the URL-prefix.
    request
      .mockResolvedValueOnce(
        ok({
          siteEntry: [
            { siteUrl: "https://www.erpfunds.com/" },
            { siteUrl: "sc-domain:erpfunds.com" },
          ],
        }),
      ) // sites.list
      .mockResolvedValueOnce(ok({ rows: [] })) // sc-domain: no data
      .mockResolvedValueOnce(ok({ rows: [{ position: 2 }] })); // url-prefix: found
    const out = await fetchSearchPresence(
      { keyPath, subjects: ["s@x.com"], host: "erpfunds.com", query: "erp funds" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 2 });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls[1]![0].url).toContain(encodeURIComponent("sc-domain:erpfunds.com"));
    expect(request.mock.calls[2]![0].url).toContain(
      encodeURIComponent("https://www.erpfunds.com/"),
    );
  });

  it("does NOT fall back when an explicit property is given (operator's choice is final)", async () => {
    request.mockResolvedValueOnce(ok({ rows: [] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["s@x.com"],
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "q",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("returns not-found without querying when no property resolves", async () => {
    request.mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:other.com" }] }));
    const out = await fetchSearchPresence(
      { keyPath, subjects: ["s@x.com"], host: "erpfunds.com", query: "q" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
    expect(request).toHaveBeenCalledTimes(1); // sites.list only, no query
  });

  it("returns not-found when every matching property has no rows", async () => {
    request
      .mockResolvedValueOnce(
        ok({
          siteEntry: [
            { siteUrl: "sc-domain:erpfunds.com" },
            { siteUrl: "https://www.erpfunds.com/" },
          ],
        }),
      )
      .mockResolvedValueOnce(ok({ rows: [] }))
      .mockResolvedValueOnce(ok({ rows: [] }));
    const out = await fetchSearchPresence(
      { keyPath, subjects: ["s@x.com"], host: "erpfunds.com", query: "q" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("treats an average position worse than 10 as not on page 1", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 14.2 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["s@x.com"],
        property: "sc-domain:erpfunds.com",
        host: "erpfunds.com",
        query: "q",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: 14 });
  });

  it("builds the JWT with the webmasters.readonly scope + impersonation subject", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 1 }] }));
    await fetchSearchPresence(
      {
        keyPath,
        subjects: ["imp@reddoorla.com"],
        property: "sc-domain:x.com",
        host: "x.com",
        query: "q",
      },
      start,
      end,
    );
    const opts = vi.mocked(JWT).mock.calls[0]![0] as {
      subject: string;
      scopes: string[];
      email: string;
    };
    expect(opts.subject).toBe("imp@reddoorla.com");
    expect(opts.scopes).toContain("https://www.googleapis.com/auth/webmasters.readonly");
    expect(opts.email).toBe("sa@proj.iam.gserviceaccount.com");
  });

  it("propagates API errors so the caller can soft-fail", async () => {
    request.mockRejectedValueOnce(new Error("403 PERMISSION_DENIED"));
    await expect(
      fetchSearchPresence(
        {
          keyPath,
          subjects: ["s@x.com"],
          property: "sc-domain:x.com",
          host: "x.com",
          query: "q",
        },
        start,
        end,
      ),
    ).rejects.toThrow("403");
  });

  it("fails over to the next subject on an auth error and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    request
      .mockRejectedValueOnce(
        Object.assign(new Error("PERMISSION_DENIED"), { response: { status: 403 } }),
      )
      .mockResolvedValueOnce(ok({ rows: [{ position: 4 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["dead@reddoorla.com", "reports@reddoorla.com"],
        property: "sc-domain:x.com",
        host: "x.com",
        query: "q",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 4 });
    const subjectsTried = vi
      .mocked(JWT)
      .mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjectsTried).toEqual(["dead@reddoorla.com", "reports@reddoorla.com"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Search Console subject failover"));
    warn.mockRestore();
  });

  it("fails over when a subject can see NO matching property (sites.list is per-user)", async () => {
    // sites.list only returns properties the impersonated user can access, so a subject that
    // lost access resolves an EMPTY candidate list without any auth error — that must count
    // as a failover condition, not a silent "brand not found".
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    request
      .mockResolvedValueOnce(ok({ siteEntry: [] })) // dead subject sees nothing
      .mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:erpfunds.com" }] }))
      .mockResolvedValueOnce(ok({ rows: [{ position: 8 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subjects: ["dead@reddoorla.com", "reports@reddoorla.com"],
        host: "erpfunds.com",
        query: "erp funds",
      },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: true, position: 8 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Search Console subject failover"));
    warn.mockRestore();
  });

  it("still returns not-found (no throw) when EVERY subject resolves no matching property", async () => {
    request
      .mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:other.com" }] }))
      .mockResolvedValueOnce(ok({ siteEntry: [] }));
    const out = await fetchSearchPresence(
      { keyPath, subjects: ["a@x.com", "b@x.com"], host: "erpfunds.com", query: "q" },
      start,
      end,
    );
    expect(out).toEqual({ foundOnPage1: false, position: null });
    expect(request).toHaveBeenCalledTimes(2); // two sites.list calls, no query
  });

  // A real auth failure on ANY subject must propagate (→ caller soft-fails), never be masked
  // by a later subject's empty sites.list into an affirmative "not on page 1". Both orderings
  // must behave the same; the [auth, empty] order is the one that used to silently self-heal.
  it("does NOT mask a real auth failure behind a later subject's empty property list [auth, empty]", async () => {
    request
      .mockRejectedValueOnce(
        Object.assign(new Error("PERMISSION_DENIED"), { response: { status: 403 } }),
      ) // dead subject: real auth error
      .mockResolvedValueOnce(ok({ siteEntry: [] })); // backup subject: sees no property (sentinel)
    await expect(
      fetchSearchPresence(
        {
          keyPath,
          subjects: ["dead@reddoorla.com", "backup@reddoorla.com"],
          host: "x.com",
          query: "q",
        },
        start,
        end,
      ),
    ).rejects.toThrow(/403|PERMISSION_DENIED/);
  });

  it("propagates the same auth failure in the reverse order too [empty, auth]", async () => {
    request
      .mockResolvedValueOnce(ok({ siteEntry: [] })) // first subject: no property (sentinel)
      .mockRejectedValueOnce(
        Object.assign(new Error("PERMISSION_DENIED"), { response: { status: 403 } }),
      ); // second subject: real auth error
    await expect(
      fetchSearchPresence(
        { keyPath, subjects: ["a@reddoorla.com", "dead@reddoorla.com"], host: "x.com", query: "q" },
        start,
        end,
      ),
    ).rejects.toThrow(/403|PERMISSION_DENIED/);
  });

  it("throws the last error when every subject fails auth (caller soft-fails)", async () => {
    request
      .mockRejectedValueOnce(Object.assign(new Error("first"), { response: { status: 403 } }))
      .mockRejectedValueOnce(Object.assign(new Error("last"), { response: { status: 403 } }));
    await expect(
      fetchSearchPresence(
        {
          keyPath,
          subjects: ["a@x.com", "b@x.com"],
          property: "sc-domain:x.com",
          host: "x.com",
          query: "q",
        },
        start,
        end,
      ),
    ).rejects.toThrow("last");
  });
});
