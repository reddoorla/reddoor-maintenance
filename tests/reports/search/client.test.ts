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
  bareHost,
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

describe("fetchSearchPresence", () => {
  it("queries the given property and returns rounded avg position + page-1 flag", async () => {
    request.mockResolvedValueOnce(ok({ rows: [{ position: 1.52, impressions: 31 }] }));
    const out = await fetchSearchPresence(
      {
        keyPath,
        subject: "tucker@reddoorla.com",
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
    // Query filter is lowercased.
    expect(call.data.dimensionFilterGroups[0].filters[0].expression).toBe("erp funds");
  });

  it("auto-resolves the property via sites.list when none is given", async () => {
    request
      .mockResolvedValueOnce(ok({ siteEntry: [{ siteUrl: "sc-domain:erpfunds.com" }] })) // sites.list
      .mockResolvedValueOnce(ok({ rows: [{ position: 8 }] })); // query
    const out = await fetchSearchPresence(
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "erp funds" },
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
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "erp funds" },
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
        subject: "s@x.com",
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
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "q" },
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
      { keyPath, subject: "s@x.com", host: "erpfunds.com", query: "q" },
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
        subject: "s@x.com",
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
        subject: "imp@reddoorla.com",
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
          subject: "s@x.com",
          property: "sc-domain:x.com",
          host: "x.com",
          query: "q",
        },
        start,
        end,
      ),
    ).rejects.toThrow("403");
  });
});
