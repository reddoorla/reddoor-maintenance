import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  backfillSubmission,
  getSubmissionById,
  listNewSubmissions,
} from "../../src/db/submissions.js";
import type { SubmissionRow } from "../../src/reports/submission-row.js";

const ROW: SubmissionRow = {
  id: "recAIRTABLE1",
  submissionId: 42,
  siteId: "recSITE",
  formType: "contact",
  name: "Ada",
  email: "ada@example.com",
  phone: null,
  message: "hi",
  extraFields: null,
  sourceUrl: null,
  utm: null,
  submittedAt: "2026-06-20T00:00:00.000Z",
  status: "read",
  notifyStatus: "sent",
  resendMessageId: "re_1",
};

describe("backfillSubmission", () => {
  it("inserts preserving the Airtable id and display number", async () => {
    const db = await openDb({ url: ":memory:" });
    await backfillSubmission(db, ROW);
    const got = await getSubmissionById(db, "recAIRTABLE1");
    expect(got).toEqual(ROW);
    // It is NOT forced into the new queue — status is preserved.
    expect(await listNewSubmissions(db)).toHaveLength(0);
  });

  it("is idempotent — re-inserting the same id is a no-op", async () => {
    const db = await openDb({ url: ":memory:" });
    await backfillSubmission(db, ROW);
    await backfillSubmission(db, { ...ROW, name: "Changed" });
    const got = await getSubmissionById(db, "recAIRTABLE1");
    expect(got!.name).toBe("Ada"); // first write wins; no duplicate
  });
});

import { backfillSubmissions } from "../../src/db/backfill.js";
import type { AirtableBase } from "../../src/reports/airtable/client.js";

type Rec = { id: string; fields: Record<string, unknown> };
function fakeBase(rows: Rec[]) {
  const tableFn = (_t: string) => ({
    select: () => ({
      eachPage: async (page: (recs: Rec[], next: () => void) => void) => {
        page(rows, () => {});
      },
    }),
  });
  return tableFn as unknown as AirtableBase;
}

describe("backfillSubmissions (Airtable → libSQL)", () => {
  it("copies every Airtable submission, preserving ids", async () => {
    const db = await openDb({ url: ":memory:" });
    const base = fakeBase([
      {
        id: "recX",
        fields: {
          "Submission ID": 7,
          Site: ["recSITE"],
          "Form type": "contact",
          Name: "Grace",
          Email: "grace@example.com",
          "Submitted at": "2026-06-19T00:00:00.000Z",
          Status: "archived",
          "Notify status": "sent",
        },
      },
    ]);
    const n = await backfillSubmissions(base, db);
    expect(n).toBe(1);
    const got = await getSubmissionById(db, "recX");
    expect(got!.name).toBe("Grace");
    expect(got!.submissionId).toBe(7);
    expect(got!.status).toBe("archived");
  });
});
