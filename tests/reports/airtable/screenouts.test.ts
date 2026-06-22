import { describe, it, expect } from "vitest";
import type { AirtableBase } from "../../../src/reports/airtable/client.js";
import {
  recordScreenOut,
  recordMarkedSpam,
  listScreenOutsSince,
} from "../../../src/reports/airtable/screenouts.js";

type Rec = { id: string; fields: Record<string, unknown> };

/** Fake base supporting select().eachPage / .all, create, update — enough for the
 *  get-or-create upsert and the windowed read. filterByFormula is IGNORED (like the
 *  real test fakes), so the code must confirm matches in JS. */
function makeFakeBase(seed: Rec[] = []) {
  const rows: Rec[] = seed.map((r) => ({ id: r.id, fields: { ...r.fields } }));
  let n = rows.length;
  const calls = { creates: 0, updates: 0 };
  const tableFn = (_t: string) => ({
    select: () => ({
      all: async () =>
        rows.map((r) => ({ id: r.id, fields: r.fields, get: (k: string) => r.fields[k] })),
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(
          rows.map((r) => ({ id: r.id, fields: r.fields })),
          () => {},
        );
      },
    }),
    create: async (recs: Array<{ fields: Record<string, unknown> }>) => {
      const created = recs.map((rc) => ({ id: `rec${++n}`, fields: { ...rc.fields } }));
      rows.push(...created);
      calls.creates++;
      return created;
    },
    update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
      for (const u of recs) {
        const row = rows.find((r) => r.id === u.id);
        if (row) Object.assign(row.fields, u.fields);
      }
      calls.updates++;
      return recs;
    },
  });
  return { base: tableFn as unknown as AirtableBase, rows, calls };
}

describe("recordScreenOut", () => {
  it("creates a bucket with the reason count = 1 when none exists", async () => {
    const { base, rows } = makeFakeBase();
    await recordScreenOut(base, "recSITE", "honeypot", "2026-06-22");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fields).toMatchObject({
      Site: ["recSITE"],
      Date: "2026-06-22",
      Honeypot: 1,
    });
  });

  it("increments the existing bucket's reason count", async () => {
    const { base, rows, calls } = makeFakeBase([
      { id: "recB", fields: { Site: ["recSITE"], Date: "2026-06-22", Honeypot: 3, "Too-fast": 1 } },
    ]);
    await recordScreenOut(base, "recSITE", "too-fast", "2026-06-22");
    expect(calls.creates).toBe(0);
    expect(rows[0]!.fields["Too-fast"]).toBe(2);
    expect(rows[0]!.fields["Honeypot"]).toBe(3);
  });
});

describe("recordMarkedSpam", () => {
  it("increments Marked spam on the day's bucket (creating it if needed)", async () => {
    const { base, rows } = makeFakeBase();
    await recordMarkedSpam(base, "recSITE", "2026-06-22");
    expect(rows[0]!.fields["Marked spam"]).toBe(1);
  });
});

describe("listScreenOutsSince", () => {
  it("sums per site across buckets in the window (incl. duplicate same-day buckets)", async () => {
    const { base } = makeFakeBase([
      {
        id: "r1",
        fields: {
          Site: ["recA"],
          Date: "2026-06-20",
          Honeypot: 2,
          "Too-fast": 1,
          "Marked spam": 0,
        },
      },
      {
        id: "r2",
        fields: {
          Site: ["recA"],
          Date: "2026-06-21",
          Honeypot: 3,
          "Too-fast": 0,
          "Marked spam": 2,
        },
      },
      {
        id: "r3",
        fields: {
          Site: ["recB"],
          Date: "2026-06-21",
          Honeypot: 1,
          "Too-fast": 0,
          "Marked spam": 0,
        },
      },
      {
        id: "r4",
        fields: {
          Site: ["recA"],
          Date: "2026-05-01",
          Honeypot: 9,
          "Too-fast": 9,
          "Marked spam": 9,
        },
      }, // before window
    ]);
    const map = await listScreenOutsSince(base, "2026-06-01");
    expect(map.get("recA")).toEqual({ honeypot: 5, tooFast: 1, markedSpam: 2 });
    expect(map.get("recB")).toEqual({ honeypot: 1, tooFast: 0, markedSpam: 0 });
  });
});
