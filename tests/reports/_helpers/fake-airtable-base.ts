import type { AirtableBase } from "../../../src/reports/airtable/client.js";

/**
 * Calls captured by the fake. Tests assert against these.
 * Each entry records the table + method + payload.
 */
export type CapturedCall =
  | { kind: "select"; table: string; opts: Record<string, unknown> }
  | { kind: "create"; table: string; records: Array<{ fields: Record<string, unknown> }> }
  | { kind: "update"; table: string; records: Array<{ id: string; fields: Record<string, unknown> }> };

export type FakeRecord = { id: string; fields: Record<string, unknown> };

export type FakeAirtableBase = AirtableBase & {
  /** Every select/create/update call, in order. */
  __calls: CapturedCall[];
  /** Mutable per-table record store. select() returns what's here; create() appends. */
  __records: Map<string, FakeRecord[]>;
};

/**
 * Build a typed fake AirtableBase suitable for injecting into orchestrators.
 * Seed records per table via `seed`; tests assert on `base.__calls` + `base.__records`.
 *
 * Limitations (intentional — tests should seed only what they need):
 * - filterByFormula is NOT evaluated. Tests seed exactly the rows they want returned.
 * - Pagination always returns one page.
 * - The fake is purely sync internally; the methods return promises to match the SDK.
 */
export function makeFakeBase(seed: Record<string, FakeRecord[]> = {}): FakeAirtableBase {
  const calls: CapturedCall[] = [];
  const records = new Map<string, FakeRecord[]>();
  for (const [table, rs] of Object.entries(seed)) records.set(table, [...rs]);

  const tableFn = (table: string) => {
    const ensure = () => {
      if (!records.has(table)) records.set(table, []);
      return records.get(table)!;
    };
    return {
      select: (opts: Record<string, unknown> = {}) => ({
        eachPage: async (
          cb: (recs: FakeRecord[], next: () => void) => void,
        ): Promise<void> => {
          calls.push({ kind: "select", table, opts });
          cb(ensure(), () => {});
        },
      }),
      create: async (recs: Array<{ fields: Record<string, unknown> }>) => {
        calls.push({ kind: "create", table, records: recs });
        const tableRecs = ensure();
        const created = recs.map((r, i) => ({
          id: `rec_fake_${calls.length}_${i}`,
          fields: { ...r.fields },
        }));
        tableRecs.push(...created);
        return created;
      },
      update: async (recs: Array<{ id: string; fields: Record<string, unknown> }>) => {
        calls.push({ kind: "update", table, records: recs });
        const tableRecs = ensure();
        for (const r of recs) {
          const idx = tableRecs.findIndex((x) => x.id === r.id);
          if (idx >= 0) {
            tableRecs[idx] = { id: r.id, fields: { ...tableRecs[idx]!.fields, ...r.fields } };
          }
        }
        return recs.map((r) => ({ id: r.id, fields: r.fields }));
      },
    };
  };

  const base = tableFn as unknown as FakeAirtableBase;
  base.__calls = calls;
  base.__records = records;
  return base;
}
