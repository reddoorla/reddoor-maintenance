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
  const str = String(v);
  // A NUL cannot ride a single-quoted SQL literal. This used to strip them,
  // justified as "they cannot legitimately appear in this schema's TEXT
  // columns" — but `submissions` free text is attacker-supplied and SQLite
  // stores NUL inside TEXT quite happily, so the backup would have silently
  // differed from the origin with no signal. Emit the whole value as a hex blob
  // cast back to text instead: lossless, and it round-trips through the
  // rehearsal like any other literal.
  if (str.includes("\u0000")) {
    const bytes = new TextEncoder().encode(str);
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return `CAST(X'${hex}' AS TEXT)`;
  }
  // Strings: standard SQL escaping — double the single quotes.
  return `'${str.replaceAll("'", "''")}'`;
}

/**
 * Dump schema + data as executable SQL. Skips SQLite's internal tables
 * (`sqlite_*`); includes indexes. Wrapped in a transaction so a partial load
 * fails atomically instead of leaving a half-restored scratch that could be
 * mistaken for a good one.
 */
export async function dumpDatabase(db: SqlExecutor, generatedAt: string): Promise<string> {
  // Read the ORIGIN's own numbers BEFORE serialising anything. This is the
  // whole point: it is the only measurement that does not come from the dump,
  // so it is the only one that can notice the dump is short.
  const manifest: DumpManifest = {
    tables: await tableCounts(db),
    blobBytes: await headerImageBytes(db),
    generatedAt,
  };
  const out: string[] = [
    // First line, so a truncated dump still carries what it CLAIMED to hold.
    `${MANIFEST_PREFIX}${JSON.stringify(manifest)}`,
    "PRAGMA foreign_keys=OFF;",
    "BEGIN TRANSACTION;",
  ];

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

/** Marker for the origin manifest line, first line of every dump. */
export const MANIFEST_PREFIX = "-- REDDOOR_DUMP_MANIFEST ";

/** What the ORIGIN database held at dump time.
 *
 *  This exists because the restore rehearsal used to compare the dump against
 *  ITSELF: expected counts were parsed out of the dump text, and actual counts
 *  came from loading that same text. Both sides moved together, so a dump that
 *  collected 5 of 44 sites verified clean. A manifest read from the LIVE
 *  database before any rows are serialised is the only thing that can catch
 *  under-dumping.
 *
 *  `blobBytes` is the cheap content check. Row counts alone pass a dump in
 *  which every `header_image` came back NULL — and those bytes exist in no
 *  other store once Airtable is frozen. */
export type DumpManifest = {
  tables: Record<string, number>;
  blobBytes: number;
  generatedAt: string;
};

/** Total stored header-image bytes, the one content signal cheap enough to
 *  check on every nightly run. */
export async function headerImageBytes(db: SqlExecutor): Promise<number> {
  const r = await db.execute(
    "SELECT COALESCE(SUM(LENGTH(header_image)), 0) AS n FROM sites WHERE header_image IS NOT NULL",
  );
  return Number(r.rows[0]?.n ?? 0);
}

/** Parse the manifest line from a dump, or null when the dump predates it. */
export function parseDumpManifest(sql: string): DumpManifest | null {
  const line = sql.split("\n").find((l) => l.startsWith(MANIFEST_PREFIX));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(MANIFEST_PREFIX.length)) as DumpManifest;
  } catch {
    return null;
  }
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
