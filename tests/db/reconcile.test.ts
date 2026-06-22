import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { backfillSubmissions, backfillScreenouts, reconcile } from "../../src/db/backfill.js";
import { createSubmission } from "../../src/db/submissions.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(submissions: Rec[], screenouts: Rec[]) {
  const tableFn = (t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(t === "Submissions" ? submissions : screenouts, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

const SUB: Rec = {
  id: "recX",
  fields: {
    Site: ["recA"],
    "Form type": "contact",
    Name: "G",
    Email: "g@example.com",
    "Submitted at": "2026-06-19T00:00:00.000Z",
    Status: "new",
  },
};
const SCREEN: Rec = { id: "s1", fields: { Site: ["recA"], Date: "2026-06-20", Honeypot: 2 } };

describe("reconcile", () => {
  it("reports ok when libSQL matches Airtable after a full backfill", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([SUB], [SCREEN]);
    await backfillSubmissions(base, db);
    await backfillScreenouts(base, db);
    const report = await reconcile(base, db);
    expect(report.ok).toBe(true);
    expect(report.submissions).toEqual({ airtable: 1, libsql: 1 });
  });

  it("reports a mismatch when libSQL has extra/fewer rows", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([SUB], [SCREEN]);
    await backfillSubmissions(base, db);
    await backfillScreenouts(base, db);
    // Add a row only to libSQL → counts diverge.
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Z",
      email: "z@example.com",
      submittedAt: new Date("2026-06-22T00:00:00.000Z"),
    });
    const report = await reconcile(base, db);
    expect(report.ok).toBe(false);
    expect(report.submissions).toEqual({ airtable: 1, libsql: 2 });
  });
});
