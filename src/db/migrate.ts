import type { Client } from "@libsql/client";
import { MIGRATIONS } from "./migrations.js";

/** Apply every not-yet-applied migration in order against a raw libSQL client,
 *  tracking applied ids in `_migrations`. Idempotent: ids already present are
 *  skipped, and the DDL uses IF NOT EXISTS. Returns the ids applied this run.
 *  Runs on every openDb() — cheap (one indexed SELECT) and the gate every fresh
 *  Turso database needs before its first write. */
export async function runMigrations(client: Client): Promise<string[]> {
  await client.execute(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const existing = await client.execute("SELECT id FROM _migrations");
  const applied = new Set(existing.rows.map((r) => String(r.id)));
  const ran: string[] = [];
  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await client.executeMultiple(m.sql);
    await client.execute({
      sql: "INSERT INTO _migrations (id, applied_at) VALUES (?, ?)",
      args: [m.id, new Date().toISOString()],
    });
    ran.push(m.id);
  }
  return ran;
}
