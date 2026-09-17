/**
 * #646 step 4: the send queue's predicate, moved from an Airtable
 * `filterByFormula` into SQL.
 *
 * Airtable evaluated `AND({Draft ready} = TRUE(), {Approved to send} = TRUE(),
 * {Sent at} = BLANK())` server-side, which is also why the suite's fake base has
 * never been able to exercise it: the fake does not evaluate formulas. So the
 * parity that matters here is not "same rows as the fake Airtable" — it is
 * "every combination of the three columns lands on the side the formula puts it".
 * All eight are driven through the real reader against a real migrated libSQL
 * database in a temp `file:` (never `:memory:`, never a `TURSO_*` url from the
 * environment).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, type Db } from "../../../src/db/client.js";
import { listSendableReports, listAllReports } from "../../../src/db/fleet-state.js";

let dir: string;
let db: Db;

type Flags = { draftReady: boolean; approved: boolean; sent: boolean };

const COMBOS: Flags[] = [false, true].flatMap((draftReady) =>
  [false, true].flatMap((approved) =>
    [false, true].map((sent) => ({ draftReady, approved, sent })),
  ),
);

const idOf = (f: Flags) => `rec_d${Number(f.draftReady)}_a${Number(f.approved)}_s${Number(f.sent)}`;

/** The Airtable formula, restated once as a predicate so the expectation below is
 *  derived from the RULE rather than from the implementation under test. */
const formulaSaysSendable = (f: Flags) => f.draftReady && f.approved && !f.sent;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sendable-"));
  db = await openDb({ url: `file:${join(dir, "fleet.db")}` });
  for (const f of COMBOS) {
    await db
      .insertInto("reports")
      .values({
        id: idOf(f),
        report_id: `Acme — Maintenance — ${idOf(f)}`,
        site_id: "recSITE",
        report_type: "Maintenance",
        period: "2026-09",
        draft_ready: f.draftReady ? 1 : 0,
        approved_to_send: f.approved ? 1 : 0,
        send_override: 0,
        sent_at: f.sent ? "2026-09-16T00:00:00.000Z" : null,
      })
      .execute();
  }
});

afterEach(async () => {
  await db.destroy();
  rmSync(dir, { recursive: true, force: true });
});

describe("listSendableReports", () => {
  it("returns exactly the rows the Airtable formula selected — all eight combinations", async () => {
    const got = (await listSendableReports(db)).map((r) => r.id).sort();
    const want = COMBOS.filter(formulaSaysSendable).map(idOf).sort();
    expect(got).toEqual(want);
    // Guard the matrix: both answers must actually occur, or an empty-equals-empty
    // comparison would pass with the WHERE deleted.
    expect(want.length).toBeGreaterThan(0);
    expect(want.length).toBeLessThan(COMBOS.length);
    expect((await listAllReports(db)).length).toBe(COMBOS.length);
  });

  it("stops returning a row once it is stamped sent — the only thing that clears the queue", async () => {
    const queued = COMBOS.filter(formulaSaysSendable).map(idOf);
    expect(queued).toHaveLength(1);
    await db
      .updateTable("reports")
      .set({ sent_at: "2026-09-17T00:00:00.000Z" })
      .where("id", "=", queued[0]!)
      .execute();
    expect(await listSendableReports(db)).toEqual([]);
  });
});
