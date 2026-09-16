import { describe, it, expect } from "vitest";
import { runDbCommand, freezeGuardsDbWrite } from "../../src/cli/commands/db.js";

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

  // #786. The escape hatch for the queue #785 deliberately stopped draining.
  describe("replay-deadletters --abandon", () => {
    it("refuses without --reason, BEFORE touching any store", async () => {
      // No Turso env is set in this suite, so reaching the refusal rather than a
      // credentials error proves the validation runs first — which is what makes
      // the mistake cheap to correct.
      const r = await runDbCommand("replay-deadletters", { abandon: "ghost-co" });
      expect(r.code).toBe(1);
      expect(r.output).toMatch(/--reason/);
    });

    it("refuses a whitespace-only reason too", async () => {
      const r = await runDbCommand("replay-deadletters", { abandon: "ghost-co", reason: "   " });
      expect(r.code).toBe(1);
      expect(r.output).toMatch(/--reason/);
    });

    it("reports zero rows for a slug with nothing queued, and exits 0", async () => {
      // The grant side: with a reason present the command runs and succeeds.
      // Exit 0 matters — abandoning is how the operator RELEASES this command
      // from the exit 1 that a dead slug pins it to.
      const r = await runDbCommand("replay-deadletters", {
        url: ":memory:",
        abandon: "ghost-co",
        reason: "site retired in 2025",
        by: "tucker",
      });
      expect(r.code).toBe(0);
      expect(r.output).toMatch(/DEADLETTER_ABANDONED target=ghost-co rows=0 by=tucker/);
    });
  });
});

/** #643: the scheduled import retired at the flip, but the MANUAL import
 *  survives as the rollback-window converge tool — and run out of habit it
 *  would overwrite authoritative Turso rows with the frozen Airtable archive.
 *  Both switch states injected; the one shipped-state check goes through
 *  `runDbCommand` itself, proving the command actually consults the guard. */
describe("freezeGuardsDbWrite — both sides of the switch", () => {
  it("refuses import-airtable and sync under the freeze, and names the way out", () => {
    for (const action of ["import-airtable", "sync"]) {
      const r = freezeGuardsDbWrite(action, false, true);
      expect(r?.code).toBe(1);
      expect(r?.output).toMatch(/refused/);
      expect(r?.output).toMatch(/--force/);
    }
  });

  it("lets --force through — the deliberate rollback-window converge", () => {
    expect(freezeGuardsDbWrite("sync", true, true)).toBeNull();
    expect(freezeGuardsDbWrite("import-airtable", true, true)).toBeNull();
  });

  it("never guards parity (compare-only) or the unrelated actions", () => {
    // "Did the shadow drift?" is exactly the rollback-window question — parity
    // must stay runnable without ceremony.
    expect(freezeGuardsDbWrite("parity", false, true)).toBeNull();
    expect(freezeGuardsDbWrite("migrate", false, true)).toBeNull();
    expect(freezeGuardsDbWrite("dump", false, true)).toBeNull();
  });

  it("is inert while Airtable is authoritative (the injected pre-freeze world)", () => {
    expect(freezeGuardsDbWrite("sync", false, false)).toBeNull();
    expect(freezeGuardsDbWrite("import-airtable", false, false)).toBeNull();
  });

  it("db sync refuses under the SHIPPED constant, before touching any store", async () => {
    // The integration half: no Turso or Airtable env is set in this suite, so
    // reaching the refusal (rather than a creds error) proves the guard fires
    // first. This is the suite's one assertion that reads the shipped switch.
    const r = await runDbCommand("sync", {});
    expect(r.code).toBe(1);
    expect(r.output).toMatch(/TURSO_IS_AUTHORITATIVE/);
  });
});
