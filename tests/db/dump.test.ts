import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDbCommand } from "../../src/cli/commands/db.js";
import { runMigrations } from "../../src/db/migrate.js";
import {
  dumpDatabase,
  tableCounts,
  sqlLiteral,
  parseDumpManifest,
  headerImageBytes,
  MANIFEST_PREFIX,
  type SqlExecutor,
} from "../../src/db/dump.js";

const wrap = (client: ReturnType<typeof createClient>): SqlExecutor => ({
  execute: async (q) => {
    const r = await client.execute(q);
    return { columns: r.columns, rows: r.rows as Array<Record<string, unknown>> };
  },
});

/** A migrated db with one row in every fleet-state table plus a submission —
 *  including the characters that break naive dumps: quotes, em-dashes,
 *  newlines, and a BLOB. */
async function seeded(): Promise<ReturnType<typeof createClient>> {
  const client = createClient({ url: ":memory:" });
  await runMigrations(client);
  await client.execute({
    sql: "INSERT INTO sites (id, slug, name, copy_intro, header_image) VALUES (?, ?, ?, ?, ?)",
    args: [
      "recA",
      "acme",
      'Acme\'s — "Gallery"',
      "Line one\nLine 'two' — dash",
      new Uint8Array([0, 1, 255, 16]),
    ],
  });
  await client.execute(
    "INSERT INTO site_health (site_id, p_score, smoke_ok) VALUES ('recA', 98, 'pass')",
  );
  await client.execute(
    "INSERT INTO submissions (id, site_id, form_type, name, email, status, notify_status) " +
      "VALUES ('sub_1', 'recA', 'contact', 'Ada', 'a@b.co', 'new', 'sent')",
  );
  return client;
}

describe("db/dump", () => {
  it("round-trips: the dump loads into a FRESH database and every row survives", async () => {
    // THE REHEARSED-RESTORE CONTRACT IN MINIATURE: dump → load into an empty
    // engine → identical table counts and identical cell values, BLOB included.
    const original = await seeded();
    const sql = await dumpDatabase(wrap(original), "2026-08-26T00:00:00.000Z");

    const restored = createClient({ url: ":memory:" });
    await restored.executeMultiple(sql);

    expect(await tableCounts(wrap(restored))).toEqual(await tableCounts(wrap(original)));
    const site = await restored.execute("SELECT name, copy_intro, header_image FROM sites");
    expect(site.rows[0]?.name).toBe('Acme\'s — "Gallery"');
    expect(site.rows[0]?.copy_intro).toBe("Line one\nLine 'two' — dash");
    const blob = site.rows[0]?.header_image as ArrayBuffer | Uint8Array;
    expect([...new Uint8Array(blob as ArrayBuffer)]).toEqual([0, 1, 255, 16]);
    const health = await restored.execute("SELECT p_score FROM site_health");
    expect(health.rows[0]?.p_score).toBe(98);
  });

  it("restores indexes, not just tables", async () => {
    // A restore that silently drops indexes resurrects the free-tier cliff
    // (rows READ are metered by scan) on the first day after a disaster.
    const sql = await dumpDatabase(wrap(await seeded()), "2026-08-26T00:00:00.000Z");
    const restored = createClient({ url: ":memory:" });
    await restored.executeMultiple(sql);
    const idx = await restored.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'",
    );
    const names = idx.rows.map((r) => String(r.name));
    expect(names).toContain("idx_sites_status");
    expect(names).toContain("idx_deadletter_unreplayed");
  });

  it("is deterministic — two dumps of an unchanged db are byte-identical", async () => {
    const client = await seeded();
    const a = await dumpDatabase(wrap(client), "2026-08-26T00:00:00.000Z");
    const b = await dumpDatabase(wrap(client), "2026-08-26T00:00:00.000Z");
    expect(a).toBe(b);
  });

  it("escapes literals correctly, and round-trips a NUL byte", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(5)).toBe("5");
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(new Uint8Array([0, 255]))).toBe("X'00ff'");
    // A NUL used to be silently STRIPPED, justified as impossible in this
    // schema — but `submissions` free text is attacker-supplied and SQLite
    // stores NUL in TEXT happily, so the backup would have quietly differed
    // from the origin. Now it round-trips losslessly as a hex blob cast to text.
    expect(sqlLiteral("a\u0000b")).toBe("CAST(X'610062' AS TEXT)");
    expect(sqlLiteral(Number.NaN)).toBe("NULL");
  });
});

