import { describe, it, expect } from "vitest";
import {
  assessUsage,
  collectUsage,
  QUOTA_KEY,
  CUMULATIVE_METRICS,
  LEVEL_METRICS,
  CAPACITY_METRICS,
} from "../../src/db/usage.js";
import { runDbCommand } from "../../src/cli/commands/db.js";

// The real starter-plan quotas, read from GET /v1/organizations/{org}/plans on
// 2026-08-26. Pinned here so a test reads the same denominators the alarm will.
const STARTER = {
  rowsRead: 500_000_000,
  rowsWritten: 10_000_000,
  databases: 100,
  locations: 3,
  storage: 5_000_000_000,
  groups: 1,
  bytesSynced: 3_000_000_000,
};

// The real August 2026 reading, from GET /v1/organizations/{org}/usage.
const AUGUST = {
  rows_read: 181_780,
  rows_written: 29_951,
  storage_bytes: 10_407_936,
  bytes_synced: 0,
  databases: 1,
  locations: 2,
  groups: 0,
};

const CYCLE_START = new Date("2026-08-01T04:00:00Z");
const CYCLE_END = new Date("2026-09-01T04:00:00Z");
const NOW = new Date("2026-08-26T04:30:00Z"); // ~80.6% through the cycle

const base = {
  plan: "starter",
  quotas: STARTER,
  usage: AUGUST,
  cycleStart: CYCLE_START,
  cycleEnd: CYCLE_END,
  now: NOW,
  blockedReads: false,
  blockedWrites: false,
};

const kv = (marker: string, key: string): string | undefined =>
  marker
    .split(" ")
    .find((t) => t.startsWith(`${key}=`))
    ?.slice(key.length + 1);

