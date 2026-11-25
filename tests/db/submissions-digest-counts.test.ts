import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  countSubmissionsSinceBySite,
  listLeadTimestampsForSite,
} from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";
import type { FormType } from "../../src/reports/submission-row.js";

let db: Db;

const SINCE = "2026-07-15T12:00:00.000Z";

/** Each seeded site's production url; a row is seeded from its site's own host
 *  unless a test says otherwise (maintenance#2296). */
const SITE_URL: Record<string, string> = {
  recA: "https://a-site.com",
  recB: "https://www.b-site.com",
};
const URLS: ReadonlyMap<string, string> = new Map(Object.entries(SITE_URL));

async function seedRow(
  siteId: string,
  formType: FormType,
  email: string,
  submittedAt: string,
  status?: "spam_auto" | "spam" | "read",
  sourceUrl: string | null = `${SITE_URL[siteId] ?? "https://unknown.example"}/contact`,
) {
  await createSubmission(db, {
    siteId,
    formType,
    name: "Row",
    email,
    submittedAt: new Date(submittedAt),
    ...(sourceUrl === null ? {} : { sourceUrl }),
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
    const counts = await countSubmissionsSinceBySite(db, SINCE, URLS);
    expect(counts.get("recA")).toEqual({ leads: 2, signups: 1, spamAuto: 1 });
    expect(counts.get("recB")).toEqual({ leads: 1, signups: 0, spamAuto: 0 });
  });

  it("excludes rows submitted before the window", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE, URLS);
    // recA's out-of-window contact would make leads 3 if the window leaked.
    expect(counts.get("recA")?.leads).toBe(2);
  });

  it("omits sites with no rows in the window entirely", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE, URLS);
    expect(counts.has("recGHOST")).toBe(false);
    expect([...counts.keys()].sort()).toEqual(["recA", "recB"]);
  });
});

describe("listLeadTimestampsForSite (P1-127)", () => {
  it("returns every lead of one site, all time, by the digest's lead rule", async () => {
    const at = (await listLeadTimestampsForSite(db, { id: "recA", url: SITE_URL.recA! })).sort();
    // a1 + a2 (read) + the one before the digest window; not the signup or either spam.
    expect(at).toEqual([
      "2026-07-14T00:00:00.000Z",
      "2026-07-16T00:00:00.000Z",
      "2026-07-16T00:00:00.000Z",
    ]);
    expect(await listLeadTimestampsForSite(db, { id: "recB", url: SITE_URL.recB! })).toEqual([
      "2026-07-16T00:00:00.000Z",
    ]);
    expect(await listLeadTimestampsForSite(db, { id: "nope", url: "https://nope.com" })).toEqual(
      [],
    );
  });
});

describe("only production submissions are leads (maintenance#2296)", () => {
  const IN = "2026-07-16T00:00:00.000Z";
  const NOT_PROD: Array<[string, string | null]> = [
    ["staging", "https://staging.a-site.com/contact"],
    ["deploy preview", "https://deploy-preview-4--a-site.netlify.app/contact"],
    ["netlify.app", "https://a-site.netlify.app/contact"],
    ["localhost", "http://localhost:4173/contact"],
    ["missing", null],
    ["unparseable", "a-site.com/contact"],
  ];

  beforeEach(async () => {
    for (const [label, url] of NOT_PROD) {
      await seedRow("recA", "contact", `np-${label.replace(/ /g, "-")}@x.com`, IN, undefined, url);
    }
    // A real lead on the www twin of an apex-stored site.
    await seedRow("recA", "contact", "www@x.com", IN, undefined, "https://www.a-site.com/contact");
    // A real lead on the apex of a www-stored site.
    await seedRow("recB", "contact", "apex@x.com", IN, undefined, "https://b-site.com/contact");
    // Production host, but a test sender (the operator's pick (a), 11-25): no lead.
    await seedRow("recA", "contact", "staff+form-check@reddoorla.com", IN);
    await seedRow("recB", "inquiry", "t@c.v", IN);
  });

  it("the report's lead list keeps the apex and www pages, drops every other host and every test sender", async () => {
    // recA: a1, a2, the pre-window row, and the www row. Six non-production rows dropped.
    expect(await listLeadTimestampsForSite(db, { id: "recA", url: SITE_URL.recA! })).toHaveLength(
      4,
    );
    // recB: b1 (www) and the apex row.
    expect(await listLeadTimestampsForSite(db, { id: "recB", url: SITE_URL.recB! })).toHaveLength(
      2,
    );
  });

  it("the digest's lead count agrees with the report's", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE, URLS);
    expect(counts.get("recA")?.leads).toBe(3);
    expect(counts.get("recB")?.leads).toBe(2);
  });

  it("a site with no known production url counts no leads", async () => {
    const counts = await countSubmissionsSinceBySite(db, SINCE, new Map());
    expect(counts.get("recA")).toEqual({ leads: 0, signups: 1, spamAuto: 1 });
  });
});
