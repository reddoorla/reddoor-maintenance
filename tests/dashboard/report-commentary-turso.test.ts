import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #539 Phase 6 (#646): the commentary edit is a TURSO write with an Airtable
 * shadow, so it must keep working once `AIRTABLE_PAT` / `AIRTABLE_BASE_ID` are
 * pulled — the same gate step 2 dropped from `resend-webhook`
 * (https://github.com/reddoorla/reddoor-maintenance/pull/855).
 *
 * Nothing on the Turso side is mocked: the handler opens a real libSQL database
 * — a throwaway `file:` database in a temp dir (not `:memory:`, because every
 * openDb on `:memory:` is a brand-new empty database and the handler opens its
 * own). TURSO_DATABASE_URL is overwritten and TURSO_AUTH_TOKEN deleted for every
 * test, so an operator shell with real Turso credentials exported can never
 * point this suite at production.
 *
 * Only the Airtable I/O is mocked, so the shadow write can be observed and made
 * to fail, and so no test can reach a real base.
 */

// Partial mock: only the Airtable writer is replaced. The module's pure exports
// stay real, because the Turso reader (src/db/fleet-state.ts) imports its row
// coercers through this module.
vi.mock("../../src/reports/airtable/reports.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/reports/airtable/reports.js")>()),
  updateReportCommentary: vi.fn(),
}));
vi.mock("../../src/reports/airtable/client.js", () => ({
  openBase: vi.fn(() => ((t: string) => t) as unknown),
}));
import { updateReportCommentary } from "../../src/reports/airtable/reports.js";
import { openBase } from "../../src/reports/airtable/client.js";
import reportCommentary from "../../netlify/functions/report-commentary.mjs";
import { openDb, type Db } from "../../src/db/client.js";

const shadowWrite = vi.mocked(updateReportCommentary);
const openBaseMock = vi.mocked(openBase);

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
  shadowWrite.mockReset();
  shadowWrite.mockResolvedValue(undefined);
  openBaseMock.mockClear();
});

afterEach(async () => {
  await db.destroy();
  process.env = { ...ORIGINAL_ENV };
});

afterAll(() => {
  rmSync(DIR, { recursive: true, force: true });
});

describe("report-commentary with NO Airtable env (the post-unplug world)", () => {
  it("writes the commentary to Turso — 200, not airtable-env-missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedReport("recREP1");
    const res = await post("recREP1", "  Traffic is up this month.  ");
    expect(await res.json()).toEqual({ ok: true });
    expect(res.status).toBe(200);
    // The edit actually LANDS in the authoritative store, trimmed.
    expect(await commentaryOf("recREP1")).toBe("Traffic is up this month.");
    expect(shadowWrite).not.toHaveBeenCalled();
    // No Airtable client is even constructed without credentials.
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain(
      "AIRTABLE_SHADOW skipped=env-absent record=recREP1",
    );
    warn.mockRestore();
  });

  it("clears the commentary with an empty body — the cell goes back to NULL", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedReport("recREP2", { commentary: "an earlier note" });
    const res = await post("recREP2", "   ");
    expect(res.status).toBe(200);
    expect(await commentaryOf("recREP2")).toBeNull();
    warn.mockRestore();
  });

  it("a minted report_<ULID> id is served too (its shadow would skip anyway)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedReport("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB");
    const res = await post("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB", "Minted-id note.");
    expect(res.status).toBe(200);
    expect(await commentaryOf("report_01K5F0RZ2N9Q7M3V8T4H6XW1AB")).toBe("Minted-id note.");
    warn.mockRestore();
  });

  it("a HALF-configured Airtable env skips the shadow too, and still lands the edit", async () => {
    process.env.AIRTABLE_PAT = "pat_only";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await seedReport("recREP3");
    const res = await post("recREP3", "Half-configured.");
    expect(res.status).toBe(200);
    expect(await commentaryOf("recREP3")).toBe("Half-configured.");
    expect(shadowWrite).not.toHaveBeenCalled();
    expect(openBaseMock).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join("\n")).toContain("AIRTABLE_SHADOW skipped=env-partial");
    warn.mockRestore();
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
    expect(shadowWrite).not.toHaveBeenCalled();
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

describe("report-commentary WITH Airtable env (the rollback-window world)", () => {
  beforeEach(() => {
    process.env.AIRTABLE_PAT = "pat_test";
    process.env.AIRTABLE_BASE_ID = "appTestBase";
  });

  // The positive control: this is the behaviour that already ships, so it must
  // pass on origin/main as well as on this branch. If the harness itself were
  // broken (auth, routing, the temp db) this test would fail too.
  it("still writes the Airtable shadow, and the edit lands in Turso", async () => {
    await seedReport("recREP7");
    const res = await post("recREP7", "Shadowed note.");
    expect(res.status).toBe(200);
    expect(await commentaryOf("recREP7")).toBe("Shadowed note.");
    expect(shadowWrite).toHaveBeenCalledWith(expect.anything(), "recREP7", "Shadowed note.");
  });

  it("a failing shadow write still reds the request (the rollback-window contract), after Turso landed", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await seedReport("recREP8");
    shadowWrite.mockRejectedValueOnce(new Error("Airtable 503"));
    const res = await post("recREP8", "Shadow is down.");
    expect(res.status).toBe(502);
    // The authoritative store is written FIRST, so the outage costs only the
    // shadow — the operator's edit is not lost with it.
    expect(await commentaryOf("recREP8")).toBe("Shadow is down.");
    // A retry is idempotent and catches the shadow up.
    const retry = await post("recREP8", "Shadow is down.");
    expect(retry.status).toBe(200);
    expect(shadowWrite).toHaveBeenLastCalledWith(expect.anything(), "recREP8", "Shadow is down.");
    err.mockRestore();
  });
});