describe("assessUsage", () => {
  // POSITIVE CONTROL. Per the repo's instrument rule, a check that has only
  // ever failed is not evidence. This is the known-good input it must pass on:
  // the real fleet reading, three orders of magnitude below every quota.
  it("passes on the real August reading, and says so on its machine line", () => {
    const r = assessUsage(base);
    expect(r.code).toBe(0);
    expect(kv(r.marker, "verdict")).toBe("ok");
    expect(r.marker.startsWith("FLEET_DB_USAGE ")).toBe(true);
    expect(kv(r.marker, "plan")).toBe("starter");
    // Emitted on EVERY run, clean included — an absent line means never ran.
    expect(kv(r.marker, "worst")).toBeTruthy();
  });

  it("projects cumulative metrics to the end of the billing cycle", () => {
    const r = assessUsage(base);
    // 29,951 / 10,000,000 = 0.2995% used with 80.6% of the cycle elapsed, so
    // the run-rate lands near 0.37% by the cycle's end.
    expect(kv(r.marker, "rows_written")).toBe("0.30%");
    expect(kv(r.marker, "rows_written_proj")).toBe("0.37%");
  });

  it("does NOT project level metrics — storage is a level, not a per-cycle counter", () => {
    const r = assessUsage(base);
    expect(kv(r.marker, "storage_bytes")).toBe("0.21%");
    for (const m of [...LEVEL_METRICS, ...CAPACITY_METRICS]) {
      expect(kv(r.marker, `${m}_proj`), `${m} must not be projected`).toBeUndefined();
    }
    for (const m of CUMULATIVE_METRICS) expect(kv(r.marker, `${m}_proj`)).toBeTruthy();
  });

  // Found by the positive control above: `locations` reads 2 of a quota of 3,
  // i.e. 66.7%, and a flat threshold would have reddened a perfectly healthy
  // fleet on day one. Capacity metrics are configuration ceilings — hitting one
  // blocks CREATING another database/location/group, it does not degrade the
  // database that exists.
  it("does not alarm on a capacity metric below its ceiling", () => {
    const r = assessUsage(base);
    expect(kv(r.marker, "locations")).toBe("66.67%");
    expect(r.code).toBe(0);
    expect(kv(r.marker, "worst")).not.toMatch(/^locations:/);
  });

  // Nor AT the ceiling. The starter plan allows exactly one group and the fleet
  // runs exactly one, so `groups` sits pinned at 100% forever — alarming on it
  // would fire every night about a standing, accepted plan constraint and train
  // the operator to ignore the check. And a capacity ceiling fails LOUDLY at
  // creation time, unlike quota exhaustion, which silently blocks a live
  // database. It is reported on the marker line, never in the exit code.
  it("reports a capacity metric at its ceiling without alarming", () => {
    const r = assessUsage({ ...base, usage: { ...AUGUST, locations: 3, groups: 1 } });
    expect(kv(r.marker, "locations")).toBe("100.00%");
    expect(kv(r.marker, "at_capacity")).toBe("locations,groups");
    expect(r.code).toBe(0);
    expect(kv(r.marker, "verdict")).toBe("ok");
  });

  it("fails when a projection crosses the threshold, while the raw pct is still under it", () => {
    // 35% of the write quota burned with 80.6% of the cycle gone projects to
    // ~43%; at 20% elapsed the same number projects past 100%. The projection
    // is the whole point: a flat pct-now alarm cannot see a runaway on day 6.
    const early = assessUsage({
      ...base,
      usage: { ...AUGUST, rows_written: 3_500_000 },
      now: new Date("2026-08-07T04:00:00Z"), // ~19.4% elapsed
    });
    expect(kv(early.marker, "rows_written")).toBe("35.00%");
    expect(Number.parseFloat(kv(early.marker, "rows_written_proj") ?? "0")).toBeGreaterThan(100);
    expect(early.code).toBe(1);
    expect(kv(early.marker, "verdict")).toBe("over-threshold");
    expect(kv(early.marker, "worst")).toMatch(/^rows_written_proj:/);
  });

  it("fails on a level metric that crosses the threshold outright", () => {
    const r = assessUsage({
      ...base,
      usage: { ...AUGUST, storage_bytes: 3_000_000_000 }, // 60% of 5 GB
    });
    expect(r.code).toBe(1);
    expect(kv(r.marker, "worst")).toBe("storage_bytes:60.00%");
  });

  // The already-broken case. `overages: false` on the starter plan means a
  // crossed quota BLOCKS reads and writes rather than billing — so these flags
  // are not a warning, they are an outage, and no usage number can excuse them.
  it("fails on blocked reads or writes even when every metric is near zero", () => {
    for (const flag of ["blockedReads", "blockedWrites"] as const) {
      const r = assessUsage({ ...base, [flag]: true });
      expect(r.code).toBe(1);
      expect(kv(r.marker, "verdict")).toBe("blocked");
      expect(kv(r.marker, "blocked")).toBe(flag === "blockedReads" ? "reads" : "writes");
    }
  });

  // #585's lesson in its own shape: a metric whose denominator is missing is
  // UNMEASURED, and unmeasured must never read as passing. The `pro` plan
  // really does omit `databases` from its quota object, so this is live.
  it("reports a metric with no published quota as unmeasured rather than passing it", () => {
    const r = assessUsage({
      ...base,
      quotas: { ...STARTER, databases: undefined as unknown as number },
    });
    expect(kv(r.marker, "databases")).toBe("unmeasured");
    expect(r.code).toBe(0); // one unmeasured metric among many is not an alarm
  });

  // VACUITY GUARD. If nothing at all could be measured, the check proved
  // nothing — and a green "nothing to report" is exactly the failure this
  // repo keeps re-learning. It must go red.
  it("fails when NO metric has a quota to measure against", () => {
    const r = assessUsage({ ...base, quotas: {} });
    expect(r.code).toBe(1);
    expect(kv(r.marker, "verdict")).toBe("unmeasurable");
  });

  it("floors the elapsed fraction so the first reading of a cycle is not a divide-by-zero", () => {
    const r = assessUsage({
      ...base,
      usage: { ...AUGUST, rows_read: 1 },
      now: new Date("2026-08-01T04:01:00Z"), // one minute in
    });
    const proj = Number.parseFloat(kv(r.marker, "rows_read_proj") ?? "NaN");
    expect(Number.isFinite(proj)).toBe(true);
    expect(kv(r.marker, "elapsed")).toBe("0.81%"); // floored to 6h of a 744h cycle
  });

  it("clamps the elapsed fraction at 1 when the cycle end has already passed", () => {
    const r = assessUsage({ ...base, now: new Date("2026-09-15T00:00:00Z") });
    expect(kv(r.marker, "elapsed")).toBe("100.00%");
    // With the cycle over, a projection is just the raw pct.
    expect(kv(r.marker, "rows_written_proj")).toBe(kv(r.marker, "rows_written"));
  });

  it("maps every usage metric to a quota key", () => {
    for (const m of [...CUMULATIVE_METRICS, ...LEVEL_METRICS, ...CAPACITY_METRICS]) {
      expect(QUOTA_KEY[m], `no quota key mapped for ${m}`).toBeTruthy();
    }
    // And every quota the API publishes is covered by a metric, so a new plan
    // dimension cannot go unwatched.
    const mapped = new Set(Object.values(QUOTA_KEY));
    for (const q of Object.keys(STARTER)) {
      expect(mapped.has(q), `quota ${q} is published but never measured`).toBe(true);
    }
  });
});

