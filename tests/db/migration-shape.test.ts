import { describe, it, expect } from "vitest";
import { MIGRATIONS, type Migration } from "../../src/db/migrations.js";

/**
 * #1690. `runMigrations` re-runs a migration's whole `executeMultiple` batch, on
 * SQLITE_BUSY since #1687 and after a lost marker before that. `executeMultiple`
 * has no transaction, so a re-run is safe only because every `ADD COLUMN`
 * migration is one statement: `ALTER TABLE t ADD COLUMN c; CREATE INDEX …`
 * would commit the column, lose the index to a BUSY, then on the re-run throw
 * "duplicate column name" at statement 1, which `isAlreadyAppliedError`
 * swallows. The marker is recorded, the index never exists, and nothing says so.
 * The rule is stated in `src/db/migrate.ts`; this pins it.
 */

/** The statements in a script: quoted text, quoted identifiers and comments
 *  removed in ONE left-to-right pass (whichever starts first wins, so an
 *  apostrophe inside a comment cannot open a string), then split on `;`, empty
 *  pieces dropped. */
function statements(sql: string): string[] {
  const bare = sql.replace(
    /'(?:[^']|'')*'|"(?:[^"]|"")*"|`(?:[^`]|``)*`|\[[^\]]*\]|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (m) => (m.startsWith("--") || m.startsWith("/*") ? " " : "x"),
  );
  return bare
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** Whether a script adds a column: `ALTER TABLE … ADD`, with or without the
 *  optional COLUMN keyword, read from the stripped statements. */
function addsColumn(m: Migration): boolean {
  return statements(m.sql).some((s) => /^ALTER\s+TABLE\b[\s\S]*\bADD\b/i.test(s));
}

/** The ids of the migrations that add a column alongside any other statement. */
function addColumnViolations(migrations: Migration[]): string[] {
  return migrations
    .filter(addsColumn)
    .filter((m) => statements(m.sql).length !== 1)
    .map((m) => m.id);
}

describe("migration shape (#1690)", () => {
  it("every ADD COLUMN migration is exactly one statement", () => {
    expect(addColumnViolations(MIGRATIONS)).toEqual([]);
  });

  it("the check sees the migrations it is about", () => {
    // A check that matches nothing passes vacuously, so the floor counts with the
    // check's own predicate: 33 migrations add a column on 2026-10-24.
    expect(MIGRATIONS.filter(addsColumn).length).toBeGreaterThanOrEqual(30);
  });

  it("names an ADD COLUMN migration with a second statement", () => {
    const fixture: Migration[] = [
      { id: "ok", sql: "ALTER TABLE t ADD COLUMN c TEXT;" },
      { id: "ok-no-semicolon", sql: "ALTER TABLE t ADD COLUMN d TEXT" },
      { id: "ok-comment", sql: "-- adds e; nothing else\nALTER TABLE t ADD COLUMN e TEXT;" },
      { id: "ok-default", sql: "ALTER TABLE t ADD COLUMN f TEXT DEFAULT 'a;b';" },
      { id: "ok-quoted-identifier", sql: "ALTER TABLE t ADD COLUMN `c;x` TEXT; -- [a;b]" },
      { id: "ok-bracket-identifier", sql: "ALTER TABLE t ADD COLUMN [d;x] TEXT;" },
      {
        id: "two",
        sql: "ALTER TABLE t ADD COLUMN g TEXT;\nCREATE INDEX IF NOT EXISTS t_g ON t (g);",
      },
      {
        // An apostrophe in a comment must not open a string that hides the index.
        id: "apostrophe-in-comment",
        sql: "-- it's here\nALTER TABLE t ADD COLUMN h TEXT; CREATE INDEX i ON t(h); -- don't",
      },
      {
        // SQLite lets COLUMN be left out, and it fails the same way on a re-run.
        id: "no-column-keyword",
        sql: "ALTER TABLE t ADD i TEXT; CREATE INDEX j ON t(i);",
      },
      {
        id: "multi-not-add",
        sql: "CREATE TABLE IF NOT EXISTS u (a);\nCREATE INDEX IF NOT EXISTS u_a ON u (a);",
      },
    ];
    expect(addColumnViolations(fixture)).toEqual([
      "two",
      "apostrophe-in-comment",
      "no-column-keyword",
    ]);
  });
});
