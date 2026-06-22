import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { listScreenOutsSince } from "../../src/db/screenouts.js";
import { backfillScreenouts } from "../../src/db/backfill.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(rows: Rec[]) {
  const tableFn = (_t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(rows, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

describe("backfillScreenouts (Airtable → libSQL)", () => {
  it("merges duplicate same-day buckets and is idempotent on re-run", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([
      { id: "r1", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 2, "Too-fast": 1 } },
      { id: "r2", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 3 } }, // dup same day
      { id: "r3", fields: { Site: ["recB"], Date: "2026-06-21", "Marked spam": 4 } },
    ]);
    await backfillScreenouts(base, db);
    let map = await listScreenOutsSince(db, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 0 });
    expect(map.get("recB")).toEqual({ honeypot: 0, tooFast: 0, markedSpam: 4 });

    // Re-run: counts must NOT double (replace-upsert on a pre-aggregated value).
    await backfillScreenouts(base, db);
    map = await listScreenOutsSince(db, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 0 });
  });
});
