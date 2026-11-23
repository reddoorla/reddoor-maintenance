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
    const out = await runProspectAuditReviewCommand({
      token,
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
    expect((await runProspectAuditReviewCommand({ token, by: "R", openDb: never })).code).toBe(2);
    expect(
      (
        await runProspectAuditReviewCommand({
          token,
          approve: true,
          withdraw: true,
          by: "R",
          openDb: never,
        })
      ).code,
    ).toBe(2);
    expect(
      (await runProspectAuditReviewCommand({ token, approve: true, openDb: never })).code,
    ).toBe(2);
    expect(
      (
        await runProspectAuditReviewCommand({
          token: "short",
          approve: true,
          by: "R",
          openDb: never,
        })
      ).code,
    ).toBe(2);
  });

  it("withdraws with --withdraw", async () => {
    const { db, token, openDb: o } = await seeded();
    const out = await runProspectAuditReviewCommand({
      token,
      withdraw: true,
      by: "Reviewer",
      openDb: o,
    });
    expect(out.code).toBe(0);
    expect((await getProspectAuditByToken(db, token))!.withdrawn_at).not.toBeNull();
  });
});

describe("prospect-audit-review from a shell (W1 review round 1)", () => {
  // About one token in 64 starts with "-". As a positional, cac read it as an
  // option ("Unknown option -1"), so that report could never be approved.
  it("accepts a token that starts with a dash, written --token=<token>", async () => {
    const { execFileSync } = await import("node:child_process");
    const { join, resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
    const env = { ...process.env };
    delete env.TURSO_DATABASE_URL;
    delete env.TURSO_AUTH_TOKEN;
    let out: string;
    let code = 0;
    try {
      // No --by: the command refuses with code 2 before it opens any database,
      // which proves cac took the token rather than rejecting it as an option.
      out = execFileSync(
        join(root, "node_modules/.bin/tsx"),
        [
          join(root, "src/cli/bin.ts"),
          "prospect-audit-review",
          "--token=-B3-_xY9zQ1rS2tU4vW6xY",
          "--approve",
        ],
        { env },
      ).toString();
    } catch (e) {
      const err = e as { stdout?: Buffer; stderr?: Buffer; status?: number };
      out = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
      code = err.status ?? 1;
    }
    expect(out).not.toContain("Unknown option");
    expect(out).toContain("Say who is doing this");
    expect(code).toBe(2);
  }, 60_000);
});
