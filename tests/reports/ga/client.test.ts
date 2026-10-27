import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const runReport = vi.fn();
vi.mock("@google-analytics/data", () => ({
  // Constructable mock — `new BetaAnalyticsDataClient(...)`. Arrow fns can't be `new`ed.
  BetaAnalyticsDataClient: vi.fn().mockImplementation(function () {
    return { runReport };
  }),
}));
const adminRequest = vi.fn();
vi.mock("google-auth-library", () => ({
  JWT: vi.fn().mockImplementation(function (opts: unknown) {
    return { __opts: opts, request: adminRequest };
  }),
}));

import {
  fetchPeriodUsers,
  fetchReportVisits,
  measuredHostnames,
  reportWindows,
  REPORT_WINDOW_DAYS,
} from "../../../src/reports/ga/client.js";
import { JWT } from "google-auth-library";

// Real temp key file (JWT is mocked, so contents need only be valid JSON).
const keyPath = join(tmpdir(), `ga-key-${process.pid}.json`);
writeFileSync(
  keyPath,
  JSON.stringify({ client_email: "sa@proj.iam.gserviceaccount.com", private_key: "PEM" }),
);

function resp(value: number) {
  return [{ rows: [{ metricValues: [{ value: String(value) }] }] }];
}

beforeEach(() => {
  runReport.mockReset();
  adminRequest.mockReset();
  vi.mocked(JWT).mockClear();
});

describe("fetchPeriodUsers", () => {
  const start = new Date("2026-05-03T00:00:00Z");
  const end = new Date("2026-06-02T00:00:00Z");

  it("queries the current window then the equal-length previous window", async () => {
    runReport.mockResolvedValueOnce(resp(666)).mockResolvedValueOnce(resp(540));

    const out = await fetchPeriodUsers(
      { propertyId: "471880366", subjects: ["tucker@reddoorla.com"], keyPath, hostnames: [] },
      start,
      end,
    );

    expect(out).toEqual({ current: 666, previous: 540 });

    // Current window = the report period, verbatim.
    expect(runReport.mock.calls[0]![0].dateRanges[0]).toEqual({
      startDate: "2026-05-03",
      endDate: "2026-06-02",
    });
    // Previous window = same length (30d span), ending the day before periodStart.
    expect(runReport.mock.calls[1]![0].dateRanges[0]).toEqual({
      startDate: "2026-04-02",
      endDate: "2026-05-02",
    });
    // Property + metric.
    expect(runReport.mock.calls[0]![0].property).toBe("properties/471880366");
    expect(runReport.mock.calls[0]![0].metrics).toEqual([{ name: "activeUsers" }]);
  });

  it("trims the property id into the resource name, as the analytics audit does", async () => {
    runReport.mockResolvedValue(resp(1));
    await fetchPeriodUsers(
      { propertyId: " 471880366\n", subjects: ["s@x"], keyPath, hostnames: [] },
      start,
      end,
    );
    expect(runReport.mock.calls[0]![0].property).toBe("properties/471880366");
  });

  it("builds a JWT with the impersonation subject + analytics.readonly scope", async () => {
    runReport.mockResolvedValue(resp(1));
    await fetchPeriodUsers(
      { propertyId: "1", subjects: ["imp@reddoorla.com"], keyPath, hostnames: [] },
      start,
      end,
    );

    const opts = vi.mocked(JWT).mock.calls[0]![0] as {
      subject: string;
      scopes: string[];
      email: string;
    };
    expect(opts.subject).toBe("imp@reddoorla.com");
    expect(opts.scopes).toContain("https://www.googleapis.com/auth/analytics.readonly");
    expect(opts.email).toBe("sa@proj.iam.gserviceaccount.com");
  });

  it("defaults to 0 when a window has no rows", async () => {
    runReport.mockResolvedValue([{ rows: [] }]);
    const out = await fetchPeriodUsers(
      { propertyId: "1", subjects: ["s@x.com"], keyPath, hostnames: [] },
      start,
      end,
    );
    expect(out).toEqual({ current: 0, previous: 0 });
  });

  it("fails over to the next subject on an auth error and warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runReport
      .mockRejectedValueOnce(Object.assign(new Error("7 PERMISSION_DENIED"), { code: 7 }))
      .mockResolvedValueOnce(resp(10))
      .mockResolvedValueOnce(resp(8));

    const out = await fetchPeriodUsers(
      {
        propertyId: "1",
        subjects: ["dead@reddoorla.com", "reports@reddoorla.com"],
        keyPath,
        hostnames: [],
      },
      start,
      end,
    );

    expect(out).toEqual({ current: 10, previous: 8 });
    // One JWT per attempted subject, in configured order.
    const subjectsTried = vi
      .mocked(JWT)
      .mock.calls.map((c) => (c[0] as { subject: string }).subject);
    expect(subjectsTried).toEqual(["dead@reddoorla.com", "reports@reddoorla.com"]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GA subject failover"));
    warn.mockRestore();
  });

  it("throws the last error when every subject fails auth (caller soft-fails)", async () => {
    runReport
      .mockRejectedValueOnce(Object.assign(new Error("first"), { code: 7 }))
      .mockRejectedValueOnce(Object.assign(new Error("last"), { code: 7 }));
    await expect(
      fetchPeriodUsers(
        { propertyId: "1", subjects: ["a@x.com", "b@x.com"], keyPath, hostnames: [] },
        start,
        end,
      ),
    ).rejects.toThrow("last");
  });

  it("does NOT fail over on a non-auth error", async () => {
    runReport.mockRejectedValue(new Error("socket hang up"));
    await expect(
      fetchPeriodUsers(
        { propertyId: "1", subjects: ["a@x.com", "b@x.com"], keyPath, hostnames: [] },
        start,
        end,
      ),
    ).rejects.toThrow("socket hang up");
    expect(vi.mocked(JWT)).toHaveBeenCalledTimes(1);
  });
});

