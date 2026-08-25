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

  it("stores a null business", async () => {
    const { token } = await createProspectAudit(db, {
      url: "https://example.com",
      business: null,
      resultJson: "{}",
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.business).toBeNull();
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
