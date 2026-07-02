import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";

describe("runMigrations", () => {
  it("creates the tables on a fresh in-memory db and reports what it ran", async () => {
    const client = createClient({ url: ":memory:" });
    const ran = await runMigrations(client);
    expect(ran).toEqual([
      "0001_init",
      "0002_fleet_events",
      "0003_add_spam_score",
      "0004_add_spam_reason",
    ]);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toContain("submissions");
    expect(names).toContain("spam_screenouts");
    expect(names).toContain("fleet_events");
    expect(names).toContain("_migrations");
  });

  it("is idempotent — a second run applies nothing", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    const ranAgain = await runMigrations(client);
    expect(ranAgain).toEqual([]);
    const applied = await client.execute("SELECT id FROM _migrations");
    expect(applied.rows.map((r) => String(r.id))).toEqual([
      "0001_init",
      "0002_fleet_events",
      "0003_add_spam_score",
      "0004_add_spam_reason",
    ]);
  });

  it("re-applies cleanly after a lost _migrations marker (every statement is independently idempotent)", async () => {
    // executeMultiple is NON-transactional, so a crash mid-migration can leave the
    // DDL applied but the marker absent — the next openDb would re-run the whole
    // migration. That re-run must NOT throw (every statement IF NOT EXISTS-guarded).
    // Simulate it by dropping the marker after a successful apply and re-running.
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    await client.execute("DELETE FROM _migrations WHERE id = '0001_init'");

    const ran = await runMigrations(client); // must not throw
    expect(ran).toEqual(["0001_init"]); // re-applied (marker was gone); 0002 marker still present

    // Tables are intact and not duplicated; both markers are present.
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('submissions','spam_screenouts','fleet_events')",
    );
    expect(tables.rows.length).toBe(3);
    const applied = await client.execute("SELECT id FROM _migrations");
    expect(applied.rows.map((r) => String(r.id))).toEqual([
      "0001_init",
      "0002_fleet_events",
      "0003_add_spam_score",
      "0004_add_spam_reason",
    ]);
  });
});
