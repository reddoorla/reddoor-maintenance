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
  countInsertsInDump,
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
    const sql = await dumpDatabase(wrap(original));

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
    const sql = await dumpDatabase(wrap(await seeded()));
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
    const a = await dumpDatabase(wrap(client));
    const b = await dumpDatabase(wrap(client));
    expect(a).toBe(b);
  });

  it("escapes literals correctly, and never emits a NUL byte", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(5)).toBe("5");
    expect(sqlLiteral("it's")).toBe("'it''s'");
    expect(sqlLiteral(new Uint8Array([0, 255]))).toBe("X'00ff'");
    expect(sqlLiteral("a\u0000b")).toBe("'ab'");
    expect(sqlLiteral(Number.NaN)).toBe("NULL");
  });
});

describe("db verify-dump (CLI)", () => {
  async function dumpToFile(mutate?: (sql: string) => string): Promise<string> {
    const sql = await dumpDatabase(wrap(await seeded()));
    const dir = await mkdtemp(join(tmpdir(), "dump-verify-"));
    const file = join(dir, "dump.sql");
    await writeFile(file, mutate ? mutate(sql) : sql, "utf-8");
    return file;
  }

  it("passes a real dump — the known-good pass, before any failure is believed", async () => {
    const r = await runDbCommand("verify-dump", { file: await dumpToFile() });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/DUMP_VERIFY loaded=true tables=\d+ rows=\d+ mismatches=0/);
  });

  it("fails when the restored count falls short of what the dump text claims", async () => {
    // The tripwire this branch exists for: the TEXT says N rows, the engine
    // ends the load with fewer — whatever the cause. Simulate with an INSERT
    // the counter sees whose row does not survive the load.
    const file = await dumpToFile((sql) =>
      sql.replace(
        "COMMIT;",
        "INSERT INTO sites (id, slug, name) VALUES ('recGone', 'gone', 'Gone');\n" +
          "DELETE FROM sites WHERE id='recGone';\nCOMMIT;",
      ),
    );
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/sites: dump=2 restored=1/);
  });

  it("fails loudly when the dump does not load at all", async () => {
    const file = await dumpToFile((sql) => sql + "\nTHIS IS NOT SQL;");
    const r = await runDbCommand("verify-dump", { file });
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/DUMP_VERIFY loaded=false/);
  });

  it("counts INSERTs per table from the dump text", async () => {
    expect(
      countInsertsInDump(
        'INSERT INTO sites (id) VALUES (1);\nINSERT INTO sites (id) VALUES (2);\nINSERT INTO "odd name" (x) VALUES (3);\n',
      ),
    ).toEqual({ sites: 2, "odd name": 1 });
  });
});
