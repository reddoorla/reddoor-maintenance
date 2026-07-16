import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  findRecentDuplicateSubmissions,
  MIN_DUP_BODY_LEN,
  MIN_SIMILAR_TOKENS,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

// A body comfortably over MIN_DUP_BODY_LEN so the length guard never masks the
// window/normalization assertions below. (17 distinct tokens — under
// MIN_SIMILAR_TOKENS, so it can only ever match via the exact tier.)
const PITCH =
  "I represent an SEO agency and can rank you on page one of Google within 24 hours, guaranteed.";

// A long template spray (~49 distinct tokens — over MIN_SIMILAR_TOKENS) modeled on
// the live dog-harness spray, whose per-site copies differed ONLY in the greeting.
const SPRAY =
  "Hey, I was checking out your website and noticed you sell dog harnesses. " +
  "We manufacture premium adjustable harnesses for small and large breeds with " +
  "reflective stitching, quick release buckles, and custom branding available at " +
  "wholesale prices. Would love to send over our catalog and discuss a partnership " +
  "opportunity for your store. Please reply whenever convenient.";
const SPRAY_VARIANT = SPRAY.replace("Hey,", "Good day,");

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

describe("findRecentDuplicateSubmissions — exact tier", () => {
  it("finds identical bodies fleet-wide, case/whitespace-insensitive, on/after the window", async () => {
    const r = await findRecentDuplicateSubmissions(db, PITCH, "2026-06-20");
    expect(r.exact).toHaveLength(2);
    expect(r.similar).toHaveLength(0);
  });

  it("returns id + status for each match (the caller retro-buckets the 'new' ones)", async () => {
    const spam = await createSubmission(db, {
      siteId: "recC",
      formType: "contact",
      name: "C",
      email: "c@x.com",
      message: PITCH,
      status: "spam_auto",
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, PITCH, "2026-06-20");
    expect(r.exact).toContainEqual({ id: spam.id, status: "spam_auto" });
    expect(r.exact.filter((m) => m.status === "new")).toHaveLength(2);
  });

  it("normalizes the query body too (mixed case + padding matches the stored rows)", async () => {
    const r = await findRecentDuplicateSubmissions(db, `\t${PITCH.toUpperCase()}\n`, "2026-06-20");
    expect(r.exact).toHaveLength(2);
  });

  it("excludes out-of-window rows", async () => {
    // Start after every seeded row → nothing matches, even the exact-match bodies.
    const r = await findRecentDuplicateSubmissions(db, PITCH, "2026-07-01");
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
  });

  it("returns nothing for a body shorter than MIN_DUP_BODY_LEN without querying", async () => {
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
    const r = await findRecentDuplicateSubmissions(db, short, "2026-06-20");
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
  });

  it("matches a body exactly at MIN_DUP_BODY_LEN (boundary is inclusive)", async () => {
    const exact = "y".repeat(MIN_DUP_BODY_LEN);
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Exact",
      email: "e@x.com",
      message: exact,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, exact, "2026-06-20");
    expect(r.exact).toHaveLength(1);
  });

  it("returns nothing when no body matches", async () => {
    const long = "This unique message has never been submitted before by anyone at all, ever.";
    const r = await findRecentDuplicateSubmissions(db, long, "2026-06-20");
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
  });

  it("matches byte-identical NON-ASCII bodies (JS normalization folds Unicode on both sides)", async () => {
    // Regression carried over from the SQL implementation: SQLite lower() is
    // ASCII-only, which once made a sentence-cased Cyrillic spray permanently
    // unmatchable against its own identical copy. The comparison now lives in JS
    // (full-Unicode toLowerCase on BOTH sides) — this must keep matching.
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
    const r = await findRecentDuplicateSubmissions(db, cyrillic, "2026-06-20");
    expect(r.exact).toHaveLength(1);
    // …and ASCII-case + whitespace variation still normalizes (contract unchanged).
    const ascii = await findRecentDuplicateSubmissions(
      db,
      `  ${PITCH.toUpperCase()}  `,
      "2026-06-20",
    );
    expect(ascii.exact).toHaveLength(2);
  });
});

describe("findRecentDuplicateSubmissions — similar tier", () => {
  it("matches a greeting-variant long spray as similar (the live dog-harness pattern)", async () => {
    const prior = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Spray1",
      email: "spray1@x.com",
      message: SPRAY,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, SPRAY_VARIANT, "2026-06-20");
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toContainEqual({ id: prior.id, status: "new" });
  });

  it("matches a domain-substituted spray (normalization strips the swapped domain → exact)", async () => {
    // SEO sprays substitute ONLY the target domain per site. Stripping domains in
    // normalization collapses the copies to the same skeleton, so they land in the
    // exact tier — the point is that they MATCH at all (raw equality never fires).
    const seoA =
      "Hello team, I reviewed galleryone.com and found several on-page issues holding back " +
      "your search rankings, broken links, and slow pages. Our agency specializes in fixing " +
      "exactly these problems for local businesses and we offer a free comprehensive audit " +
      "with no obligation. Reply to claim yours today.";
    const seoB = seoA.replace("galleryone.com", "the-pointe.net");
    const prior = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Seo1",
      email: "seo1@x.com",
      message: seoA,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, seoB, "2026-06-20");
    const combined = [...r.exact, ...r.similar];
    expect(combined).toContainEqual({ id: prior.id, status: "new" });
  });

  it("never puts an exact match in similar too", async () => {
    // SPRAY has enough tokens for the similar tier — a byte-identical copy must
    // still land in exact ONLY.
    const prior = await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Spray1",
      email: "spray1@x.com",
      message: SPRAY,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, SPRAY, "2026-06-20");
    expect(r.exact).toContainEqual({ id: prior.id, status: "new" });
    expect(r.similar).toHaveLength(0);
  });

  it("does NOT match two short genuine messages", async () => {
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Real1",
      email: "real1@x.com",
      message: "What are your gallery hours this coming weekend?",
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(
      db,
      "What are your gallery hours on Sunday afternoon?",
      "2026-06-20",
    );
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
  });

  it("respects the MIN_SIMILAR_TOKENS floor even at >= 0.9 Jaccard", async () => {
    // 20 distinct tokens each, differing in one word → Jaccard 19/21 ≈ 0.905 clears
    // the threshold, but both sets are under the 25-token floor: two mid-length
    // genuine messages must never collide.
    const a =
      "Please call me about the painting commission we discussed during my visit to your gallery last week thanks so much";
    const b = a.replace("week", "month");
    const [aTokens, bTokens] = [a, b].map((s) => new Set(s.toLowerCase().split(/\W+/)));
    expect(aTokens!.size).toBeLessThan(MIN_SIMILAR_TOKENS);
    expect(bTokens!.size).toBeLessThan(MIN_SIMILAR_TOKENS);
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Real1",
      email: "real1@x.com",
      message: a,
      submittedAt: new Date("2026-06-28T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, b, "2026-06-20");
    expect(r.exact).toHaveLength(0);
    expect(r.similar).toHaveLength(0);
  });

  it("excludes out-of-window rows from the similar tier too", async () => {
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "OldSpray",
      email: "old-spray@x.com",
      message: SPRAY,
      submittedAt: new Date("2026-06-01T00:00:00.000Z"),
    });
    const r = await findRecentDuplicateSubmissions(db, SPRAY_VARIANT, "2026-06-20");
    expect(r.similar).toHaveLength(0);
  });
});
