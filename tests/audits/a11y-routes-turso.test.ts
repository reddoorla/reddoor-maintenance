import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { mirrorSiteInsert, mirrorHealthFields, getSiteBySlug } from "../../src/db/fleet-state.js";
import { writeBackOneSite } from "../../src/audits/write-audits.js";
import type { AuditResult } from "../../src/types.js";

const a11yRun = (scanned: number, total: number, skipped: unknown[] = []): AuditResult =>
  ({
    audit: "a11y",
    site: "acme",
    status: "pass",
    summary: "ok",
    details: { totalViolations: 0, byImpact: {}, skipped, routes: { scanned, total } },
  }) as unknown as AuditResult;

async function roundTrip(results: AuditResult[]) {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(
    db,
    { id: "recACME", fields: { Name: "Acme", "A11y Routes Scanned": 9, "A11y Routes Total": 9 } },
    "2026-09-29T00:00:00.000Z",
  );
  const before = await getSiteBySlug(db, "acme");
  await writeBackOneSite({
    websites: [before!],
    slug: "acme",
    results,
    mirrorHealth: (id, fields) => mirrorHealthFields(db, id, fields),
  });
  const row = await getSiteBySlug(db, "acme");
  await db.destroy();
  return row!;
}

describe("a11y route coverage through Turso (#910)", () => {
  it("a 1-of-2 run and a 2-of-2 run with the same violation count read back differently", async () => {
    const partial = await roundTrip([a11yRun(1, 2)]);
    const complete = await roundTrip([a11yRun(2, 2)]);
    expect(partial.a11yViolations).toBe(0);
    expect(complete.a11yViolations).toBe(0);
    expect([partial.a11yRoutesScanned, partial.a11yRoutesTotal]).toEqual([1, 2]);
    expect([complete.a11yRoutesScanned, complete.a11yRoutesTotal]).toEqual([2, 2]);
  });

  it("a run that scanned 0 of 2 routes stores 0, not NULL", async () => {
    const row = await roundTrip([a11yRun(0, 2)]);
    expect([row.a11yRoutesScanned, row.a11yRoutesTotal]).toEqual([0, 2]);
  });

  it("a run whose details carry no route counts clears yesterday's, never keeps them", async () => {
    const legacy = {
      ...a11yRun(0, 0),
      details: { totalViolations: 0, byImpact: {} },
    } as unknown as AuditResult;
    const row = await roundTrip([legacy]);
    expect(row.a11yViolations).toBe(0);
    expect(row.a11yRoutesScanned).toBeNull();
    expect(row.a11yRoutesTotal).toBeNull();
  });

  it("the skipped routes are stored beside the counts, route and reason only", async () => {
    const row = await roundTrip([
      a11yRun(1, 2, [{ route: "/about", path: "/about", status: 500, reason: "status 500" }]),
    ]);
    expect([row.a11yRoutesScanned, row.a11yRoutesTotal]).toEqual([1, 2]);
    expect(row.a11yRoutesSkipped).toEqual([{ route: "/about", reason: "status 500" }]);
  });

  it("a run that skipped nothing stores an empty list, not NULL", async () => {
    const row = await roundTrip([a11yRun(2, 2)]);
    expect(row.a11yRoutesSkipped).toEqual([]);
  });

  it("a run whose details carry no skip list clears the stored one", async () => {
    const legacy = {
      ...a11yRun(2, 2),
      details: { totalViolations: 0, byImpact: {}, routes: { scanned: 2, total: 2 } },
    } as unknown as AuditResult;
    const row = await roundTrip([legacy]);
    expect(row.a11yRoutesSkipped).toBeNull();
  });
});
