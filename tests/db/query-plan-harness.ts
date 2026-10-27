/** Harness for the EXPLAIN-query-plan gate (query-plans.test.ts).
 *
 *  Capture strategy: @libsql/kysely-libsql funnels EVERY Kysely statement —
 *  builder queries and sql`` templates alike — through `client.execute({sql, args})`
 *  (lib-esm/index.js executeQuery), so a Proxy on the libsql client that records
 *  each statement before forwarding it sees exactly what production runs, with the
 *  real bound parameters. Coverage is therefore whatever the test actually invokes;
 *  the test closes that hole with an export-completeness check, and every scenario
 *  asserts it captured at least one statement (a scenario that early-returns without
 *  touching the db — e.g. markSubmissionsSpamRetro([]) — must not pass vacuously).
 */
import type { Client, InStatement } from "@libsql/client";
import { createClient } from "@libsql/client";
import { Kysely } from "kysely";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import type { Database } from "../../src/db/schema.js";
import type { Db } from "../../src/db/client.js";
import { runMigrations } from "../../src/db/migrate.js";

export type CapturedStatement = { sql: string; args: unknown[] };

export type CapturingDb = {
  db: Db;
  client: Client;
  captured: CapturedStatement[];
};

function normalize(stmt: InStatement): CapturedStatement {
  if (typeof stmt === "string") return { sql: stmt, args: [] };
  return { sql: stmt.sql, args: Array.isArray(stmt.args) ? [...stmt.args] : [] };
}

/** Fresh in-memory db, fully migrated (on the RAW client, so DDL is not captured),
 *  wrapped so every statement Kysely executes lands in `captured`. */
export async function openCapturingDb(): Promise<CapturingDb> {
  const client = createClient({ url: ":memory:" });
  await runMigrations(client);
  const captured: CapturedStatement[] = [];
  const capturing = new Proxy(client, {
    get(target, prop) {
      if (prop === "execute") {
        return (stmt: InStatement) => {
          captured.push(normalize(stmt));
          return target.execute(stmt as never);
        };
      }
      const v = Reflect.get(target, prop, target);
      return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
  const db = new Kysely<Database>({ dialect: new LibsqlDialect({ client: capturing }) });
  return { db, client, captured };
}

/** Names of the real tables in the migrated schema, straight from sqlite_master —
 *  the raw-scan detector only flags SCANs of these, so plan lines like
 *  "SCAN 2 CONSTANT ROWS" or subquery labels can never false-positive. */
export async function schemaTables(client: Client): Promise<Set<string>> {
  const res = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
  );
  return new Set(res.rows.map((r) => String(r.name)));
}

/** EXPLAIN QUERY PLAN for one captured statement, with its real bound args.
 *  Returns the plan's `detail` lines. */
export async function explainQueryPlan(client: Client, stmt: CapturedStatement): Promise<string[]> {
  const res = await client.execute({
    sql: `EXPLAIN QUERY PLAN ${stmt.sql}`,
    args: stmt.args as never[],
  });
  return res.rows.map((r) => String(r.detail));
}

/**
 * Tables a plan reads in full.
 *
 * A `SCAN <table>` line means every row of that table is visited, whether or not
 * an index supplies the order. The old rule skipped anything containing `USING`,
 * justified as "an index-ordered traversal under a LIMIT stops early" — true for
 * `listSubmissionsFiltered({})`, and false for the shapes that have no LIMIT to
 * stop them: `countNotifyBouncedBySite` and `countSubmissionsFiltered({})` are
 * aggregates that read the whole table through the index and were invisible here.
 *
 * **Turso meters row scans.** An index-ordered full traversal costs exactly as
 * many scanned rows as a raw one; the skipped-because-`USING` rule imported a
 * page-IO intuition into a per-row-billed store.
 *
 * So `SCAN t USING [COVERING] INDEX` now counts UNLESS the statement carries a
 * LIMIT — the one case where the early stop is real. `SEARCH` lines are always
 * fine: they seek, they do not traverse.
 *
 * The remaining known gap, deliberately not guessed at: a LIMITed statement whose
 * filter has a residual predicate the index cannot serve (`listSubmissionsFiltered
 * ({reason})`, a `LIKE` on an expression) still scans the whole table when few
 * rows match, and EXPLAIN's output does not distinguish that from a clean early
 * stop. Detecting it would need the residual predicate, which is not in the plan
 * text.
 */
export function rawScanTables(details: string[], tables: Set<string>, sql?: string): string[] {
  const limited = sql !== undefined && /\blimit\b/i.test(sql);
  const hits: string[] = [];
  for (const detail of details) {
    const table = /^SCAN (\S+)/.exec(detail)?.[1];
    if (table === undefined) continue;
    if (!tables.has(table)) continue;
    // Index-ordered traversal: only excused when a LIMIT can actually stop it.
    if (/\bUSING\b/.test(detail) && limited) continue;
    hits.push(table);
  }
  return hits;
}
