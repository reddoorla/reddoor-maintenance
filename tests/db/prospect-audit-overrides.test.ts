import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";

describe("prospect_audits — override columns", () => {
  it("has overrides_json, edited_at and opened_at after migration", async () => {
    process.env.TURSO_DATABASE_URL = ":memory:";
    const db = await openDb(readDbConfig());
    const rows = await db.introspection.getTables();
    const table = rows.find((t) => t.name === "prospect_audits");
    const names = (table?.columns ?? []).map((c) => c.name);
    expect(names).toContain("overrides_json");
    expect(names).toContain("edited_at");
    expect(names).toContain("opened_at");
  });
});
