/** MED-11 (2026-09-02): the `/s/:slug` dead-letter chip.
 *
 *  The EXPLAIN-query-plan gate cannot see this one. Both the fleet-wide grouped
 *  query and the per-slug replacement plan as a `SEARCH`, so `rawScanTables`
 *  passes either way — but served by 0005's `idx_deadletter_unreplayed
 *  (replayed_at)` the per-slug query visits every unreplayed row in the FLEET
 *  and does a rowid lookup into the payload-bearing table for each, then throws
 *  away the ones belonging to other sites. `countUnreplayedDeadLettersBySlug`'s
 *  own docblock says an alarm "must never pull a client's PII into a dashboard
 *  request just to learn how many rows there are"; that is exactly what the
 *  0028-less plan does.
 *
 *  So the index is asserted directly, in both directions: with 0028 the plan is
 *  a COVERING seek on `site_slug`; with 0028 dropped the same query falls back
 *  to the fleet-wide traversal. Without the second half this file would be a
 *  check that can only ever pass.
 */
import { describe, it, expect } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";

const PER_SLUG_SQL = `SELECT count(*) AS n FROM submission_deadletter
   WHERE site_slug = ? AND replayed_at IS NULL AND abandoned_at IS NULL`;

async function plan(client: Client, sql: string, args: unknown[]): Promise<string> {
  const res = await client.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: args as never[] });
  return res.rows.map((r) => String(r.detail)).join(" | ");
}

describe("the per-slug dead-letter count is served by its own index (0028)", () => {
  it("seeks on site_slug, covering, touching no payload row", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    const detail = await plan(client, PER_SLUG_SQL, ["acme"]);
    expect(detail).toContain("idx_deadletter_slug_unreplayed");
    expect(detail).toContain("site_slug=?");
    // COVERING means the count never leaves the index for the row — the rows
    // carry full lead payloads.
    expect(detail).toContain("COVERING INDEX");
  });

  it("without 0028 the same query traverses the fleet's whole unreplayed queue", async () => {
    // The known-bad control. If this ever stops differing from the case above,
    // the assertion above has stopped measuring anything.
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    await client.execute("DROP INDEX idx_deadletter_slug_unreplayed");
    const detail = await plan(client, PER_SLUG_SQL, ["acme"]);
    expect(detail).not.toContain("idx_deadletter_slug_unreplayed");
    expect(detail).not.toContain("site_slug=?");
    // Falls back to the replayed_at index — every unreplayed row in the fleet.
    expect(detail).toContain("idx_deadletter_unreplayed");
  });
});
