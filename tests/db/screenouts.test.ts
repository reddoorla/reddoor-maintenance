import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  recordScreenOut,
  recordMarkedSpam,
  listScreenOutsSince,
  screenOutsSince,
} from "../../src/db/screenouts.js";

describe("db recordScreenOut (atomic upsert)", () => {
  it("creates the bucket at 1 then increments in place", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "too-fast", "2026-06-22");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals).toEqual({ honeypot: 2, tooFast: 1, markedSpam: 0 });
  });

  it("counts exactly under concurrent calls for the same (site, date)", async () => {
    const db = await openDb({ url: ":memory:" });
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () => recordScreenOut(db, "recSITE", "honeypot", "2026-06-22")),
    );
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals.honeypot).toBe(N);
  });
});

describe("db recordMarkedSpam", () => {
  it("increments marked_spam on the day's bucket", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordMarkedSpam(db, "recSITE", "2026-06-22");
    await recordMarkedSpam(db, "recSITE", "2026-06-22");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals.markedSpam).toBe(2);
  });
});

describe("db listScreenOutsSince", () => {
  it("sums per site across the window and excludes earlier dates", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recA", "honeypot", "2026-06-20");
    await recordScreenOut(db, "recA", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recB", "too-fast", "2026-06-21");
    await recordScreenOut(db, "recA", "honeypot", "2026-05-01"); // before the window
    const map = await listScreenOutsSince(db, "2026-06-15");
    expect(map.get("recA")).toEqual({ honeypot: 2, tooFast: 0, markedSpam: 0 });
    expect(map.get("recB")).toEqual({ honeypot: 0, tooFast: 1, markedSpam: 0 });
  });
});

describe("screenOutsSince", () => {
  it("returns the YYYY-MM-DD `days` before now", () => {
    expect(screenOutsSince(new Date("2026-06-22T00:00:00.000Z"), 30)).toBe("2026-05-23");
  });
});
