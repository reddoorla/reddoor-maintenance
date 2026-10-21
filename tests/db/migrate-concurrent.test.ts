import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";
import { MIGRATIONS } from "../../src/db/migrations.js";

/**
 * Several clients can open the database while a migration is pending: nightly
 * workflows starting together, or a Netlify function cold-starting beside them
 * (#1667). Each one sees the marker missing and runs the migration. The DDL is
 * idempotent (`IF NOT EXISTS`, or the swallowed duplicate `ADD COLUMN`), so the
 * marker insert is the only thing left to race; the loser must read the
 * conflict as "applied by another client", not throw.
 *
 * The clients are separate connections to one `file:` database, as in
 * production, not one shared `:memory:` client: a shared client serialises the
 * calls and the race never happens.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchUrl(): string {
  const dir = mkdtempSync(join(tmpdir(), "migrate-concurrent-"));
  dirs.push(dir);
  return `file:${join(dir, "fleet.db")}`;
}

/** A fully migrated database with the newest `ADD COLUMN` migration un-recorded
 *  and un-applied, so it is pending for every client that opens it next. */
async function dbWithLastAddColumnPending(url: string) {
  const pending = [...MIGRATIONS].reverse().find((m) => /ADD COLUMN/i.test(m.sql));
  if (!pending) throw new Error("no ADD COLUMN migration to leave pending");
  const [, table, column] = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/i.exec(pending.sql) ?? [];
  if (!table || !column) throw new Error(`cannot parse ${pending.id}`);
  const setup = createClient({ url });
  await runMigrations(setup);
  await setup.execute(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  await setup.execute({ sql: "DELETE FROM _migrations WHERE id = ?", args: [pending.id] });
  setup.close();
  return { id: pending.id, table, column };
}

describe("runMigrations with several clients at once (#1667)", () => {
  it.each([2, 3])(
    "%i clients migrating concurrently all succeed, with one marker and one column",
    async (n) => {
      const url = scratchUrl();
      const pending = await dbWithLastAddColumnPending(url);

      const clients: Client[] = Array.from({ length: n }, () => createClient({ url }));
      // Start every client before any finishes; the first round trip (CREATE
      // TABLE IF NOT EXISTS, then the SELECT) lets each read the marker as
      // missing before any writes it.
      const results = await Promise.allSettled(clients.map((c) => runMigrations(c)));
      for (const c of clients) c.close();

      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);

      const check = createClient({ url });
      const markers = await check.execute({
        sql: "SELECT COUNT(*) AS n FROM _migrations WHERE id = ?",
        args: [pending.id],
      });
      expect(Number(markers.rows[0]?.n)).toBe(1);
      const cols = await check.execute(`PRAGMA table_info(${pending.table})`);
      expect(cols.rows.filter((r) => String(r.name) === pending.column)).toHaveLength(1);

      // Exactly one client recorded the marker, so exactly one reports it as run.
      const reported = results
        .filter((r): r is PromiseFulfilledResult<string[]> => r.status === "fulfilled")
        .filter((r) => r.value.includes(pending.id));
      expect(reported).toHaveLength(1);
      check.close();
    },
  );

  it("a marker insert that fails for any other reason still throws", async () => {
    // Only the primary-key conflict means "another client recorded it". A real
    // write failure must propagate, or a migration would be silently unrecorded.
    const real = createClient({ url: ":memory:" });
    const failing = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return async (stmt: Parameters<Client["execute"]>[0]) => {
            const text = typeof stmt === "string" ? stmt : stmt.sql;
            if (/INSERT\b.*\b_migrations\b/i.test(text))
              throw new Error("SQLITE_IOERR: disk I/O error");
            return target.execute(stmt);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    await expect(runMigrations(failing)).rejects.toThrow(/SQLITE_IOERR/);
  });
});
