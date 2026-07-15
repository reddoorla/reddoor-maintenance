import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  countRecentDuplicateMessages,
  MIN_DUP_BODY_LEN,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

// A body comfortably over MIN_DUP_BODY_LEN so the length guard never masks the
// window/normalization assertions below.
const PITCH =
  "I represent an SEO agency and can rank you on page one of Google within 24 hours, guaranteed.";

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  // Two identical pitches on DIFFERENT sites, in-window (fleet-wide match), plus a
  // whitespace/case variant that must still match, one out-of-window copy, and an
  // unrelated body.
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "A",
    email: "a@x.com",
    message: PITCH,
    submittedAt: new Date("2026-06-25T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "B",
    email: "b@x.com",
    message: `  ${PITCH.toUpperCase()}  `,
    submittedAt: new Date("2026-06-26T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Old",
    email: "old@x.com",
    message: PITCH,
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Other",
    email: "other@x.com",
    message: "A genuinely different, unrelated enquiry about your gallery hours this weekend.",
    submittedAt: new Date("2026-06-27T00:00:00.000Z"),
  });
});

describe("countRecentDuplicateMessages", () => {
  it("counts identical bodies fleet-wide, case/whitespace-insensitive, on/after the window", async () => {
    expect(await countRecentDuplicateMessages(db, PITCH, "2026-06-20")).toBe(2);
  });

  it("normalizes the query body too (mixed case + padding matches the stored rows)", async () => {
    expect(await countRecentDuplicateMessages(db, `\t${PITCH.toUpperCase()}\n`, "2026-06-20")).toBe(
      2,
    );
  });

  it("excludes out-of-window rows", async () => {
    // Start after every seeded row → nothing counts, even the exact-match bodies.
    expect(await countRecentDuplicateMessages(db, PITCH, "2026-07-01")).toBe(0);
  });

  it("returns 0 for a body shorter than MIN_DUP_BODY_LEN without querying", async () => {
    const short = "x".repeat(MIN_DUP_BODY_LEN - 1);
    // Seed the exact short body so a length-blind implementation WOULD match it.
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Short",
      email: "s@x.com",
      message: short,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    expect(await countRecentDuplicateMessages(db, short, "2026-06-20")).toBe(0);
  });

  it("counts a body exactly at MIN_DUP_BODY_LEN (boundary is inclusive)", async () => {
    const exact = "y".repeat(MIN_DUP_BODY_LEN);
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Exact",
      email: "e@x.com",
      message: exact,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    expect(await countRecentDuplicateMessages(db, exact, "2026-06-20")).toBe(1);
  });

  it("returns 0 when no body matches", async () => {
    const long = "This unique message has never been submitted before by anyone at all, ever.";
    expect(await countRecentDuplicateMessages(db, long, "2026-06-20")).toBe(0);
  });

  it("matches byte-identical NON-ASCII bodies (SQLite lower() is ASCII-only — fold both sides in SQL)", async () => {
    // Regression: JS toLowerCase() folds 'П'→'п' but libSQL lower() does not, so
    // normalizing the query in JS and the column in SQL made every sentence-cased
    // Cyrillic spray permanently unmatchable against its own identical copy.
    const cyrillic =
      "Привет! Мы продвинем ваш сайт в топ поисковой выдачи за одну неделю, гарантия результата.";
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Spray",
      email: "spray@x.com",
      message: cyrillic,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    // The byte-identical copy must match (this returned 0 before the fix)…
    expect(await countRecentDuplicateMessages(db, cyrillic, "2026-06-20")).toBe(1);
    // …and ASCII-case + whitespace variation still normalizes (contract unchanged).
    expect(await countRecentDuplicateMessages(db, `  ${PITCH.toUpperCase()}  `, "2026-06-20")).toBe(
      2,
    );
  });
});
