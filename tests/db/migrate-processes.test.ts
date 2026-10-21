import { describe, it, expect, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";
import { MIGRATIONS } from "../../src/db/migrations.js";

/**
 * Separate OS processes on one local `file:` database (#1674). Within one
 * process the marker insert is the only race (#1667, `migrate-concurrent`);
 * across processes SQLite refuses the second writer with `SQLITE_BUSY:
 * database is locked` at the DDL, before the marker is reached. Measured
 * before the fix: six processes with one migration pending, five threw, in
 * 3 of 3 rounds. The control, the same six on a fully migrated database,
 * all returned `[]`.
 *
 * Each child opens its own client, reports `ready`, and waits on stdin for
 * `go`, so all six start migrating together instead of one at a time as they
 * finish booting.
 */

const MIGRATE = resolve(import.meta.dirname, "../../src/db/migrate.ts");
const CHILD = `
import { createClient } from "@libsql/client";
import { runMigrations } from ${JSON.stringify(MIGRATE)};
const client = createClient({ url: process.env.MIGRATE_URL });
process.stdout.write("ready\\n");
process.stdin.once("data", async () => {
  try {
    const ran = await runMigrations(client);
    process.stdout.write(JSON.stringify({ ran }) + "\\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ error: String(err) }) + "\\n");
  } finally {
    client.close();
    process.stdin.destroy();
  }
});
`;

type Outcome = { ran: string[] } | { error: string };

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratchUrl(): string {
  const dir = mkdtempSync(join(tmpdir(), "migrate-processes-"));
  dirs.push(dir);
  return `file:${join(dir, "fleet.db")}`;
}

/** Same set-up as `migrate-concurrent.test.ts`: fully migrated, then the
 *  newest `ADD COLUMN` dropped and un-recorded, so it is pending for all. */
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

/** Spawn `n` children, release them together once all are ready, and collect
 *  each one's outcome. */
async function migrateInProcesses(url: string, n: number): Promise<Outcome[]> {
  const children = Array.from({ length: n }, () =>
    spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", CHILD], {
      env: { ...process.env, MIGRATE_URL: url },
      stdio: ["pipe", "pipe", "inherit"],
    }),
  );
  const lines = children.map((c) => createInterface({ input: c.stdout })[Symbol.asyncIterator]());
  const next = async (i: number) => {
    const line = await lines[i]!.next();
    if (line.done) throw new Error(`child ${i} exited before reporting`);
    return line.value;
  };
  for (let i = 0; i < n; i++) expect(await next(i)).toBe("ready");
  for (const c of children) c.stdin.write("go\n");
  const outcomes = await Promise.all(children.map((_, i) => next(i)));
  await Promise.all(
    children.map((c) => new Promise((r) => (c.exitCode === null ? c.once("exit", r) : r(null)))),
  );
  return outcomes.map((o) => JSON.parse(o) as Outcome);
}

describe("runMigrations from several OS processes at once (#1674)", () => {
  it("six processes with a migration pending all succeed, and it is applied once", async () => {
    const url = scratchUrl();
    const pending = await dbWithLastAddColumnPending(url);

    const outcomes = await migrateInProcesses(url, 6);

    expect(outcomes.filter((o) => "error" in o)).toEqual([]);
    // Exactly one process recorded the marker, so exactly one reports it as run.
    const reported = outcomes.filter((o) => "ran" in o && o.ran.includes(pending.id));
    expect(reported).toHaveLength(1);

    const check = createClient({ url });
    try {
      const markers = await check.execute({
        sql: "SELECT COUNT(*) AS n FROM _migrations WHERE id = ?",
        args: [pending.id],
      });
      expect(Number(markers.rows[0]?.n)).toBe(1);
      const cols = await check.execute(`PRAGMA table_info(${pending.table})`);
      expect(cols.rows.filter((r) => String(r.name) === pending.column)).toHaveLength(1);
    } finally {
      check.close();
    }
  }, 60_000);

  // Prove the instrument: with nothing pending, nothing writes, so nothing can
  // be BUSY. If this fails, the harness is broken, not runMigrations.
  it("control: six processes on a fully migrated database all return []", async () => {
    const url = scratchUrl();
    const setup = createClient({ url });
    await runMigrations(setup);
    setup.close();

    expect(await migrateInProcesses(url, 6)).toEqual(
      Array.from({ length: 6 }, () => ({ ran: [] })),
    );
  }, 60_000);

  // Deterministic, unlike the race above: one client whose migration DDL fails
  // the way the script says, counted per attempt.
  function failingDdl(error: () => Error, times: number) {
    const real = createClient({ url: scratchUrl() });
    let calls = 0;
    const client = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "executeMultiple") {
          return async (sql: string) => {
            calls++;
            if (calls <= times) throw error();
            return target.executeMultiple(sql);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Client;
    return { client, calls: () => calls, close: () => real.close() };
  }

  it("a migration that meets SQLITE_BUSY is retried and applied", async () => {
    const busy = () =>
      Object.assign(new Error("SQLITE_BUSY: database is locked"), { code: "SQLITE_BUSY" });
    const db = failingDdl(busy, 2);
    try {
      const ran = await runMigrations(db.client);
      expect(ran).toEqual(MIGRATIONS.map((m) => m.id));
      expect(db.calls()).toBe(MIGRATIONS.length + 2);
    } finally {
      db.close();
    }
  });

  it("any OTHER DDL error is not retried: it throws on the first attempt", async () => {
    const db = failingDdl(() => new Error('SQLITE_ERROR: near "TABEL": syntax error'), 1);
    try {
      await expect(runMigrations(db.client)).rejects.toThrow(/syntax error/);
      expect(db.calls()).toBe(1);
    } finally {
      db.close();
    }
  });

  it("a marker insert that meets SQLITE_BUSY is retried and recorded", async () => {
    const real = createClient({ url: scratchUrl() });
    let busyLeft = 1;
    const client = new Proxy(real, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return async (stmt: Parameters<Client["execute"]>[0]) => {
            const text = typeof stmt === "string" ? stmt : stmt.sql;
            if (/INSERT\b.*\b_migrations\b/i.test(text) && busyLeft-- > 0)
              throw Object.assign(new Error("SQLITE_BUSY: database is locked"), {
                code: "SQLITE_BUSY",
              });
            return target.execute(stmt);
          };
        }
        const v = Reflect.get(target, prop, receiver);
        return typeof v === "function" ? v.bind(target) : v;
      },
    }) as Client;
    try {
      expect(await runMigrations(client)).toEqual(MIGRATIONS.map((m) => m.id));
      const markers = await real.execute("SELECT COUNT(*) AS n FROM _migrations");
      expect(Number(markers.rows[0]?.n)).toBe(MIGRATIONS.length);
    } finally {
      real.close();
    }
  });
});
