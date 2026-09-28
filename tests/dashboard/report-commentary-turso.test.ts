import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #539 Phase 6 (#646): the commentary edit is a TURSO write, and it works with no
 * `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` set — the same gate step 2 dropped from
 * `resend-webhook` (https://github.com/reddoorla/reddoor-maintenance/pull/855).
 *
 * Nothing is mocked: the handler opens a real libSQL database — a throwaway
 * `file:` database in a temp dir (not `:memory:`, because every openDb on
 * `:memory:` is a brand-new empty database and the handler opens its own).
 * TURSO_DATABASE_URL is overwritten and TURSO_AUTH_TOKEN deleted for every test,
 * so an operator shell with real Turso credentials exported can never point this
 * suite at production.
 */

import reportCommentary from "../../netlify/functions/report-commentary.mjs";
import { openDb, type Db } from "../../src/db/client.js";

// "op:s3cret" base64 — username ignored, password is the gate.
const AUTH = "Basic " + Buffer.from("op:s3cret").toString("base64");

const DIR = mkdtempSync(join(tmpdir(), "report-commentary-turso-"));
let dbSeq = 0;
let db: Db;

async function post(
  id: string,
  text: string,
  headers: Record<string, string> = { authorization: AUTH },
): Promise<Response> {
  const req = new Request(`https://x/api/reports/${id}/commentary`, {
    method: "POST",
    body: JSON.stringify({ text }),
    headers: { "content-type": "application/json", ...headers },
  });
  // @ts-expect-error — minimal Netlify Context (only params are read)
  return reportCommentary(req, { params: { id } });
}

async function seedReport(id: string, over: Record<string, unknown> = {}): Promise<void> {
  await db
    .insertInto("reports")
    .values({
      id,
      site_id: "recSite1",
      report_id: `${id}-2026-09`,
      draft_ready: 1,
      commentary: null,
      sent_at: null,
      ...over,
    } as never)
    .execute();
}

async function commentaryOf(id: string): Promise<string | null | undefined> {
  const r = await db
    .selectFrom("reports")
    .select("commentary")
    .where("id", "=", id)
    .executeTakeFirst();
  return r?.commentary;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(async () => {
  process.env = { ...ORIGINAL_ENV };
  process.env.DASHBOARD_PASSWORD = "s3cret";
  delete process.env.TURSO_AUTH_TOKEN;
  delete process.env.AIRTABLE_PAT;
  delete process.env.AIRTABLE_BASE_ID;
  const url = `file:${join(DIR, `db-${++dbSeq}.sqlite`)}`;
  process.env.TURSO_DATABASE_URL = url;
  db = await openDb({ url });
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("report-commentary with NO Airtable env", () => {
  it("writes the commentary to Turso — 200, not airtable-env-missing", async () => {
    await seedReport("recREP1");
    const res = await post("recREP1", "  Traffic is up this month.  ");
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    // The edit actually LANDS in the authoritative store, trimmed.
    expect(await commentaryOf("recREP1")).toBe("Traffic is up this month.");
  });

  it("clears the commentary with an empty body — the cell goes back to NULL", async () => {
    await seedReport("recREP2", { commentary: "an earlier note" });
    const res = await post("recREP2", "   ");
    expect(res.status).toBe(200);
    expect(await commentaryOf("recREP2")).toBeNull();
  });

  it("a minted report_<ULID> id is served too", async () => {
    await seedReport("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB");
    const res = await post("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB", "Minted-id note.");
    expect(res.status).toBe(200);
    expect(await commentaryOf("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB")).toBe("Minted-id note.");
  });

  it("a retry of the same edit is idempotent", async () => {
    await seedReport("recREP3");
    expect((await post("recREP3", "Same note.")).status).toBe(200);
    expect((await post("recREP3", "Same note.")).status).toBe(200);
    expect(await commentaryOf("recREP3")).toBe("Same note.");
  });

  it("the sent-report lock still refuses the edit: 409, and Turso is untouched", async () => {
    await seedReport("recREP4", {
      commentary: "what the client actually read",
      sent_at: "2026-09-01T12:00:00.000Z",
    });
    const res = await post("recREP4", "a late rewrite");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: "already-sent" });
    expect(await commentaryOf("recREP4")).toBe("what the client actually read");
  });

  it("an unauthenticated POST is still refused before anything is written", async () => {
    await seedReport("recREP5");
    const res = await post("recREP5", "not mine to write", {});
    expect(res.status).toBe(401);
    expect(await commentaryOf("recREP5")).toBeNull();
  });

  it("an id that is neither shape is still a 404 probe, and a missing row still 404s", async () => {
    expect((await post("../../etc/passwd", "probe")).status).toBe(404);
    expect((await post("recNOSUCHROW", "probe")).status).toBe(404);
  });

  it("an over-long commentary is still refused with 400 and never written", async () => {
    await seedReport("recREP6");
    const res = await post("recREP6", "x".repeat(6000));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: "too-long" });
    expect(await commentaryOf("recREP6")).toBeNull();
  });
});
