import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { Db } from "../../src/db/client.js";
import {
  createProspectAudit,
  getProspectAuditByToken,
  generateToken,
  isValidToken,
} from "../../src/db/prospect-audits.js";

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
