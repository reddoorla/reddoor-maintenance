// src/alerts/digest-state.ts
import type { FieldSet } from "airtable";
import type { AirtableBase } from "../reports/airtable/client.js";
import type { AttentionItem } from "../reports/digest.js";

/**
 * The persisted prior-run snapshot: stable item `key` → its last metric + the
 * date it was FIRST flagged. Lives as JSON in the single "Digest State" Airtable
 * row (the IO that loads/stores it — readDigestState/writeDigestState — is added
 * in component 2). `next` from diffAttention is what gets written back.
 */
export type DigestSnapshot = Record<string, { metric: number; firstFlaggedAt: string }>;

/**
 * PURE diff — the testable core of the hybrid "snapshot now, mark what's new".
 * For each current item vs the prior snapshot:
 *   - key absent from prior            → NEW      (firstFlaggedAt = today)
 *   - present and metric > prior.metric → WORSE    (keep the original firstFlaggedAt)
 *   - otherwise (equal or dropped)      → STANDING (keep the original firstFlaggedAt)
 * `next` contains EXACTLY the current items' keys: resolved keys drop out, so a
 * fixed-then-recurring problem re-news correctly. Neither input is mutated.
 */
export function diffAttention(
  items: AttentionItem[],
  prior: DigestSnapshot,
  today: string,
): { tagged: AttentionItem[]; next: DigestSnapshot } {
  const tagged: AttentionItem[] = [];
  const next: DigestSnapshot = {};
  for (const it of items) {
    const was = prior[it.key];
    let status: AttentionItem["status"];
    let firstFlaggedAt: string;
    if (!was) {
      status = "new";
      firstFlaggedAt = today;
    } else if (it.metric > was.metric) {
      status = "worse";
      firstFlaggedAt = was.firstFlaggedAt;
    } else {
      status = "standing";
      firstFlaggedAt = was.firstFlaggedAt;
    }
    tagged.push({ ...it, status });
    next[it.key] = { metric: it.metric, firstFlaggedAt };
  }
  return { tagged, next };
}

/** The single-row Airtable table that persists the prior digest snapshot. */
export const DIGEST_STATE_TABLE = "Digest State";

/**
 * Read the persisted prior snapshot from the "Digest State" singleton.
 *
 * Reads the FIRST row of an unfiltered select (the table holds exactly one row;
 * the test fake does not evaluate filterByFormula, so we never rely on one). A
 * read miss (no row) OR a parse error (malformed Snapshot JSON) collapses to `{}`
 * — every key then reads as NEW once, which is safe degradation (never crashes
 * the digest).
 */
export async function readDigestState(base: AirtableBase): Promise<DigestSnapshot> {
  const rows: { id: string; fields: Record<string, unknown> }[] = [];
  await base(DIGEST_STATE_TABLE)
    .select({ maxRecords: 1, pageSize: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id, fields: rec.fields });
      fetchNextPage();
    });
  const first = rows[0];
  if (!first) return {};
  const raw = first.fields["Snapshot"];
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw) as DigestSnapshot;
  } catch {
    return {};
  }
}

/**
 * Persist the next snapshot to the "Digest State" singleton: get-or-create the
 * one row. If a row exists, UPDATE it (keyed by its record id); otherwise CREATE
 * one. `Snapshot` = JSON.stringify(snap); `Updated At` = the injected ISO
 * timestamp (or now). A caller that catches+logs a write failure keeps the
 * already-sent digest unaffected (next run re-news at worst).
 */
export async function writeDigestState(
  base: AirtableBase,
  snap: DigestSnapshot,
  updatedAt: string = new Date().toISOString(),
): Promise<void> {
  const rows: { id: string }[] = [];
  await base(DIGEST_STATE_TABLE)
    .select({ maxRecords: 1, pageSize: 1 })
    .eachPage((records, fetchNextPage) => {
      for (const rec of records) rows.push({ id: rec.id });
      fetchNextPage();
    });
  const fields: FieldSet = {
    Snapshot: JSON.stringify(snap),
    "Updated At": updatedAt,
  };
  const existing = rows[0];
  if (existing) {
    await base(DIGEST_STATE_TABLE).update([{ id: existing.id, fields }]);
  } else {
    await base(DIGEST_STATE_TABLE).create([{ fields }]);
  }
}