describe("db verify-dump (CLI)", () => {
  async function dumpToFile(mutate?: (sql: string) => string): Promise<string> {
    const sql = await dumpDatabase(wrap(await seeded()), "2026-08-26T00:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "dump-verify-"));
    const file = join(dir, "dump.sql");
    await writeFile(file, mutate ? mutate(sql) : sql, "utf-8");
    return file;
  }

  it("passes a real dump — the known-good pass, before any failure is believed", async () => {
    const r = await runDbCommand("verify-dump", { file: await dumpToFile() });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(
      /DUMP_VERIFY loaded=true tables=\d+ rows=\d+ blob_bytes=\d+ mismatches=0/,
    );
  });

  it("FAILS on an under-collected dump — the case the old self-comparison could not see", async () => {
    // THE point of the manifest. Drop one site's INSERT from the dump text: the
    // old gate parsed its expectation out of that same text, so both sides fell
    // to 1 and it verified clean. The manifest was read from the live database
    // before serialising, so it still says 2 and the shortfall surfaces.
    const file = await dumpToFile((sql) => {
      // Remove a WHOLE statement, not one line: a text value here contains a
      // newline, so an INSERT can span lines — which is also precisely why the
      // old line-anchored `^INSERT INTO` counter was fragile.
      const lines = sql.split("\n");
      const start = lines.findIndex((l) => l.startsWith("INSERT INTO sites "));
      expect(start).toBeGreaterThan(-1); // the mutation must actually apply
      let end = start;
      while (end < lines.length && !lines[end]!.endsWith(");")) end++;
      lines.splice(start, end - start + 1);
      return lines.join("\n");
    });
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    // Not pinning exact counts — the point is that the ORIGIN number survives
    // the mutation while the restored one falls, which is precisely what the
    // old self-comparison could not express.
    expect(r.output).toMatch(/sites: origin=(\d+) restored=(\d+)/);
    const [, origin, restored] = /sites: origin=(\d+) restored=(\d+)/.exec(r.output)!;
    expect(Number(origin)).toBeGreaterThan(Number(restored));
  });

  it("FAILS when the header-image bytes do not round-trip", async () => {
    // Row counts alone pass a dump in which every BLOB came back NULL — and
    // those bytes exist in no other store once Airtable is frozen.
    const file = await dumpToFile((sql) =>
      sql.replace(/X'[0-9a-f]+'/, "NULL").replace("PRAGMA", "PRAGMA"),
    );
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/header_image bytes: origin=\d+ restored=\d+/);
  });

  it("REFUSES a dump with no manifest rather than falling back to self-comparison", async () => {
    // Falling back would re-enable the exact blind spot the manifest closes,
    // silently, on the one artifact nobody was watching.
    const file = await dumpToFile((sql) =>
      sql
        .split("\n")
        .filter((l) => !l.startsWith("-- REDDOOR_DUMP_MANIFEST "))
        .join("\n"),
    );
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toContain("manifest=absent");
  });

  it("fails loudly when the dump does not load at all", async () => {
    const file = await dumpToFile((sql) => sql + "\nTHIS IS NOT SQL;");
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/DUMP_VERIFY loaded=false/);
  });

  it("carries an ORIGIN manifest on its first line", async () => {
    // The counts must come from the live db, not from the dump text — that
    // distinction is the entire point, so pin that the line is first (a
    // truncated dump still carries what it CLAIMED to hold) and that the
    // numbers match a direct query of the origin.
    const client = await seeded();
    const sql = await dumpDatabase(wrap(client), "2026-08-26T00:00:00.000Z");

    expect(sql.split("\n")[0]!.startsWith(MANIFEST_PREFIX)).toBe(true);
    const manifest = parseDumpManifest(sql);
    expect(manifest).not.toBeNull();
    expect(manifest!.tables).toEqual(await tableCounts(wrap(client)));
    expect(manifest!.blobBytes).toBe(await headerImageBytes(wrap(client)));
    expect(manifest!.generatedAt).toBe("2026-08-26T00:00:00.000Z");
  });

  it("parseDumpManifest returns null for a dump that predates it", () => {
    expect(parseDumpManifest("PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n")).toBeNull();
  });
});