describe("measuredHostnames", () => {
  it("returns the apex and its www twin, whichever the site row carries", () => {
    expect(measuredHostnames("https://reddoorla.com/")).toEqual([
      "reddoorla.com",
      "www.reddoorla.com",
    ]);
    expect(measuredHostnames("https://www.beachfrontdentistry.com/")).toEqual([
      "beachfrontdentistry.com",
      "www.beachfrontdentistry.com",
    ]);
  });

  it("treats a subdomain as its own host, so staging is never the production apex", () => {
    expect(measuredHostnames("https://staging.reddoorla.com/")).toEqual([
      "staging.reddoorla.com",
      "www.staging.reddoorla.com",
    ]);
  });

  it("returns nothing for a value that is not an http(s) URL, leaving the query unfiltered", () => {
    // Unfiltered is the deliberate fallback: a filter matching nothing would
    // report zero users, which is a worse lie than reporting noise.
    for (const bad of ["", "not a url", "file:///etc/passwd", "reddoorla.com"]) {
      expect(measuredHostnames(bad)).toEqual([]);
    }
  });
});

describe("fetchPeriodUsers host filtering", () => {
  const start = new Date("2026-05-03T00:00:00Z");
  const end = new Date("2026-06-02T00:00:00Z");

  it("asks GA4 for the site's own hosts only, in both windows", async () => {
    runReport.mockResolvedValueOnce(resp(87)).mockResolvedValueOnce(resp(176));

    await fetchPeriodUsers(
      {
        propertyId: "1",
        subjects: ["s@x.com"],
        keyPath,
        hostnames: ["reddoorla.com", "www.reddoorla.com"],
      },
      start,
      end,
    );

    expect(runReport.mock.calls).toHaveLength(2);
    for (const call of runReport.mock.calls) {
      expect(call[0]!.dimensionFilter).toEqual({
        filter: {
          fieldName: "hostName",
          inListFilter: { values: ["reddoorla.com", "www.reddoorla.com"] },
        },
      });
    }
  });

  it("sends no filter at all when there is no usable hostname", async () => {
    runReport.mockResolvedValue(resp(1));
    await fetchPeriodUsers(
      { propertyId: "1", subjects: ["s@x.com"], keyPath, hostnames: [] },
      start,
      end,
    );
    expect(runReport.mock.calls[0]![0]).not.toHaveProperty("dimensionFilter");
  });
});

/** Whole days in an inclusive YYYY-MM-DD range. */
function inclusiveDays(r: { startDate: string; endDate: string }): number {
  return (Date.parse(r.endDate) - Date.parse(r.startDate)) / 86_400_000 + 1;
}

