import { describe, it, expect, beforeEach } from "vitest";
import { openDb, type Db } from "../../src/db/client.js";
import { writeDigestState } from "../../src/db/digest-state.js";
import { loadSiteAlarmContext } from "../../src/dashboard/site-alarm.js";
import { createDeadLetter } from "../../src/db/deadletter.js";
import { sql } from "kysely";
// The site page renders `buildSiteView`; the old string renderer went at the
// cutover (#582), and the alarm's markup is pinned in cockpit/tests/site.
import { buildSiteView } from "../../cockpit/src/lib/site/view.js";
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

/** OD 87: the site page still shows a held dead letter, as the `waiting:` chip
 *  #1199 gave a vuln Renovate is still fixing, read from the store end to end. */
describe("loadSiteAlarmContext — a held dead letter (OD 87)", () => {
  const clean = makeWebsiteRow({ ...site, securityVulnsCritical: 0 });
  const loadClean = () => loadSiteAlarmContext(db, clean, "acme", [], BASE, NOW);
  const deadLetterAt = (receivedAt: Date) =>
    createDeadLetter(db, {
      siteSlug: "acme",
      payload: { email: "ada@example.com" },
      turnstile: { outcome: "pass", hostname: "acme.example.com" },
      error: "Error: upstream 429 quota",
      receivedAt,
    });

  it("aged 3 h: on the page as a waiting chip, and not a tier", async () => {
    await deadLetterAt(new Date(NOW.getTime() - 3 * 60 * 60 * 1000));
    const alarm = (await loadClean())!;
    expect(alarm.tier).toBe("healthy");
    expect(alarm.items.map((i) => [i.key, i.waiting])).toEqual([["deadletter:acme", true]]);
    const view = buildSiteView(clean, [], [], null, NOW, alarm).alarm!;
    expect(view.chips.map((c) => [c.cls, c.text])).toEqual([
      ["chip waiting", expect.stringMatching(/^waiting: 1 lead dead-lettered 3 h ago/)],
    ]);
    expect(view.label).not.toBe("Needs attention");
  });

  it("a failed oldest-row read holds nothing: the page keeps its alarm", async () => {
    // Break only the hold's clock: the count still reads, received_at does not.
    await deadLetterAt(new Date(NOW.getTime() - 3 * 60 * 60 * 1000));
    await sql`DROP INDEX idx_deadletter_slug_received`.execute(db);
    await sql`ALTER TABLE submission_deadletter DROP COLUMN received_at`.execute(db);
    const alarm = await loadClean();
    expect(alarm).not.toBeNull();
    expect(alarm!.tier).toBe("attention");
    expect(alarm!.items.map((i) => [i.key, i.waiting])).toEqual([["deadletter:acme", undefined]]);
  });

  it("aged 12 h by its OLDEST row: an alarm, though a newer row just landed", async () => {
    await deadLetterAt(new Date(NOW.getTime() - 12 * 60 * 60 * 1000));
    await deadLetterAt(new Date(NOW.getTime() - 60 * 1000));
    const alarm = (await loadClean())!;
    expect(alarm.tier).toBe("attention");
    expect(alarm.items[0]!.waiting).toBeUndefined();
    expect(alarm.items[0]!.title).toMatch(
      /^2 leads dead-lettered, the oldest not replayed for 12 h/,
    );
  });
});
