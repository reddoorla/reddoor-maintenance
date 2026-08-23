/**
 * Phase 1.5 of #539: a platform-auth-free SQL dump of the whole database.
 *
 * `turso db dump` needs a PLATFORM login (browser OAuth) — a nightly workflow
 * has only the DATABASE-level url+token it already holds for every other job.
 * So the dump speaks plain SQL through the same client: schema straight from
 * `sqlite_master`, then every row as an INSERT. The output loads into stock
 * `sqlite3` (libSQL IS SQLite), which is exactly how the rehearsed restore
 * proves it — and how a real disaster would replay it into a fresh database.
 *
 * Determinism: tables and rows are emitted in stable order (name, then rowid)
 * so two dumps of an unchanged database are byte-identical — a diffable backup.
 */

/** Minimal execute surface: the @libsql/client `execute` we need. Injectable so
 *  tests run against :memory: without the real network client. */
export type SqlExecutor = {
  execute: (sql: string) => Promise<{
    columns: string[];
    rows: Array<Record<string, unknown>>;
  }>;
};

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string): string {
  return IDENT.test(name) ? name : `"${name.replaceAll('"', '""')}"`;
}

export function sqlLiteral(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
    const bytes = v instanceof ArrayBuffer ? new Uint8Array(v) : v;
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return `X'${hex}'`;
  }
  // Strings: standard SQL escaping — double the single quotes. NUL bytes cannot
  // ride a SQL literal; strip them (they cannot legitimately appear in this
  // schema's TEXT columns).
  return `'${String(v).replaceAll("\u0000", "").replaceAll("'", "''")}'`;
}

/**
 * Dump schema + data as executable SQL. Skips SQLite's internal tables
 * (`sqlite_*`); includes indexes. Wrapped in a transaction so a partial load
 * fails atomically instead of leaving a half-restored scratch that could be
 * mistaken for a good one.
 */
export async function dumpDatabase(db: SqlExecutor): Promise<string> {
  const out: string[] = ["PRAGMA foreign_keys=OFF;", "BEGIN TRANSACTION;"];

  const schema = await db.execute(
    "SELECT name, type, sql FROM sqlite_master " +
      "WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' " +
      "ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END, name",
  );

  const tables: string[] = [];
  for (const row of schema.rows) {
    out.push(`${String(row.sql).trim().replace(/;?$/, "")};`);
    if (row.type === "table") tables.push(String(row.name));
  }

  for (const table of tables) {
    const data = await db.execute(`SELECT * FROM ${quoteIdent(table)} ORDER BY rowid`);
    if (data.rows.length === 0) continue;
    const cols = data.columns.map(quoteIdent).join(", ");
    for (const row of data.rows) {
      const values = data.columns.map((c) => sqlLiteral(row[c])).join(", ");
      out.push(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${values});`);
    }
  }

  out.push("COMMIT;");
  return out.join("\n") + "\n";
}

/** Expected per-table row counts, read from the dump TEXT itself (one INSERT
 *  per row, by construction). Lets the restore rehearsal verify without a
 *  second network read of the origin — the dump is compared against itself. */
export function countInsertsInDump(sql: string): Record<string, number> {
  const counts: Record<string, number> = {};
  const re = /^INSERT INTO ("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*) /gm;
  for (const m of sql.matchAll(re)) {
    const raw = m[1] as string;
    const name = raw.startsWith('"') ? raw.slice(1, -1).replaceAll('""', '"') : raw;
    counts[name] = (counts[name] ?? 0) + 1;
  }
  return counts;
}

/** Per-table row counts — the cheap integrity check the restore rehearsal
 *  compares across original vs restored. */
export async function tableCounts(db: SqlExecutor): Promise<Record<string, number>> {
  const schema = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const counts: Record<string, number> = {};
  for (const row of schema.rows) {
    const name = String(row.name);
    const r = await db.execute(`SELECT COUNT(*) AS c FROM ${quoteIdent(name)}`);
    counts[name] = Number(r.rows[0]?.c ?? 0);
  }
  return counts;
}
