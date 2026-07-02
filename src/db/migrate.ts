import type { Client } from "@libsql/client";
import { MIGRATIONS } from "./migrations.js";

/** True when an error means "this DDL was already applied" and re-applying is a
 *  no-op we can safely ignore. `CREATE ... IF NOT EXISTS` never throws, but SQLite
 *  `ALTER TABLE ... ADD COLUMN` has no `IF NOT EXISTS`, so a re-run after a lost
 *  `_migrations` marker throws `duplicate column name: …`. Treating that as
 *  already-applied keeps `runMigrations` idempotent for `ADD COLUMN` migrations —
 *  without it a lost marker would boot-loop `openDb()` on every call. */
function isAlreadyAppliedError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /duplicate column name/i.test(message);
}

/** Apply every not-yet-applied migration in order against a raw libSQL client,
 *  tracking applied ids in `_migrations`. Idempotent: ids already present are
 *  skipped, the DDL uses IF NOT EXISTS where it can, and an already-applied
 *  `ADD COLUMN` (recognized by its error) is swallowed so the marker is still
 *  recorded. Returns the ids applied this run. Runs on every openDb() — cheap
 *  (one indexed SELECT) and the gate every fresh Turso database needs before its
 *  first write. */
export async function runMigrations(client: Client): Promise<string[]> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const existing = await client.execute("SELECT id FROM _migrations");
  const applied = new Set(existing.rows.map((r) => String(r.id)));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    try {
      await client.executeMultiple(m.sql);
    } catch (err) {
      // A re-run after a lost marker can re-execute a non-idempotent `ADD COLUMN`;
      // treat "already applied" as success so we still record the marker below and
      // never boot-loop. Any other error propagates unchanged.
      if (!isAlreadyAppliedError(err)) throw err;
    }
    await client.execute({
      sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
      args: [m.id, new Date().toISOString()],
    });
    ran.push(m.id);
  }
  return ran;
}