describe("reportWindows (P1-73)", () => {
  const LA = "America/Los_Angeles";

  it("is the 30 days that ended yesterday in the property's timezone, then the 30 before", () => {
    expect(REPORT_WINDOW_DAYS).toBe(30);
    // 2026-10-26T15:06Z is 8:06am PT on 10-26: yesterday is 10-25.
    expect(reportWindows(new Date("2026-10-26T15:06:00Z"), LA)).toEqual({
      current: { startDate: "2026-09-26", endDate: "2026-10-25" },
      previous: { startDate: "2026-08-27", endDate: "2026-09-25" },
    });
  });

  it("never includes the day still in progress: 07:16Z is 12:16am PT, so the window ends the day before", () => {
    // The 12:16am PT 10-25 draft queried endDate 2026-10-25, a 16-minute-old day.
    const w = reportWindows(new Date("2026-10-25T07:16:00Z"), LA);
    expect(w.current.endDate).toBe("2026-10-24");
    expect(w.current.startDate).toBe("2026-09-25");
  });

  it("cuts the day in the property's timezone, not UTC: 10:30pm PT 10-25 is already 10-26 in UTC", () => {
    const w = reportWindows(new Date("2026-10-26T05:30:00Z"), LA);
    expect(w.current.endDate).toBe("2026-10-24");
    // A property east of UTC is already a day ahead at the same instant.
    expect(reportWindows(new Date("2026-10-26T05:30:00Z"), "Asia/Tokyo").current.endDate).toBe(
      "2026-10-25",
    );
  });

  it("spans exactly 30 inclusive days in each window, back to back, across a DST change", () => {
    // 2026-11-01 is the PT fall-back; 2026-03-08 the spring-forward.
    for (const now of ["2026-11-15T20:00:00Z", "2026-03-20T20:00:00Z", "2026-01-01T07:59:00Z"]) {
      const w = reportWindows(new Date(now), LA);
      expect(inclusiveDays(w.current)).toBe(30);
      expect(inclusiveDays(w.previous)).toBe(30);
      expect(Date.parse(w.current.startDate) - Date.parse(w.previous.endDate)).toBe(86_400_000);
    }
  });

  it("refuses a timezone it cannot read rather than falling back to UTC", () => {
    expect(() => reportWindows(new Date("2026-10-26T15:06:00Z"), "")).toThrow(/timezone/i);
    expect(() => reportWindows(new Date("2026-10-26T15:06:00Z"), "Not/AZone")).toThrow();
  });
});

describe("fetchReportVisits (P1-73)", () => {
  const query = {
    propertyId: "471880366",
    subjects: ["s@x.com"],
    keyPath,
    hostnames: ["erpfunds.com", "www.erpfunds.com"],
  };

  it("reads the property's timezone, then counts engaged sessions on the site's hosts in both windows", async () => {
    adminRequest.mockResolvedValue({ data: { timeZone: "America/Los_Angeles" } });
    runReport.mockResolvedValueOnce(resp(217)).mockResolvedValueOnce(resp(215));

    const out = await fetchReportVisits(query, new Date("2026-10-25T07:16:00Z"));

    expect(out).toEqual({ current: 217, previous: 215 });
    expect(adminRequest.mock.calls[0]![0].url).toBe(
      "https://analyticsadmin.googleapis.com/v1beta/properties/471880366",
    );
    expect(runReport.mock.calls).toHaveLength(2);
    expect(runReport.mock.calls[0]![0].dateRanges).toEqual([
      { startDate: "2026-09-25", endDate: "2026-10-24" },
    ]);
    expect(runReport.mock.calls[1]![0].dateRanges).toEqual([
      { startDate: "2026-08-26", endDate: "2026-09-24" },
    ]);
    for (const call of runReport.mock.calls) {
      expect(call[0]!.property).toBe("properties/471880366");
      expect(call[0]!.metrics).toEqual([{ name: "engagedSessions" }]);
      expect(call[0]!.dimensionFilter).toEqual({
        filter: {
          fieldName: "hostName",
          inListFilter: { values: ["erpfunds.com", "www.erpfunds.com"] },
        },
      });
    }
  });

  it("throws when the property reports no timezone, so the caller soft-fails instead of guessing UTC", async () => {
    adminRequest.mockResolvedValue({ data: {} });
    await expect(fetchReportVisits(query, new Date("2026-10-26T15:06:00Z"))).rejects.toThrow(
      /timezone/i,
    );
    expect(runReport).not.toHaveBeenCalled();
  });

  it("fails over to the next subject when the timezone read is refused", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    adminRequest
      .mockRejectedValueOnce(Object.assign(new Error("unauthorized_client"), { code: 401 }))
      .mockResolvedValueOnce({ data: { timeZone: "America/Los_Angeles" } });
    runReport.mockResolvedValue(resp(3));
    const out = await fetchReportVisits(
      { ...query, subjects: ["dead@x.com", "live@x.com"] },
      new Date("2026-10-26T15:06:00Z"),
    );
    expect(out).toEqual({ current: 3, previous: 3 });
    expect(vi.mocked(JWT).mock.calls.map((c) => (c[0] as { subject: string }).subject)).toEqual([
      "dead@x.com",
      "live@x.com",
    ]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("GA subject failover"));
    warn.mockRestore();
  });

  it("does not fail over when the timezone read fails for a reason that is not auth", async () => {
    adminRequest.mockRejectedValue(
      Object.assign(new Error("backend error"), { response: { status: 500 } }),
    );
    await expect(
      fetchReportVisits(
        { ...query, subjects: ["a@x.com", "b@x.com"] },
        new Date("2026-10-26T15:06:00Z"),
      ),
    ).rejects.toThrow("backend error");
    expect(adminRequest).toHaveBeenCalledTimes(1);
    expect(runReport).not.toHaveBeenCalled();
  });
});
