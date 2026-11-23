import { describe, it, expect } from "vitest";
import { openDb, readDbConfig } from "../../src/db/client.js";
import { createProspectAudit, getProspectAuditByToken } from "../../src/db/prospect-audits.js";
import { runProspectAuditReviewCommand } from "../../src/cli/commands/prospect-audit-review.js";

async function seeded() {
  process.env.TURSO_DATABASE_URL = ":memory:";
  const db = await openDb(readDbConfig());
  const { token } = await createProspectAudit(db, {
    url: "https://acme.test/",
    business: "Acme",
    resultJson: "{}",
  });
  return { db, token, openDb: async () => db };
}

describe("prospect-audit-review CLI (W1)", () => {
  it("approves with --approve --by", async () => {
    const { db, token, openDb: o } = await seeded();
    const out = await runProspectAuditReviewCommand(token, {
      approve: true,
      by: "Reviewer",
      openDb: o,
    });
    expect(out.code).toBe(0);
    expect((await getProspectAuditByToken(db, token))!.approved_by).toBe("Reviewer");
  });

  it("needs exactly one action and a name, before touching the database", async () => {
    const { token } = await seeded();
    const never = async () => {
      throw new Error("must not open the database");
    };
    expect((await runProspectAuditReviewCommand(token, { by: "R", openDb: never })).code).toBe(2);
    expect(
      (
        await runProspectAuditReviewCommand(token, {
          approve: true,
          withdraw: true,
          by: "R",
          openDb: never,
        })
      ).code,
    ).toBe(2);
    expect(
      (await runProspectAuditReviewCommand(token, { approve: true, openDb: never })).code,
    ).toBe(2);
    expect(
      (await runProspectAuditReviewCommand("short", { approve: true, by: "R", openDb: never }))
        .code,
    ).toBe(2);
  });

  it("withdraws with --withdraw", async () => {
    const { db, token, openDb: o } = await seeded();
    const out = await runProspectAuditReviewCommand(token, {
      withdraw: true,
      by: "Reviewer",
      openDb: o,
    });
    expect(out.code).toBe(0);
    expect((await getProspectAuditByToken(db, token))!.withdrawn_at).not.toBeNull();
  });
});
