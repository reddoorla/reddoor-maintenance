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

/** How many times a torn dump is re-taken before the run is failed.
 *
 *  The budget, measured 2026-09-20 across the last five nightly runs: the
 *  "Dump + rehearse the restore" step takes 10–16 s against the workflow's
 *  `timeout-minutes: 15`, so three full attempts sit roughly fiftyfold under
 *  the cap and no workflow change is owed to this retry loop. The reason not to
 *  raise the number is not time — it is that a database which will not settle
 *  in three passes needs a snapshot mechanism, not more retries. */
export const DUMP_ATTEMPTS = 3;

export type DumpOptions = {
  /** Bounded retries on a torn snapshot. Default `DUMP_ATTEMPTS`. */
  attempts?: number;
  /** Called after each discarded attempt, with the disagreements between the
   *  origin manifest and what that attempt actually serialised. The CLI routes
   *  this to stderr — stdout carries the dump itself. */
  onTorn?: (attempt: number, moved: string[]) => void;
};

/** The one table+column `blobBytes` measures. Named once so the manifest side
 *  (SQL `LENGTH()`, below) and the dump side (what was serialised) cannot drift
 *  apart into measuring two different things. */
const BLOB_TABLE = "sites";
const BLOB_COLUMN = "header_image";

/**
 * Dump schema + data as executable SQL. Skips SQLite's internal tables
 * (`sqlite_*`); includes indexes. Wrapped in a transaction so a partial load
 * fails atomically instead of leaving a half-restored scratch that could be
 * mistaken for a good one.
 *
 * MED-12 — THE TORN SNAPSHOT, and why it is detected rather than prevented.
 *
 * `SqlExecutor` is a deliberately minimal `{ execute(sql) }`: every call is its
 * own round trip, and there is no way to hold a transaction across them —
 * production is hosted Turso over HTTP, where every statement is its own
 * implicit transaction and a held read transaction is not on offer. So the
 * manifest read and the row reads cannot be made one point in time, and the
 * window between them is inherent to the contract. Over a ~17 MB dump that
 * window is seconds, and at 04:30 UTC (21:30 PT) visitor traffic is the only
 * writer — one form submission landing in it produced
 * `submissions: origin=354 restored=355`, reddened the job BEFORE the encrypt
 * and upload steps, and uploaded no backup that night.
 *
 * So: read the live manifest, serialise, and compare that manifest against WHAT
 * THIS DUMP ACTUALLY CONTAINS — the rows written per table, and the
 * header-image bytes written. Disagreement means the dump is internally
 * inconsistent: discard it, take the whole dump again a bounded number of
 * times, then fail loudly naming the table. A dump is only ever emitted when
 * its manifest describes the rows it carries.
 *
 * THE COMPARISON THAT DID NOT WORK, because the shape of the mistake is the
 * useful part: the first cut re-read the live counts after serialising and
 * compared them to the live counts before. That asks "did the database move?",
 * not "do the manifest and the rows agree?", and the two come apart BOTH ways.
 *
 *   - A row inserted AFTER its table's `SELECT *` but before the second count
 *     makes a perfectly consistent dump (manifest 354, 354 INSERTs) look torn.
 *     A good backup is discarded; three such nights in a row and there is no
 *     backup at all, which is the outcome MED-12 exists to remove.
 *   - A row inserted BEFORE the read and deleted after it returns the live
 *     count to where it started. Nothing looks torn, the dump ships carrying
 *     355 INSERTs under a manifest claiming 354, and the nightly reds anyway.
 *   - Neither live read can see an UNDER-COLLECTION — a `SELECT *` that returns
 *     fewer rows than exist, or every `header_image` coming back NULL — which
 *     is the failure the manifest was built for in the first place (see
 *     MANIFEST_PREFIX below).
 *
 * THE RESIDUAL, stated rather than papered over: the comparison is per-table
 * row counts plus one blob-byte total. An UPDATE moves neither, so a row edited
 * between the manifest read and its table's `SELECT *` is serialised in its new
 * form under a manifest taken before it; an insert and a delete inside the same
 * table and the same window cancel out the same way. So a dump still is NOT a
 * point-in-time snapshot of the whole database — what it now is, provably, is a
 * dump whose manifest describes the rows it carries, which is the only property
 * the nightly `verify-dump` actually checks. A checksum per table is what would
 * close the rest, at a cost this does not currently earn.
 *
 * This is NOT the self-comparison MANIFEST_PREFIX warns against. The EXPECTED
 * side is still measured on the LIVE database before a single row is
 * serialised; only the ACTUAL side changed, from a second live read to the
 * dump's own contents — which is exactly what the manifest exists to be checked
 * against. Nothing is parsed back out of the emitted text.
 */
