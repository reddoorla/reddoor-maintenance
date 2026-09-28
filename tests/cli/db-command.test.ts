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

describe("the retired Airtable actions", () => {
  it.each(["import-airtable", "sync", "parity", "backfill-header-images", "backfill-digest-state"])(
    "%s is an unknown action, refused before touching any store",
    async (action) => {
      const r = await runDbCommand(action, {});
      expect(r.code).toBe(1);
      expect(r.output).toBe(
        `unknown db action '${action}'. Use: migrate, replay-deadletters, dump, verify-dump, restore, usage.`,
      );
    },
  );
});
