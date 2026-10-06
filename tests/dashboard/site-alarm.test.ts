import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/client.js";
import { writeDigestState } from "../../src/db/digest-state.js";
import { loadSiteAlarmContext } from "../../src/dashboard/site-alarm.js";
import { makeWebsiteRow } from "../_helpers/website-row.js";

const NOW = new Date("2026-10-05T12:00:00Z");
const BASE = "https://reddoor-maintenance.netlify.app";

const site = makeWebsiteRow({
  id: "recA",
  name: "Acme",
  pointOfContact: "Tucker",
  ga4PropertyId: "123456789",
  gitRepo: "reddoorla/acme",
  netlifyId: "11111111-2222-3333-4444-555555555555",
  pScore: 95,
  rScore: 95,
  bpScore: 95,
  seoScore: 95,
  securityVulnsCritical: 1,
  securityVulnsHigh: 0,
});

let db: Db;
beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

const load = () => loadSiteAlarmContext(db, site, "acme", [], BASE, NOW);

describe("loadSiteAlarmContext reads the digest snapshot the cockpit reads", () => {
  it("a vuln first flagged yesterday is waiting: shown, but not a tier", async () => {
    await writeDigestState(db, { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-10-04" } });
    const alarm = (await load())!;
    expect(alarm.tier).toBe("healthy");
    expect(alarm.items.map((i) => [i.key, i.waiting])).toEqual([["vuln:recA", true]]);
  });

  it("the same vuln first flagged weeks ago is an alarm (positive control)", async () => {
    await writeDigestState(db, { "vuln:recA": { metric: 1, firstFlaggedAt: "2026-09-01" } });
    const alarm = (await load())!;
    expect(alarm.tier).toBe("attention");
    expect(alarm.items.map((i) => [i.key, i.waiting])).toEqual([["vuln:recA", undefined]]);
  });

  it("with no snapshot row, nothing waits", async () => {
    expect((await load())!.tier).toBe("attention");
  });
});
