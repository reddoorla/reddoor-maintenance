import type { FieldSet } from "airtable";
import type { AirtableBase } from "./client.js";

export const SCREENOUTS_TABLE = "Spam Screenouts";

export type ScreenOutReason = "honeypot" | "too-fast";
export type ScreenOutTotals = { honeypot: number; tooFast: number; markedSpam: number };

const REASON_FIELD: Record<ScreenOutReason, "Honeypot" | "Too-fast"> = {
  honeypot: "Honeypot",
  "too-fast": "Too-fast",
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function siteIdOf(fields: Record<string, unknown>): string {
  const link = fields["Site"] as string[] | undefined;
  return link?.[0] ?? "";
}

/** Find the (site, date) bucket via filterByFormula and confirm in JS (the test fake
 *  ignores the formula). Returns the first matching record id + fields, or null. */
async function findBucket(
  base: AirtableBase,
  siteId: string,
  date: string,
): Promise<{ id: string; fields: Record<string, unknown> } | null> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  await base(SCREENOUTS_TABLE)
    .select({ filterByFormula: `{Date} = ${JSON.stringify(date)}`, pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  return rows.find((r) => r.fields["Date"] === date && siteIdOf(r.fields) === siteId) ?? null;
}

async function bumpField(
  base: AirtableBase,
  siteId: string,
  date: string,
  field: "Honeypot" | "Too-fast" | "Marked spam",
): Promise<void> {
  const existing = await findBucket(base, siteId, date);
  if (existing) {
    const next = num(existing.fields[field]) + 1;
    await base(SCREENOUTS_TABLE).update([
      { id: existing.id, fields: { [field]: next } as FieldSet },
    ]);
  } else {
    await base(SCREENOUTS_TABLE).create([
      { fields: { Site: [siteId], Date: date, [field]: 1 } as FieldSet },
    ]);
  }
}

/** Upsert-increment the caught counter for a screen reason on the (site, date) bucket. */
export async function recordScreenOut(
  base: AirtableBase,
  siteId: string,
  reason: ScreenOutReason,
  date: string,
): Promise<void> {
  await bumpField(base, siteId, date, REASON_FIELD[reason]);
}

/** Upsert-increment the "got through, marked spam" counter on the (site, date) bucket. */
export async function recordMarkedSpam(
  base: AirtableBase,
  siteId: string,
  date: string,
): Promise<void> {
  await bumpField(base, siteId, date, "Marked spam");
}

/** Sum buckets with Date >= since, per site. Duplicate same-day buckets sum naturally,
 *  so the create-race in the upsert can never corrupt the totals. */
export async function listScreenOutsSince(
  base: AirtableBase,
  sinceDate: string,
): Promise<Map<string, ScreenOutTotals>> {
  const out = new Map<string, ScreenOutTotals>();
  await base(SCREENOUTS_TABLE)
    .select({ filterByFormula: `{Date} >= ${JSON.stringify(sinceDate)}`, pageSize: 100 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) {
        const f = rec.fields;
        const date = typeof f["Date"] === "string" ? (f["Date"] as string) : "";
        if (date < sinceDate) continue; // JS-confirm the window (fake ignores the formula)
        const siteId = siteIdOf(f);
        if (!siteId) continue;
        const cur = out.get(siteId) ?? { honeypot: 0, tooFast: 0, markedSpam: 0 };
        cur.honeypot += num(f["Honeypot"]);
        cur.tooFast += num(f["Too-fast"]);
        cur.markedSpam += num(f["Marked spam"]);
        out.set(siteId, cur);
      }
      fetchNextPage();
    });
  return out;
}

/** The ISO date (YYYY-MM-DD) `days` before `now`, for the window queries. */
export function screenOutsSince(now: Date, days: number): string {
  const d = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
