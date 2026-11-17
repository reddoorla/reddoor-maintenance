/**
 * P1-87 PR 6, review round 1 (Group D): the wiring between the script and the traffic
 * block is tested. The script keeps only the IO; `trafficReaders`, `trafficSites` and
 * `trafficNight` are pure, with the two client functions and the key file's existence
 * injected, so no test reaches Google or the disk.
 */
import { describe, it, expect, vi } from "vitest";
import {
  trafficNight,
  trafficReaders,
  trafficSites,
  type TrafficWiringDeps,
} from "../../src/fleet-daily/traffic-wiring.js";
import type { GaConfig } from "../../src/reports/ga/config.js";

const cfg: GaConfig = { subjects: ["reports@reddoorla.com"], keyPath: "/run/ga-key.json" };

function deps(over: Partial<TrafficWiringDeps> = {}): TrafficWiringDeps & {
  visits: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
} {
  const visits = vi.fn(async () => new Map<string, number>());
  const search = vi.fn(async () => new Map<string, { clicks: number; impressions: number }>());
  return {
    fetchDailyEngaged: visits as unknown as TrafficWiringDeps["fetchDailyEngaged"],
    fetchSearchDaily: search as unknown as TrafficWiringDeps["fetchSearchDaily"],
    existsSync: () => true,
    ...over,
    visits,
    search,
  };
}

const acme = {
  id: "acme",
  url: "https://www.acme.com/",
  ga4PropertyId: "471880366",
  searchConsoleProperty: "sc-domain:acme.com",
};
const range = { startDate: "2026-10-18", endDate: "2026-11-16" };

describe("trafficReaders", () => {
  it("is null when GA is not configured", () => {
    expect(trafficReaders(null, deps())).toBeNull();
  });

  it("is null when the key file is not there, so the block reads 'GA not configured'", () => {
    expect(trafficReaders(cfg, deps({ existsSync: () => false }))).toBeNull();
  });

  it("the visits reader calls fetchDailyEngaged with the site's own hosts, key, subjects and property", async () => {
    const d = deps();
    const readers = trafficReaders(cfg, d)!;
    await readers.visits(acme, range);
    expect(d.visits).toHaveBeenCalledWith(
      {
        propertyId: "471880366",
        subjects: ["reports@reddoorla.com"],
        keyPath: "/run/ga-key.json",
        hostnames: ["acme.com", "www.acme.com"],
      },
      range,
    );
  });

  it("the search reader calls fetchSearchDaily with the host from the URL and the recorded property", async () => {
    const d = deps();
    const readers = trafficReaders(cfg, d)!;
    await readers.search(acme, range);
    expect(d.search).toHaveBeenCalledWith(
      {
        keyPath: "/run/ga-key.json",
        subjects: ["reports@reddoorla.com"],
        property: "sc-domain:acme.com",
        host: "www.acme.com",
      },
      range,
    );
  });
});

describe("trafficSites", () => {
  it("keeps only the maintained sites, in the order given", () => {
    const rows = [
      { ...acme, status: "maintained" },
      { ...acme, id: "launch", status: "launching" },
      { ...acme, id: "old", status: "archived" },
      { ...acme, id: "two", status: "maintained" },
    ];
    expect(trafficSites(rows).map((s) => s.id)).toEqual(["acme", "two"]);
  });

  it("carries the four fields the reads need, and no others", () => {
    const [site] = trafficSites([{ ...acme, status: "maintained", name: "Acme" }]);
    expect(site).toEqual({
      id: "acme",
      url: "https://www.acme.com/",
      ga4PropertyId: "471880366",
      searchConsoleProperty: "sc-domain:acme.com",
    });
  });
});

describe("trafficNight", () => {
  it("is the night of the run's creation time, not the clock", () => {
    expect(trafficNight({ RUN_CREATED_AT: "2026-11-17T06:07:00Z" })).toBe("2026-11-16");
  });

  it("throws when the run's creation time is not set", () => {
    expect(() => trafficNight({})).toThrow(/RUN_CREATED_AT/);
  });
});