export async function dumpDatabase(
  db: SqlExecutor,
  /** Stamped into the manifest. A function is re-evaluated per attempt, so a
   *  dump that succeeds on attempt 3 carries attempt 3's time rather than the
   *  time of a dump that was discarded; a plain string keeps a caller (and the
   *  determinism test) able to pin it. */
  generatedAt: string | (() => string),
  opts: DumpOptions = {},
): Promise<string> {
  const attempts = Math.max(1, opts.attempts ?? DUMP_ATTEMPTS);
  let moved: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const taken = await dumpOnce(
      db,
      typeof generatedAt === "function" ? generatedAt() : generatedAt,
    );
    if (taken.sql !== null) return taken.sql;
    moved = taken.moved;
    opts.onTorn?.(attempt, moved);
  }
  throw new Error(
    `db dump: the database changed under every one of ${attempts} attempts — ` +
      `${moved.join("; ")}. The dump was DISCARDED rather than written with a manifest ` +
      `it disagrees with. Re-run when writes are quiet; a fleet that never goes quiet ` +
      `needs a snapshot mechanism, not more retries.`,
  );
}

/** One attempt. Returns the dump, or the ways the manifest and the rows this
 *  attempt actually serialised disagree. */
async function dumpOnce(
  db: SqlExecutor,
  generatedAt: string,
): Promise<{ sql: string; moved: [] } | { sql: null; moved: string[] }> {
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

  // What this dump ACTUALLY carries, accumulated as it is written — the side
  // the manifest has to agree with, and the only side that can settle the
  // question. Recorded before the empty-table `continue`, so a table that
  // vanished between the manifest read and here reads as 0, not as absent.
  const dumped: Record<string, number> = {};
  let dumpedBlobBytes = 0;

  for (const table of tables) {
    const data = await db.execute(`SELECT * FROM ${quoteIdent(table)} ORDER BY rowid`);
    dumped[table] = data.rows.length;
    if (table === BLOB_TABLE) {
      for (const row of data.rows) dumpedBlobBytes += storedLength(row[BLOB_COLUMN]);
    }
    if (data.rows.length === 0) continue;
    const cols = data.columns.map(quoteIdent).join(", ");
    for (const row of data.rows) {
      const values = data.columns.map((c) => sqlLiteral(row[c])).join(", ");
      out.push(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${values});`);
    }
  }

  // The manifest was measured on the LIVE database before any of the above ran.
  // Equal on both sides means this dump holds exactly what its first line
  // claims; unequal means the manifest and the INSERTs describe two different
  // databases, which is the one thing the nightly `verify-dump` cannot tell
  // apart from a genuine under-collection.
  const moved: string[] = [];
  for (const [table, claimed] of Object.entries(manifest.tables)) {
    const written = dumped[table];
    if (written !== claimed) {
      moved.push(`${table}: manifest ${claimed}, dumped ${written ?? "not dumped at all"}`);
    }
  }
  for (const table of Object.keys(dumped)) {
    if (!(table in manifest.tables)) {
      moved.push(`${table}: absent from the manifest, dumped ${dumped[table]}`);
    }
  }
  if (dumpedBlobBytes !== manifest.blobBytes) {
    moved.push(`header_image bytes: manifest ${manifest.blobBytes}, dumped ${dumpedBlobBytes}`);
  }
  if (moved.length > 0) return { sql: null, moved };

  out.push("COMMIT;");
  return { sql: out.join("\n") + "\n", moved: [] };
}

/** SQLite's own `LENGTH()` rule applied to a value the driver handed back:
 *  BYTES for a blob, CHARACTERS for text.
 *
 *  `headerImageBytes` measures the manifest side with `LENGTH()` in SQL, so the
 *  dump side has to measure the same quantity or the two are not comparable and
 *  every dump is "torn" forever. `sites.header_image` is declared BLOB and only
 *  ever written bytes (`src/db/header-images.ts`), so in practice both sides
 *  are byte counts of the same blobs; the text branch is here because SQLite is
 *  dynamically typed and the cost of guessing wrong is discarding good backups
 *  three times a night. */
function storedLength(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (v instanceof Uint8Array) return v.byteLength;
  if (v instanceof ArrayBuffer) return v.byteLength;
  if (typeof v === "string") return [...v].length;
  return String(v).length;
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
    `SELECT COALESCE(SUM(LENGTH(${BLOB_COLUMN})), 0) AS n ` +
      `FROM ${BLOB_TABLE} WHERE ${BLOB_COLUMN} IS NOT NULL`,
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

/** Hosts that serve libSQL without authentication: `turso dev`, a local file,
 *  and the in-process scratch engine the nightly rehearsal loads into. */
// `[::1]` keeps its brackets: WHATWG URL reports an IPv6 hostname bracketed,
// so the bare form alone would classify a local IPv6 target as hosted.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Does this restore target need an auth token?
 *
 *  `db restore` used to build its client from a url alone, which works against
 *  every target the tests and rehearsals had ever used — `:memory:` and a local
 *  `turso dev` — and 401s against every target a real recovery would have.
 *  Classifying the url lets the command refuse with a named reason before the
 *  network instead of surfacing an opaque SERVER_ERROR.
 *
 *  Fails CLOSED: a url we cannot parse is treated as needing a token, because
 *  the alternative is silently skipping auth and getting the 401 anyway. */
export function requiresAuthToken(url: string): boolean {
  if (url === ":memory:") return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return true;
  }
  if (parsed.protocol === "file:") return false;
  return !LOCAL_HOSTS.has(parsed.hostname);
}
