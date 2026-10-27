import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, countSubmissionsSinceBySite } from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";
import type { FormType } from "../../src/reports/submission-row.js";

let db: Db;

const SINCE = "2026-07-15T12:00:00.000Z";

async function seedRow(
  siteId: string,
  formType: FormType,
  email: string,
  submittedAt: string,
  status?: "spam_auto" | "spam" | "read",
) {
  await createSubmission(db, {
    siteId,
    formType,
    name: "Row",
    email,
    submittedAt: new Date(submittedAt),
  });
  // createSubmission always inserts status='new'; patch afterwards (same pattern as
  // tests/db/submissions-filtered.test.ts).
  if (status) {
    await db.updateTable("submissions").set({ status }).where("email", "=", email).execute();
  }
}

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  const IN = "2026-07-16T00:00:00.000Z"; // inside the window
  // Site A: 2 leads (one 'new', one 'read'), 1 signup, 1 spam_auto, 1 operator-'spam'.
  await seedRow("recA", "contact", "a1@x.com", IN);
  await seedRow("recA", "contact", "a2@x.com", IN, "read");
  await seedRow("recA", "newsletter", "a3@x.com", IN);
  await seedRow("recA", "contact", "a4@x.com", IN, "spam_auto");
  await seedRow("recA", "contact", "a5@x.com", IN, "spam");
  // Site B: 1 lead.
  await seedRow("recB", "inquiry", "b1@x.com", IN);
  // Site A again, but BEFORE the window — must not count anywhere.
  await seedRow("recA", "contact", "old@x.com", "2026-07-14T00:00:00.000Z");
});

describe("countSubmissionsSinceBySite", () => {
  it("splits leads/signups/spamAuto per site; operator-'spam' rows count in NEITHER bucket", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE);
    expect(counts.get("recA")).toEqual({ leads: 2, signups: 1, spamAuto: 1 });
    expect(counts.get("recB")).toEqual({ leads: 1, signups: 0, spamAuto: 0 });
  });

  it("excludes rows submitted before the window", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE);
    // recA's out-of-window contact would make leads 3 if the window leaked.
    expect(counts.get("recA")?.leads).toBe(2);
  });

  it("omits sites with no rows in the window entirely", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE);
    expect(counts.has("recGHOST")).toBe(false);
    expect([...counts.keys()].sort()).toEqual(["recA", "recB"]);
  });
});