describe("backup table coverage (#612 review)", () => {
  it("FAILS when a table the app owns is missing from the backup entirely", async () => {
    // `tables=N` was printed by the verifier and never asserted, so a table a
    // migration failed to create would ride green forever. On the night this
    // was found, `digest_state` and `prospect_audits` were in NO artifact at
    // all — purely because they postdated the last run, and nothing said so.
    const client = await seeded();
    await client.execute("DROP TABLE digest_state");
    const sql = await dumpDatabase(wrap(client), "2026-08-26T00:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "dump-coverage-"));
    const file = join(dir, "dump.sql");
    await writeFile(file, sql, "utf-8");

    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toContain("digest_state: MISSING from the backup entirely");
  });

  it("passes when every owned table is present (positive control)", async () => {
    // Without this, the assertion above would pass on a check that reported
    // every table as missing.
    const sql = await dumpDatabase(wrap(await seeded()), "2026-08-26T00:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "dump-coverage-ok-"));
    const file = join(dir, "dump.sql");
    await writeFile(file, sql, "utf-8");
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(0);
  });
});

/**
 * #612 review: the nightly rehearsal loads into `:memory:`, which proves the
 * SQL parses. It does not prove you can get the data back into a real libSQL
 * target — the operation an actual recovery needs, and one that had never been
 * performed. `db restore` is that path.
 */
describe("db restore (CLI)", () => {
  async function dumpFile(): Promise<string> {
    const sql = await dumpDatabase(wrap(await seeded()), "2026-08-26T00:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "restore-"));
    const file = join(dir, "dump.sql");
    await writeFile(file, sql, "utf-8");
    return file;
  }

  it("restores into an empty target and verifies against the ORIGIN manifest", async () => {
    const file = await dumpFile();
    const r = await runDbCommand("restore", { file, url: ":memory:" });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/RESTORE loaded=true tables=\d+ rows=\d+ blob_bytes=\d+ mismatches=0/);
  });

  it("REFUSES a target that already holds tables", async () => {
    // Pointing this at production by mistake should cost nothing.
    const file = await dumpFile();
    const dir = await mkdtemp(join(tmpdir(), "restore-busy-"));
    const target = join(dir, "busy.db");
    const busy = createClient({ url: `file:${target}` });
    await busy.execute("CREATE TABLE already_here (id TEXT)");
    const r = await runDbCommand("restore", { file, url: `file:${target}` });
    expect(r.code).toBe(1);
    expect(r.output).toContain("refused=target-not-empty");
  });

  it("REFUSES without an explicit --url, so it can never default at production", async () => {
    const r = await runDbCommand("restore", { file: await dumpFile() });
    expect(r.code).toBe(1);
    expect(r.output).toContain("--url");
  });

  it("REFUSES a dump with no origin manifest", async () => {
    const sql = await dumpDatabase(wrap(await seeded()), "2026-08-26T00:00:00.000Z");
    const dir = await mkdtemp(join(tmpdir(), "restore-nomanifest-"));
    const file = join(dir, "dump.sql");
    await writeFile(
      file,
      sql
        .split("\n")
        .filter((l) => !l.startsWith("-- REDDOOR_DUMP_MANIFEST "))
        .join("\n"),
      "utf-8",
    );
    const r = await runDbCommand("restore", { file, url: ":memory:" });
    expect(r.code).toBe(1);
    expect(r.output).toContain("refused=manifest-absent");
  });
});
