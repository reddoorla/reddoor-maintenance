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
  // re-run cannot stop at its "duplicate column" before a later statement).
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

/**
 * Put the counter back if a hand-run DELETE or DROP took it (#1692, #1702): the
 * table and row exactly as migration 0048 made them, both idempotent, so a
 * present counter is untouched. 0048 is already marked applied by then, so
 * nothing else would: a missing row makes every version read throw, and a
 * dropped table fails every write to the counted tables, form-ingest's leads
 * included (the triggers outlive their target). Run by `db migrate`, the
 * operator's command, not on every connection, so no open pays for a write.
 * The row comes back at 0, so an open cockpit tab must be reloaded, as after a
 * `db restore` (see `readCockpitVersion`). Returns true when the row had to be put back.
 */
export async function healCockpitVersion(client: Client): Promise<boolean> {
  await retryOnBusy(() =>
    client.execute(
      "CREATE TABLE IF NOT EXISTS cockpit_version (id INTEGER PRIMARY KEY CHECK (id = 1), n INTEGER NOT NULL)",
    ),
  );
  const put = await retryOnBusy(() =>
    client.execute("INSERT OR IGNORE INTO cockpit_version (id, n) VALUES (1, 0) RETURNING id"),
  );
  return put.rows.length > 0;
}
