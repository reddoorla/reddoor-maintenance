import { describe, it, expect } from "vitest";
import { createClient } from "@libsql/client";
import { runMigrations } from "../../src/db/migrate.js";

describe("runMigrations", () => {
  it("creates the tables on a fresh in-memory db and reports what it ran", async () => {
    const client = createClient({ url: ":memory:" });
    const ran = await runMigrations(client);
    expect(ran).toEqual(["0001_init"]);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    expect(names).toContain("submissions");
    expect(names).toContain("spam_screenouts");
    expect(names).toContain("_migrations");
  });

  it("is idempotent — a second run applies nothing", async () => {
    const client = createClient({ url: ":memory:" });
    await runMigrations(client);
    const ranAgain = await runMigrations(client);
    expect(ranAgain).toEqual([]);
    const applied = await client.execute("SELECT id FROM _migrations");
    expect(applied.rows.map((r) => String(r.id))).toEqual(["0001_init"]);
  });
});
