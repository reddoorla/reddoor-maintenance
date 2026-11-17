/**
 * P1-87 PR 6: the `traffic` block's assembly (src/fleet-daily/traffic.ts). Every read
 * is a fake reader, so no test reaches Google. The rules under test are the plan's:
 * windows come from the night, a failed read is null with its reason and never 0, and
 * one site's failure never fails the block.
 */
import { describe, it, expect, vi } from "vitest";
import { NoPropertyForSubjectError } from "../../src/reports/search/client.js";
import {
  readTraffic,
  trafficWindows,
  type TrafficReaders,
  type TrafficSiteInput,
} from "../../src/fleet-daily/traffic.js";
import type { TrafficWindow } from "../../src/fleet-daily/types.js";

const NIGHT = "2026-11-16";

/** Every calendar date from `start` to `end`, inclusive, oldest first. */
function datesIn(w: TrafficWindow): string[] {
  const out: string[] = [];
  const t0 = Date.parse(`${w.startDate}T00:00:00Z`);
  const t1 = Date.parse(`${w.endDate}T00:00:00Z`);
  for (let t = t0; t <= t1; t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** A visits map for the whole range with one value per day. */
function flat(range: TrafficWindow, value: number): Map<string, number> {
  return new Map(datesIn(range).map((d) => [d, value]));
}

const site = (id: string, extra: Partial<TrafficSiteInput> = {}): TrafficSiteInput => ({
  id,
  url: `https://${id}.example/`,
  ga4PropertyId: `4${id.length}0001`,
  searchConsoleProperty: null,
  ...extra,
});

/** Readers that answer every site the same way, unless `per` says otherwise. */
function readers(opts: {
  visits?: (s: TrafficSiteInput, r: TrafficWindow) => Promise<Map<string, number>>;
  search?: (
    s: TrafficSiteInput,
    r: TrafficWindow,
  ) => Promise<Map<string, { clicks: number; impressions: number }>>;
}): TrafficReaders {
  return {
    visits: opts.visits ?? (async (_s, r) => flat(r, 2)),
    search:
      opts.search ??
      (async (_s, r) => new Map(datesIn(r).map((d) => [d, { clicks: 1, impressions: 10 }]))),
  };
}

describe("trafficWindows", () => {
  it("gives the literal windows for the night, the probe's 10-17 to 11-13 included", () => {
    expect(trafficWindows(NIGHT)).toEqual({
      current: { startDate: "2026-10-18", endDate: "2026-11-16" },
      previous: { startDate: "2026-09-18", endDate: "2026-10-17" },
      search: { startDate: "2026-10-17", endDate: "2026-11-13" },
    });
  });

  it("is a pure function of the night, not of the clock", () => {
    const spy = vi.spyOn(Date, "now").mockReturnValue(Date.parse("2030-01-01T00:00:00Z"));
    expect(trafficWindows(NIGHT).current.endDate).toBe("2026-11-16");
    spy.mockRestore();
  });
});

describe("readTraffic", () => {
  it("sums three sites that all read, with 60 and 28 daily entries, oldest first", async () => {
    const sites = [site("alpha"), site("bravo"), site("charlie")];
    const perSite: Record<string, number> = { alpha: 2, bravo: 3, charlie: 5 };
    const out = await readTraffic(
      sites,
      NIGHT,
      readers({
        visits: async (s, r) => flat(r, perSite[s.id]!),
        search: async (s, r) =>
          new Map(datesIn(r).map((d) => [d, { clicks: perSite[s.id]!, impressions: 10 }])),
      }),
    );

    expect(out.visits.value).toMatchObject({
      current: 30 * 10,
      previous: 30 * 10,
      sitesRead: 3,
      sitesWithProperty: 3,
    });
    const v = out.visits.value!;
    expect(v.daily).toHaveLength(60);
    expect(v.daily[0]!.date).toBe("2026-09-18");
    expect(v.daily[59]!.date).toBe("2026-11-16");
    expect(v.daily.every((d) => d.visits === 10)).toBe(true);

    expect(out.search.value).toMatchObject({
      clicks: 28 * 10,
      impressions: 28 * 30,
      sitesRead: 3,
      sitesWithProperty: 3,
    });
    const s = out.search.value!;
    expect(s.daily).toHaveLength(28);
    expect(s.daily[0]!.date).toBe("2026-10-17");
    expect(s.daily[27]!.date).toBe("2026-11-13");
    expect(s.daily[0]).toEqual({ date: "2026-10-17", clicks: 10, impressions: 30 });

    expect(out.sites.map((x) => x.siteId)).toEqual(["alpha", "bravo", "charlie"]);
    expect(out.sites[2]!.visits.value).toEqual({ current: 150, previous: 150 });
  });

  it("splits the one 60-day read by date: 10-17 counts in previous, 10-18 in current", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({
        visits: async () =>
          new Map([
            ["2026-10-17", 100],
            ["2026-10-18", 1],
          ]),
      }),
    );
    expect(out.visits.value!.previous).toBe(100);
    expect(out.visits.value!.current).toBe(1);
  });

  it("writes 0 for a day no read site reported, and keeps the daily series whole", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({ visits: async () => new Map([["2026-11-01", 7]]) }),
    );
    const daily = out.visits.value!.daily;
    expect(daily).toHaveLength(60);
    expect(daily.find((d) => d.date === "2026-11-01")!.visits).toBe(7);
    expect(daily.filter((d) => d.visits === 0)).toHaveLength(59);
  });

  it("a site whose visits read throws is null with its message, and is left out of the totals", async () => {
    const out = await readTraffic(
      [site("alpha"), site("bravo"), site("charlie")],
      NIGHT,
      readers({
        visits: async (s, r) => {
          if (s.id === "bravo") throw new Error("GA quota gone");
          return flat(r, 2);
        },
      }),
    );
    const bravo = out.sites.find((x) => x.siteId === "bravo")!;
    expect(bravo.visits.value).toBeNull();
    expect(bravo.visits.reason).toBe("GA quota gone");
    expect(out.visits.value).toMatchObject({ current: 120, previous: 120, sitesRead: 2 });
    expect(out.visits.value!.sitesWithProperty).toBe(3);
    expect(out.visits.value!.daily.every((d) => d.visits === 4)).toBe(true);
  });

  it("a site with no GA4 property never calls the reader, and is in neither count", async () => {
    const visits = vi.fn(async (_s: TrafficSiteInput, r: TrafficWindow) => flat(r, 2));
    const out = await readTraffic(
      [site("alpha"), site("bravo", { ga4PropertyId: null }), site("charlie")],
      NIGHT,
      readers({ visits }),
    );
    expect(visits.mock.calls.map(([s]) => s.id)).not.toContain("bravo");
    expect(out.sites[1]!.visits).toEqual({ value: null, reason: "no GA4 property" });
    expect(out.visits.value).toMatchObject({ sitesRead: 2, sitesWithProperty: 2 });
  });

  it("a search read that throws is null with its message, and is left out of the totals", async () => {
    const out = await readTraffic(
      [site("alpha"), site("bravo"), site("charlie")],
      NIGHT,
      readers({
        search: async (s, r) => {
          if (s.id === "bravo") throw new Error("Search Console 503");
          return new Map(datesIn(r).map((d) => [d, { clicks: 1, impressions: 10 }]));
        },
      }),
    );
    expect(out.sites[1]!.search.value).toBeNull();
    expect(out.sites[1]!.search.reason).toBe("Search Console 503");
    expect(out.search.value).toMatchObject({ clicks: 56, sitesRead: 2, sitesWithProperty: 3 });
  });

  it("a site with no Search Console property and no URL never calls the search reader", async () => {
    const search = vi.fn(
      async (_s: TrafficSiteInput, r: TrafficWindow) =>
        new Map(datesIn(r).map((d) => [d, { clicks: 1, impressions: 1 }])),
    );
    const out = await readTraffic(
      [site("alpha"), site("bravo", { url: "", searchConsoleProperty: null })],
      NIGHT,
      readers({ search }),
    );
    expect(search.mock.calls.map(([s]) => s.id)).not.toContain("bravo");
    expect(out.sites[1]!.search).toEqual({
      value: null,
      reason: "no Search Console property",
    });
    expect(out.search.value).toMatchObject({ sitesRead: 1, sitesWithProperty: 1 });
  });

  // Group B (P1-87 PR 6, review round 1): a site with a URL but no Search Console property
  // is "no property", counted in neither count, and its subject's address is never stored.
  it("a site with a URL whose search reader finds no property is 'no Search Console property', out of sitesWithProperty", async () => {
    const out = await readTraffic(
      [site("alpha"), site("bravo")],
      NIGHT,
      readers({
        search: async (s, r) => {
          if (s.id === "bravo")
            throw new NoPropertyForSubjectError("tucker@reddoorla.com", "bravo.example");
          return new Map(datesIn(r).map((d) => [d, { clicks: 1, impressions: 10 }]));
        },
      }),
    );
    expect(out.sites[1]!.search).toEqual({ value: null, reason: "no Search Console property" });
    expect(out.search.value).toMatchObject({ sitesRead: 1, sitesWithProperty: 1 });
  });

  it("a reader error that names an address stores it as <account>, never the address", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({
        search: async () => {
          throw new Error("no Search Console property is visible to a@b.com");
        },
      }),
    );
    const reason = out.sites[0]!.search.reason ?? "";
    expect(reason).toContain("<account>");
    expect(reason).not.toContain("@");
    expect(reason).not.toContain("b.com");
  });

  // Review round 2, Group B (X5): two addresses in one message are each masked, and neither
  // the local part nor the domain of either is stored.
  it("a reader error that names two addresses stores <account> for each, and neither address", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({
        search: async () => {
          throw new Error("no Search Console property is visible to a@b.com or c@d.org");
        },
      }),
    );
    const reason = out.sites[0]!.search.reason ?? "";
    expect(reason.split("<account>")).toHaveLength(3);
    expect(reason).not.toContain("@");
    expect(reason).not.toContain("b.com");
    expect(reason).not.toContain("d.org");
  });

  it("a site with a URL but no recorded property is read: the reader may resolve one", async () => {
    const search = vi.fn(
      async (_s: TrafficSiteInput, r: TrafficWindow) =>
        new Map(datesIn(r).map((d) => [d, { clicks: 3, impressions: 4 }])),
    );
    const out = await readTraffic(
      [site("alpha", { searchConsoleProperty: null })],
      NIGHT,
      readers({ search }),
    );
    expect(search).toHaveBeenCalledTimes(1);
    expect(out.search.value).toMatchObject({ clicks: 84, sitesRead: 1, sitesWithProperty: 1 });
  });

  it("a reader that never resolves gives its site the timeout reason after 30 s; the rest are read", async () => {
    vi.useFakeTimers();
    try {
      const pending = readTraffic(
        [site("alpha"), site("bravo")],
        NIGHT,
        readers({
          visits: (s, r) =>
            s.id === "bravo" ? new Promise(() => {}) : Promise.resolve(flat(r, 2)),
        }),
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      // Fail on an assertion, not on the case's own timeout, when the read hangs.
      expect(settled).toBe(true);
      const out = await pending;
      const bravo = out.sites[1]!.visits;
      expect(bravo.value).toBeNull();
      expect(bravo.reason).toMatch(/timed out/);
      expect(out.visits.value).toMatchObject({ sitesRead: 1, sitesWithProperty: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reads at most 4 sites' reads at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const tracked = async <T>(value: T): Promise<T> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return value;
    };
    const sites = Array.from({ length: 10 }, (_, i) => site(`s${i}`));
    const out = await readTraffic(
      sites,
      NIGHT,
      readers({
        visits: (_s, r) => tracked(flat(r, 1)),
        search: (_s, r) =>
          tracked(new Map(datesIn(r).map((d) => [d, { clicks: 0, impressions: 0 }]))),
      }),
    );
    expect(peak).toBeLessThanOrEqual(4);
    expect(peak).toBeGreaterThan(1);
    expect(out.visits.value!.sitesRead).toBe(10);
  });

  it("with no readers (GA not configured), both halves are unmeasured with that reason", async () => {
    const out = await readTraffic([site("alpha")], NIGHT, null);
    expect(out.visits).toEqual({ value: null, reason: "GA not configured" });
    expect(out.search).toEqual({ value: null, reason: "GA not configured" });
    expect(out.sites[0]!.visits).toEqual({ value: null, reason: "GA not configured" });
    expect(out.sites[0]!.search).toEqual({ value: null, reason: "GA not configured" });
  });

  it("when every site with a property throws, the half is null with 'no site read'", async () => {
    const out = await readTraffic(
      [site("alpha"), site("bravo")],
      NIGHT,
      readers({
        visits: async () => {
          throw new Error("down");
        },
      }),
    );
    expect(out.visits).toEqual({ value: null, reason: "no site read" });
    expect(out.search.value).not.toBeNull();
  });
});

// Review round 1, Group E (P1-87 PR 6): the tests lens's majors and minors on the assembly.
describe("readTraffic: the review's assembly cases", () => {
  it("when every search read fails, the search half is null with 'no site read'", async () => {
    const out = await readTraffic(
      [site("alpha"), site("bravo")],
      NIGHT,
      readers({
        search: async () => {
          throw new Error("Search Console 500");
        },
      }),
    );
    expect(out.search).toEqual({ value: null, reason: "no site read" });
    expect(out.visits.value).not.toBeNull();
  });

  it("a visits read that resolves at 29 s is read: the per-site timeout is 30 s, not a few ms", async () => {
    vi.useFakeTimers();
    try {
      const pending = readTraffic(
        [site("alpha", { searchConsoleProperty: null, url: "" })],
        NIGHT,
        readers({
          visits: (_s, r) =>
            new Promise((resolve) => setTimeout(() => resolve(flat(r, 2)), 29_000)),
        }),
      );
      await vi.advanceTimersByTimeAsync(29_000);
      const out = await pending;
      expect(out.sites[0]!.visits.value).not.toBeNull();
      expect(out.visits.value).toMatchObject({ sitesRead: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("a visits read still pending at 29 999 ms is still pending; it times out at 30 s", async () => {
    vi.useFakeTimers();
    try {
      const pending = readTraffic(
        [site("alpha", { searchConsoleProperty: null, url: "" })],
        NIGHT,
        readers({ visits: () => new Promise(() => {}) }),
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      // Assert on a flag, so a block that never settles fails here and not on the case's timeout.
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect((await pending).sites[0]!.visits.reason).toMatch(/timed out after 30 s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a search read that never resolves gives the timeout reason at 30 s, and not before", async () => {
    vi.useFakeTimers();
    try {
      const pending = readTraffic(
        [site("alpha", { url: "", searchConsoleProperty: "sc-domain:alpha.example" })],
        NIGHT,
        readers({ search: () => new Promise(() => {}) }),
      );
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(settled).toBe(true);
      expect((await pending).sites[0]!.search.reason).toMatch(/timed out after 30 s/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("at most 4 reads are in flight by default, and the peak is exactly 4 over 20 sites", async () => {
    let inFlight = 0;
    let peak = 0;
    const sites = Array.from({ length: 20 }, (_, i) => site(`s${i}`, { url: "" }));
    await readTraffic(
      sites,
      NIGHT,
      readers({
        visits: async (_s, r) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          await new Promise((res) => setTimeout(res, 2));
          inFlight--;
          return flat(r, 1);
        },
      }),
    );
    expect(peak).toBe(4);
  });

  it("a concurrency of 0 is read as 1: every site is still read", async () => {
    const out = await readTraffic([site("a"), site("b"), site("c")], NIGHT, readers({}), {
      concurrency: 0,
    });
    expect(out.visits.value).toMatchObject({ sitesRead: 3 });
  });

  it("a search read on 3 of the 28 days gives 28 daily entries, with 0 on the other 25", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({
        search: async (_s, r) => {
          const days = datesIn(r).slice(0, 3);
          return new Map(days.map((d) => [d, { clicks: 2, impressions: 5 }]));
        },
      }),
    );
    expect(out.search.value!.daily).toHaveLength(28);
    expect(out.search.value!.daily.filter((d) => d.clicks === 0)).toHaveLength(25);
    expect(out.search.value!.daily.slice(0, 3).every((d) => d.clicks === 2)).toBe(true);
  });

  it("a reason is capped at 200 characters", async () => {
    const out = await readTraffic(
      [site("alpha")],
      NIGHT,
      readers({
        visits: async () => {
          throw new Error("x".repeat(500));
        },
      }),
    );
    expect(out.sites[0]!.visits.reason).toHaveLength(200);
  });
});
