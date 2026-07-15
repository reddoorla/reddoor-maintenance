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
vi.mock("google-auth-library", () => ({
  JWT: vi.fn().mockImplementation(function (opts: unknown) {
    return { __opts: opts };
  }),
}));

import { fetchPeriodUsers } from "../../../src/reports/ga/client.js";
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
  vi.mocked(JWT).mockClear();
});

describe("fetchPeriodUsers", () => {
  const start = new Date("2026-05-03T00:00:00Z");
  const end = new Date("2026-06-02T00:00:00Z");

  it("queries the current window then the equal-length previous window", async () => {
    runReport.mockResolvedValueOnce(resp(666)).mockResolvedValueOnce(resp(540));

    const out = await fetchPeriodUsers(
      { propertyId: "471880366", subjects: ["tucker@reddoorla.com"], keyPath },
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

  it("builds a JWT with the impersonation subject + analytics.readonly scope", async () => {
    runReport.mockResolvedValue(resp(1));
    await fetchPeriodUsers(
      { propertyId: "1", subjects: ["imp@reddoorla.com"], keyPath },
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
      { propertyId: "1", subjects: ["s@x.com"], keyPath },
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
      { propertyId: "1", subjects: ["dead@reddoorla.com", "reports@reddoorla.com"], keyPath },
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
      fetchPeriodUsers({ propertyId: "1", subjects: ["a@x.com", "b@x.com"], keyPath }, start, end),
    ).rejects.toThrow("last");
  });

  it("does NOT fail over on a non-auth error", async () => {
    runReport.mockRejectedValue(new Error("socket hang up"));
    await expect(
      fetchPeriodUsers({ propertyId: "1", subjects: ["a@x.com", "b@x.com"], keyPath }, start, end),
    ).rejects.toThrow("socket hang up");
    expect(vi.mocked(JWT)).toHaveBeenCalledTimes(1);
  });
});
