import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";
import {
  approveProspectAudit,
  createProspectAudit,
  getProspectAuditByToken,
  reserveProspectAudit,
  reviewState,
  supersedeProspectAudit,
  withdrawProspectAudit,
} from "../../src/db/prospect-audits.js";

async function fresh() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  return openDb(readDbConfig());
}
const make = (db: Awaited<ReturnType<typeof fresh>>, url = "https://acme.test/") =>
  createProspectAudit(db, { url, business: "Acme", resultJson: JSON.stringify({ url }) });

describe("W1 — review state of a prospect audit", () => {
  it("a finished run is a draft until someone approves it", async () => {
    const db = await fresh();
    const { token } = await make(db);
    const row = await getProspectAuditByToken(db, token);
    expect(reviewState(row!)).toBe("draft");
  });

  it("approve records who and when, and the report goes live", async () => {
    const db = await fresh();
    const { token } = await make(db);
    const at = new Date("2026-11-23T20:00:00.000Z");
    expect((await approveProspectAudit(db, token, "  Reviewer  ", at)).status).toBe("approved");
    const row = await getProspectAuditByToken(db, token);
    expect(row).toMatchObject({ approved_at: at.toISOString(), approved_by: "Reviewer" });
    expect(reviewState(row!)).toBe("live");
  });

  it("refuses to approve without a name", async () => {
    const db = await fresh();
    const { token } = await make(db);
    expect((await approveProspectAudit(db, token, "   ")).status).toBe("refused");
    expect(reviewState((await getProspectAuditByToken(db, token))!)).toBe("draft");
  });

  it("refuses to approve a running reservation: there is no report behind it", async () => {
    const db = await fresh();
    const r = await reserveProspectAudit(db, {
      url: "https://acme.test/",
      business: null,
      claimed: true,
    });
    if (r.kind !== "reserved") throw new Error("positive control");
    expect((await approveProspectAudit(db, r.token, "Reviewer")).status).toBe("not-found");
  });

  it("withdrawn wins over approved, and a withdrawn report cannot be approved back", async () => {
    const db = await fresh();
    const { token } = await make(db);
    await approveProspectAudit(db, token, "Reviewer");
    expect((await withdrawProspectAudit(db, token, "Reviewer")).status).toBe("withdrawn");
    expect(reviewState((await getProspectAuditByToken(db, token))!)).toBe("withdrawn");
    const again = await approveProspectAudit(db, token, "Reviewer");
    expect(again.status).toBe("refused");
    expect(reviewState((await getProspectAuditByToken(db, token))!)).toBe("withdrawn");
  });

  it("supersede points the old row at the newer one of the same site and withdraws it", async () => {
    const db = await fresh();
    const old = await make(db, "https://acme.test/");
    const next = await make(db, "https://www.acme.test");
    expect((await supersedeProspectAudit(db, old.token, next.token, "Reviewer")).status).toBe(
      "superseded",
    );
    const row = await getProspectAuditByToken(db, old.token);
    expect(row!.superseded_by).toBe(next.token);
    expect(reviewState(row!)).toBe("withdrawn");
  });

  it("refuses to supersede across two different sites", async () => {
    const db = await fresh();
    const old = await make(db, "https://acme.test/");
    const other = await make(db, "https://other.test/");
    const res = await supersedeProspectAudit(db, old.token, other.token, "Reviewer");
    expect(res.status).toBe("refused");
    expect((await getProspectAuditByToken(db, old.token))!.superseded_by).toBeNull();
  });
});
