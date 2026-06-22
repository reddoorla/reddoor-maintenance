import { describe, it, expect } from "vitest";
import { runDbCommand } from "../../src/cli/commands/db.js";

describe("runDbCommand", () => {
  it("rejects an unknown action with a non-zero code", async () => {
    const r = await runDbCommand("frobnicate", {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/unknown db action/i);
  });

  it("migrate against a :memory: url reports the applied migrations", async () => {
    // Force the in-memory url so the command needs no real Turso creds.
    const r = await runDbCommand("migrate", { url: ":memory:" });
    expect(r.code).toBe(0);
    expect(r.output).toMatch(/0001_init/);
  });
});
