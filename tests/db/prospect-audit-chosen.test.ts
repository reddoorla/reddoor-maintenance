import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createProspectAudit,
  listRecentProspectAudits,
  getProspectAuditByToken,
} from "../../src/db/prospect-audits.js";
import type { Db } from "../../src/db/client.js";

/**
 * #676. The chosen terms and questions are stored ON THE ROW, not only inside
 * `result_json`, for two reasons the issue names: a re-run can reuse them, and
 * the listing can show which audits used chosen terms without parsing a blob
 * it deliberately never selects.
 */

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
});

const base = {
  url: "https://acme.example/",
  business: "Acme Roofing",
  resultJson: "{}",
};

const TERMS = ["flat roof repair Boise", "commercial roofing cost"];
const QUESTIONS = ["Do you service my postcode?"];

describe("prospect_audits stores operator-chosen terms and questions", () => {
  it("round-trips both lists on the row", async () => {
    const { token } = await createProspectAudit(db, {
      ...base,
      chosenTerms: TERMS,
      chosenQuestions: QUESTIONS,
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.chosen_terms).toBe(JSON.stringify(TERMS));
    expect(row!.chosen_questions).toBe(JSON.stringify(QUESTIONS));
  });

  it("stores NULL when nothing was chosen — generated is the default", async () => {
    // The distinction the listing and the report both read: null means the
    // audit chose its own, which is not the same as an empty operator list.
    const { token } = await createProspectAudit(db, base);
    const row = await getProspectAuditByToken(db, token);
    expect(row!.chosen_terms).toBeNull();
    expect(row!.chosen_questions).toBeNull();
  });

  it("stores NULL for an empty chosen list rather than an empty array", async () => {
    const { token } = await createProspectAudit(db, {
      ...base,
      chosenTerms: [],
      chosenQuestions: [],
    });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.chosen_terms).toBeNull();
    expect(row!.chosen_questions).toBeNull();
  });

  it("takes chosen terms WITHOUT chosen questions", async () => {
    // Two independent decisions — an operator who writes searches has not
    // thereby written the buyer questions.
    const { token } = await createProspectAudit(db, { ...base, chosenTerms: TERMS });
    const row = await getProspectAuditByToken(db, token);
    expect(row!.chosen_terms).toBe(JSON.stringify(TERMS));
    expect(row!.chosen_questions).toBeNull();
  });

  it("surfaces the chosen terms on the listing, so a re-run can reuse them", async () => {
    await createProspectAudit(db, { ...base, chosenTerms: TERMS });
    const [row] = await listRecentProspectAudits(db, 10);
    expect(row!.chosen_terms).toBe(JSON.stringify(TERMS));
  });

  it("leaves the listing's chosen_terms null for a generated audit", async () => {
    await createProspectAudit(db, base);
    const [row] = await listRecentProspectAudits(db, 10);
    expect(row!.chosen_terms).toBeNull();
  });

  it("still never selects result_json into the listing", async () => {
    // The listing's existing contract: large, and useless to a list. Adding a
    // column must not quietly become an excuse to pull the blob too.
    await createProspectAudit(db, { ...base, resultJson: JSON.stringify({ huge: "x" }) });
    const [row] = await listRecentProspectAudits(db, 10);
    expect(row).not.toHaveProperty("result_json");
  });
});
