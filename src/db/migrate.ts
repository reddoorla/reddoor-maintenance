import type { Client } from "@libsql/client";
import { retryOnBusy } from "./busy.js";
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
 *  recorded, and a marker another client recorded first is not an error.
 *  Returns the ids this client recorded. Runs on every openDb() — cheap
 *  (one indexed SELECT) and the gate every fresh Turso database needs before its
 *  first write. */
export async function runMigrations(client: Client): Promise<string[]> {
  // Every statement here retries on SQLITE_BUSY: separate OS processes on one
  // local file refuse each other's writes with it while a migration is pending
  // (#1674; five of six threw before this). Each retried statement is safe to
  // run again: the DDL is idempotent as described above, and a multi-statement
  // migration is all `IF [NOT] EXISTS` (every `ADD COLUMN` stands alone, so a
  // re-run cannot stop at its "duplicate column" before a later statement;
  // tests/db/migration-shape.test.ts pins it, #1690).
  await retryOnBusy(() =>
    client.execute(
      "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    ),
  );
  const existing = await retryOnBusy(() => client.execute("SELECT id FROM _migrations"));
  const applied = new Set(existing.rows.map((r) => String(r.id)));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    try {
      await retryOnBusy(() => client.executeMultiple(m.sql));
    } catch (err) {
      // A re-run after a lost marker can re-execute a non-idempotent `ADD COLUMN`;
      // treat "already applied" as success so we still record the marker below and
      // never boot-loop. Any other error propagates unchanged.
      if (!isAlreadyAppliedError(err)) throw err;
    }
    // Several clients can run a pending migration at once (nightlies starting
    // together, a function cold-starting beside them; #1667). The DDL above is
    // idempotent, so the marker is the race that remains. The loser's insert
    // hits the primary key, which means "another client recorded it".
    // `ON CONFLICT(id)` ignores that one conflict only; any other insert failure
    // still throws. `RETURNING id`, not `rowsAffected`, says whether THIS insert
    // wrote: after a BUSY attempt the local-file driver's count can be stale.
    const marked = await retryOnBusy(() =>
      client.execute({
        sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING RETURNING id",
        args: [m.id, new Date().toISOString()],
      }),
    );
    if (marked.rows.length > 0) ran.push(m.id);
  }
  return ran;
}