// Recorded from the live platform API on 2026-08-26 so the transport is tested
// against the shape Turso actually returns, not one I imagined.
const RESPONSES: Record<string, unknown> = {
  "https://api.turso.tech/v1/organizations": [{ slug: "tucksravin", name: "personal" }],
  "https://api.turso.tech/v1/organizations/tucksravin/usage": {
    total: { ...AUGUST },
  },
  "https://api.turso.tech/v1/organizations/tucksravin/plans": {
    plans: [
      { name: "starter", quotas: STARTER },
      { name: "scaler", quotas: { ...STARTER, rowsRead: 100_000_000_000 } },
    ],
  },
  "https://api.turso.tech/v1/organizations/tucksravin/subscription": {
    subscription: {
      plan: "starter",
      overages: false,
      current_billing_period_start: "2026-08-01T04:00:00+00:00",
      current_billing_period_end: "2026-09-01T04:00:00+00:00",
    },
  },
  "https://api.turso.tech/v1/organizations/tucksravin/databases": {
    databases: [{ Name: "reddoor-fleet", block_reads: false, block_writes: false }],
  },
};

const fakeFetch =
  (over: Record<string, unknown> = {}, status = 200) =>
  async (url: string) => {
    const body = { ...RESPONSES, ...over }[url];
    if (body === undefined) throw new Error(`unexpected url ${url}`);
    return {
      ok: status === 200,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  };

describe("collectUsage", () => {
  it("resolves the org, plan quotas and billing window from the platform API", async () => {
    const r = await collectUsage({ token: "t", fetchImpl: fakeFetch(), now: NOW });
    expect(r.plan).toBe("starter");
    expect(r.quotas.rowsRead).toBe(500_000_000);
    expect(r.usage.rows_read).toBe(181_780);
    expect(r.cycleStart.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    expect(r.cycleEnd.toISOString()).toBe("2026-09-01T04:00:00.000Z");
    expect(r.blockedReads).toBe(false);
  });

  // The quota denominator must come from the plan the org is ACTUALLY on. A
  // hardcoded ceiling would keep reporting starter percentages after an upgrade
  // — measuring against a number that stopped being true.
  it("selects the quota block matching the subscribed plan, not the first one", async () => {
    const r = await collectUsage({
      token: "t",
      fetchImpl: fakeFetch({
        "https://api.turso.tech/v1/organizations/tucksravin/subscription": {
          subscription: {
            plan: "scaler",
            overages: false,
            current_billing_period_start: "2026-08-01T04:00:00+00:00",
            current_billing_period_end: "2026-09-01T04:00:00+00:00",
          },
        },
      }),
      now: NOW,
    });
    expect(r.plan).toBe("scaler");
    expect(r.quotas.rowsRead).toBe(100_000_000_000);
  });

  it("surfaces a database-level read/write block", async () => {
    const r = await collectUsage({
      token: "t",
      fetchImpl: fakeFetch({
        "https://api.turso.tech/v1/organizations/tucksravin/databases": {
          databases: [{ Name: "reddoor-fleet", block_reads: false, block_writes: true }],
        },
      }),
      now: NOW,
    });
    expect(r.blockedWrites).toBe(true);
  });

  it("throws on a non-200 rather than reporting zeros", async () => {
    await expect(
      collectUsage({ token: "t", fetchImpl: fakeFetch({}, 401), now: NOW }),
    ).rejects.toThrow(/401/);
  });
});

describe("db usage (CLI)", () => {
  // An absent token must not read as a clean run. This is #585's lesson in its
  // own shape: the tell for "never ran" has to be a FAILURE, not a missing line.
  it("exits non-zero with a distinct verdict when no platform token is configured", async () => {
    const r = await runDbCommand("usage", {}, { platformToken: "" });
    expect(r.code).toBe(1);
    expect(r.output).toContain("FLEET_DB_USAGE");
    expect(r.output).toContain("verdict=no-token");
  });

  it("emits the marker and exits 0 on the real August reading", async () => {
    const r = await runDbCommand(
      "usage",
      {},
      { platformToken: "t", fetchImpl: fakeFetch(), now: NOW },
    );
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/^FLEET_DB_USAGE .* verdict=ok$/m);
  });
});
