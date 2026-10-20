/** MED-11 (2026-09-02): the `/s/:slug` dead-letter chip. OD 87 (2026-10-20): the
 *  hold's clock, the oldest unreplayed row's `received_at`, on the same index.
 *
 *  The EXPLAIN-query-plan gate cannot see this one. Both the fleet-wide grouped
 *  query and the per-slug replacement plan as a `SEARCH`, so `rawScanTables`
 *  passes either way — but served by 0005's `idx_deadletter_unreplayed
 *  (replayed_at)` the per-slug query visits every unreplayed row in the FLEET
 *  and does a rowid lookup into the payload-bearing table for each, then throws
 *  away the ones belonging to other sites. `countUnreplayedDeadLettersBySlug`'s
 *  own docblock says an alarm "must never pull a client's PII into a dashboard
 *  request just to learn how many rows there are"; that is exactly what the
 *  0028-less plan does. 0044 replaced 0028's index with one that also carries
 *  `received_at` (and 0045 dropped 0028's, a strict prefix of it).
 *
 *  So the index is asserted directly, in both directions: with the slug index the
 *  plan is a COVERING seek on `site_slug`; with it dropped the same query falls back
 *  to the fleet-wide traversal. Without the second half this file would be a
 *  check that can only ever pass.
 */
import { describe, it, expect } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";
import {
  countUnreplayedDeadLettersBySlug,
  oldestUnreplayedDeadLetterBySlug,
  oldestUnreplayedDeadLetterForSlug,
} from "../../src/db/deadletter.js";
import { openCapturingDb, explainQueryPlan, type CapturingDb } from "./query-plan-harness.js";

const PER_SLUG_SQL = `SELECT count(*) AS n FROM submission_deadletter
   WHERE site_slug = ? AND replayed_at IS NULL AND abandoned_at IS NULL`;

async function plan(client: Client, sql: string, args: unknown[]): Promise<string> {
  const res = await client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: args as never[] });
  return res.rows.map((r) => String(r.detail)).join(" | ");
}

describe("the per-slug dead-letter count is served by its own index (0044, after 0028)", () => {
  it("seeks on site_slug, covering, touching no payload row", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    const detail = await plan(client, PER_SLUG_SQL, ["acme"]);
    expect(detail).toContain("idx_deadletter_slug_received");
    expect(detail).toContain("site_slug=?");
    // COVERING means the count never leaves the index for the row — the rows
    // carry full lead payloads.
    expect(detail).toContain("COVERING INDEX");
  });

  it("without that index the same query traverses the fleet's whole unreplayed queue", async () => {
    // The known-bad control. If this ever stops differing from the case above,
    // the assertion above has stopped measuring anything.
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    await client.execute("DROP INDEX idx_deadletter_slug_received");
    const detail = await plan(client, PER_SLUG_SQL, ["acme"]);
    expect(detail).not.toContain("idx_deadletter_slug_received");
    expect(detail).not.toContain("site_slug=?");
    // Falls back to the replayed_at index — every unreplayed row in the fleet.
    expect(detail).toContain("idx_deadletter_unreplayed");
  });
});

describe("the hold's clock costs no more than the count it sits beside (OD 87, 0044)", () => {
  // Planned from the SQL the real functions issue (captured at the driver), so a
  // change to either function's builder is measured, not a hand-written copy.
  async function planOf(run: (db: CapturingDb["db"]) => Promise<unknown>, dropIndex = false) {
    const h = await openCapturingDb();
    if (dropIndex) {
      await h.client.execute("DROP INDEX idx_deadletter_slug_received");
      await h.client.execute(
        "CREATE INDEX idx_deadletter_slug_unreplayed ON submission_deadletter (site_slug, replayed_at, abandoned_at)",
      );
    }
    const before = h.captured.length;
    await run(h.db);
    const stmts = h.captured.slice(before);
    expect(stmts).toHaveLength(1);
    return (await explainQueryPlan(h.client, stmts[0]!)).join(" | ");
  }

  it("per slug: min(received_at) is a COVERING seek, touching no payload row", async () => {
    const detail = await planOf((db) => oldestUnreplayedDeadLetterForSlug(db, "acme"));
    expect(detail).toContain("COVERING INDEX idx_deadletter_slug_received");
    expect(detail).toContain("site_slug=?");
  });

  it("fleet-wide: the same plan as countUnreplayedDeadLettersBySlug", async () => {
    // Measured 2026-10-20: without ANALYZE stats SQLite serves the grouped count
    // from 0005's `idx_deadletter_unreplayed (replayed_at)` and a rowid lookup per
    // unreplayed row, and the grouped min the same way. The gate asks for no MORE
    // than the count already costs on the cockpit request.
    const count = await planOf((db) => countUnreplayedDeadLettersBySlug(db));
    expect(await planOf((db) => oldestUnreplayedDeadLetterBySlug(db))).toBe(count);
  });

  it("0028's three-column index cannot cover the per-slug min (the control: why 0044 exists)", async () => {
    // received_at is not in 0028's index, so with only that index SQLite has to
    // visit the payload-bearing row for every unreplayed dead letter of the slug.
    const detail = await planOf((db) => oldestUnreplayedDeadLetterForSlug(db, "acme"), true);
    expect(detail).toContain("idx_deadletter_slug_unreplayed");
    expect(detail).not.toContain("COVERING INDEX");
  });
});
