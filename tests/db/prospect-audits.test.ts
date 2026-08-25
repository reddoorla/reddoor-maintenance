import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
  generateToken,
  isValidToken,
  listRecentProspectAudits,
  MAX_RECENT_PROSPECT_AUDITS,
} from "../../src/db/prospect-audits.js";

/** Insert a row with an EXPLICIT created_at, bypassing createProspectAudit's
 *  own `new Date().toISOString()` — several rows created in a tight loop can
 *  land on the same millisecond, which would make ordering assertions flaky.
 *  Mirrors the direct-insert pattern the "rejects a duplicate token" test
 *  above already uses. */
async function insertAuditAt(
  db: Db,
  id: string,
  createdAt: string,
  over: { url?: string; business?: string | null; status?: string } = {},
): Promise<void> {
  await db
    .insertInto("prospect_audits")
    .values({
      id,
      token: generateToken(),
      url: over.url ?? "https://example.com",
      business: over.business ?? null,
      created_at: createdAt,
      status: over.status ?? "complete",
      result_json: "{}",
    })
    .execute();
}

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

describe("prospect_audits", () => {
  it("round-trips an audit and finds it by token", async () => {
    const { id, token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      resultJson: '{"scores":{}}',
    });
    expect(id).toBeTruthy();
    const row = await getProspectAuditByToken(db, token);
    expect(row).not.toBeNull();
    expect(row!.url).toBe("https://example.com");
    expect(row!.business).toBe("Example Co");
    expect(row!.result_json).toBe('{"scores":{}}');
    expect(row!.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns null for an unknown token", async () => {
    expect(await getProspectAuditByToken(db, "AAAAAAAAAAAAAAAAAAAAAA")).toBeNull();
  });

  it("rejects a duplicate token (pins the UNIQUE constraint the public /r/{token} handle relies on)", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      resultJson: "{}",
    });
    // Force the collision deterministically: insert a second row through the raw
    // Kysely builder with the SAME literal token. Real tokens never collide (128
    // random bits); this is not defending against a collision, it's proving the
    // schema still rejects one if a future edit drops UNIQUE from the column.
    await expect(
      db
        .insertInto("prospect_audits")
        .values({
          id: "pa_deliberate_dupe",
          token,
          url: "https://duplicate.example.com",
          business: null,
          created_at: new Date().toISOString(),
          status: "complete",
          result_json: "{}",
        })
        .execute(),
    ).rejects.toThrow();
  });

  it("stores a null business", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: null,
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.business).toBeNull();
  });

  // Item 3: the column was written unconditionally as "complete" and never
  // even selected back out. The pipeline already models partial failure
  // precisely (StageResult) — give the column the job it was obviously meant
  // for, and prove both values actually round-trip through the row shape
  // getProspectAuditByToken returns.
  it("round-trips status: 'complete' when every stage succeeded", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      status: "complete",
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.status).toBe("complete");
  });

  it("round-trips status: 'partial' when a stage failed or was skipped", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      status: "partial",
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.status).toBe("partial");
  });

  it("defaults status to 'complete' — the column's own SQL default — when the caller doesn't specify one", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: "Example Co",
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.status).toBe("complete");
  });

  it("generates distinct 22-char base64url tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(isValidToken(a)).toBe(true);
  });

  it("isValidToken rejects malformed tokens", () => {
    expect(isValidToken("short")).toBe(false);
    expect(isValidToken("A".repeat(23))).toBe(false);
    expect(isValidToken("has/slash_but_22_chars")).toBe(false);
    expect(isValidToken("")).toBe(false);
  });
});

describe("listRecentProspectAudits", () => {
  it("returns rows newest-first, selecting the listing columns (not result_json)", async () => {
    await insertAuditAt(db, "pa_1", "2026-08-01T00:00:00.000Z", { business: "Oldest Co" });
    await insertAuditAt(db, "pa_2", "2026-08-03T00:00:00.000Z", { business: "Middle Co" });
    await insertAuditAt(db, "pa_3", "2026-08-02T00:00:00.000Z", { business: "In-between Co" });

    const rows = await listRecentProspectAudits(db, 10);
    expect(rows.map((r) => r.id)).toEqual(["pa_2", "pa_3", "pa_1"]);
    expect(rows.map((r) => r.business)).toEqual(["Middle Co", "In-between Co", "Oldest Co"]);
    for (const row of rows) {
      expect(row).not.toHaveProperty("result_json");
      expect(row).toHaveProperty("token");
    }
  });

  it("caps at the requested limit when fewer rows exist than the cap", async () => {
    await insertAuditAt(db, "pa_a", "2026-08-01T00:00:00.000Z");
    await insertAuditAt(db, "pa_b", "2026-08-02T00:00:00.000Z");
    await insertAuditAt(db, "pa_c", "2026-08-03T00:00:00.000Z");

    const rows = await listRecentProspectAudits(db, 2);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toEqual(["pa_c", "pa_b"]);
  });

  it("defensively caps at MAX_RECENT_PROSPECT_AUDITS even when a caller asks for far more", async () => {
    const total = MAX_RECENT_PROSPECT_AUDITS + 5;
    const base = Date.parse("2026-01-01T00:00:00.000Z");
    for (let i = 0; i < total; i++) {
      await insertAuditAt(db, `pa_bulk_${i}`, new Date(base + i * 1000).toISOString());
    }
    const rows = await listRecentProspectAudits(db, 10_000);
    expect(rows).toHaveLength(MAX_RECENT_PROSPECT_AUDITS);
    // Still newest-first: the last-inserted (highest i, latest created_at) row leads.
    expect(rows[0]!.id).toBe(`pa_bulk_${total - 1}`);
  });

  it("clamps a non-positive or non-finite limit up to at least 1 row", async () => {
    await insertAuditAt(db, "pa_only", "2026-08-01T00:00:00.000Z");
    expect(await listRecentProspectAudits(db, 0)).toHaveLength(1);
    expect(await listRecentProspectAudits(db, -5)).toHaveLength(1);
    expect(await listRecentProspectAudits(db, Number.NaN)).toHaveLength(1);
  });

  it("returns [] against an empty table", async () => {
    expect(await listRecentProspectAudits(db, 10)).toEqual([]);
  });
});
