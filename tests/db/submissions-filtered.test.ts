import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  listSubmissionsFiltered,
  countSubmissionsFiltered,
} from "../../src/db/submissions.js";
import { parseSubmissionsQuery } from "../../src/dashboard/submissions-page.js";
import type { Db } from "../../src/db/client.js";

let db: Db;

async function seed() {
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Ada",
    email: "ada@x.com",
    phone: "1",
    message: "hire me please",
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "newsletter",
    name: "Bo",
    email: "bo@y.com",
    submittedAt: new Date("2026-06-10T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "Cy",
    email: "cy@z.com",
    message: "spammy text",
    submittedAt: new Date("2026-06-20T00:00:00.000Z"),
  });
  // createSubmission always sets status="new" — manually update to match test expectations
  // For "Bo" (status: "read") and "Cy" (status: "spam") we patch after insert
  await db
    .updateTable("submissions")
    .set({ status: "read" })
    .where("email", "=", "bo@y.com")
    .execute();
  await db
    .updateTable("submissions")
    .set({ status: "spam" })
    .where("email", "=", "cy@z.com")
    .execute();
}

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  await seed();
});

describe("listSubmissionsFiltered / countSubmissionsFiltered", () => {
  it("returns all newest-first with an empty filter", async () => {
    const rows = await listSubmissionsFiltered(db, {}, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.email)).toEqual(["cy@z.com", "bo@y.com", "ada@x.com"]);
    expect(await countSubmissionsFiltered(db, {})).toBe(3);
  });
  it("filters by site, form type, and status", async () => {
    expect(
      (await listSubmissionsFiltered(db, { siteId: "recA" }, { limit: 50, offset: 0 })).length,
    ).toBe(2);
    expect(
      (await listSubmissionsFiltered(db, { formType: "contact" }, { limit: 50, offset: 0 })).length,
    ).toBe(2);
    expect(
      (await listSubmissionsFiltered(db, { status: "spam" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
  });
  it("searches name/email/message case-insensitively", async () => {
    expect(
      (await listSubmissionsFiltered(db, { search: "HIRE" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
    expect(
      (await listSubmissionsFiltered(db, { search: "z.com" }, { limit: 50, offset: 0 })).length,
    ).toBe(1);
    expect(await countSubmissionsFiltered(db, { search: "nomatch" })).toBe(0);
  });
  it("escapes LIKE metacharacters so a literal _ / % is not a wildcard", async () => {
    // Two emails that differ only at a literal underscore vs any char.
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Under",
      email: "john_doe@x.com",
      submittedAt: new Date("2026-06-25T00:00:00.000Z"),
    });
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Wild",
      email: "johnxdoe@x.com",
      submittedAt: new Date("2026-06-26T00:00:00.000Z"),
    });
    // "john_doe" must match ONLY the literal underscore — not "johnxdoe" (which it WOULD if `_`
    // were treated as a single-char wildcard).
    const rows = await listSubmissionsFiltered(
      db,
      { search: "john_doe" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["john_doe@x.com"]);
    // A bare "%" is a literal, not match-everything: none of the seeded rows contain a literal %.
    expect(await countSubmissionsFiltered(db, { search: "%" })).toBe(0);
  });

  it("filters by date range inclusive", async () => {
    const rows = await listSubmissionsFiltered(
      db,
      { from: "2026-06-05T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["bo@y.com"]);
  });
  it("date filter built from the UI's YYYY-MM-DD inputs includes BOTH boundary days", async () => {
    // Reproduce the real call contract: the UI submits date-only from/to;
    // parseSubmissionsQuery passes `from` raw (date-only, lexicographically <= any
    // same-day ISO timestamp) and widens `to` → end-of-day. Bo (06-10T00:00, the
    // `from` boundary) and Cy (06-20T00:00, inside the widened `to`) both match;
    // Ada (06-01) is excluded.
    const { filter } = parseSubmissionsQuery(new URLSearchParams("from=2026-06-10&to=2026-06-20"));
    expect(filter.from).toBe("2026-06-10");
    expect(filter.to).toBe("2026-06-20T23:59:59.999Z");
    const rows = await listSubmissionsFiltered(db, filter, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.email)).toEqual(["cy@z.com", "bo@y.com"]);
  });
  it("paginates with limit/offset; count ignores pagination", async () => {
    const page1 = await listSubmissionsFiltered(db, {}, { limit: 2, offset: 0 });
    const page2 = await listSubmissionsFiltered(db, {}, { limit: 2, offset: 2 });
    expect(page1.length).toBe(2);
    expect(page2.length).toBe(1);
    expect(await countSubmissionsFiltered(db, {})).toBe(3);
  });
  it("combines filters", async () => {
    const rows = await listSubmissionsFiltered(
      db,
      { siteId: "recA", status: "new" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["ada@x.com"]);
  });
});

import { listSpamReasonsFiltered } from "../../src/db/submissions.js";

describe("reason filter (comma-boundary spam_reason token match)", () => {
  let rdb: Db;
  beforeEach(async () => {
    rdb = await openDb({ url: ":memory:" });
    const mk = (n: number, reason: string | null, status: "spam_auto" | "new" = "spam_auto") =>
      createSubmission(rdb, {
        siteId: "recA",
        formType: "contact",
        name: `R${n}`,
        email: `r${n}@x.com`,
        message: "body",
        submittedAt: new Date(`2026-07-0${n}T00:00:00.000Z`),
        status,
        ...(reason !== null ? { spamReason: reason, spamScore: 60 } : {}),
      });
    await mk(1, "links:3,keywords:2");
    await mk(2, "turnstile-required-absent");
    await mk(3, "turnstile-required-failed");
    await mk(4, "backlinks");
    await mk(5, null); // NULL spam_reason → excluded by any reason filter
  });

  it("matches a token carrying a stored :N count suffix", async () => {
    const rows = await listSubmissionsFiltered(rdb, { reason: "links" }, { limit: 50, offset: 0 });
    expect(rows.map((r) => r.email)).toEqual(["r1@x.com"]);
    const kw = await listSubmissionsFiltered(rdb, { reason: "keywords" }, { limit: 50, offset: 0 });
    expect(kw.map((r) => r.email)).toEqual(["r1@x.com"]);
  });

  it("comma-boundary: turnstile-required-absent never matches -failed (and vice versa)", async () => {
    const absent = await listSubmissionsFiltered(
      rdb,
      { reason: "turnstile-required-absent" },
      { limit: 50, offset: 0 },
    );
    expect(absent.map((r) => r.email)).toEqual(["r2@x.com"]);
    const failed = await listSubmissionsFiltered(
      rdb,
      { reason: "turnstile-required-failed" },
      { limit: 50, offset: 0 },
    );
    expect(failed.map((r) => r.email)).toEqual(["r3@x.com"]);
  });

  it("no substring bleed: 'backlinks' matches only its own row, 'links' never matches it", async () => {
    const rows = await listSubmissionsFiltered(
      rdb,
      { reason: "backlinks" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["r4@x.com"]);
  });

  it("escapes LIKE metacharacters: a bare '%' matches nothing", async () => {
    expect(await countSubmissionsFiltered(rdb, { reason: "%" })).toBe(0);
  });

  it("combines with the status filter, and count agrees with list", async () => {
    // r1 is spam_auto; flip it to 'spam' so the status filter does real work.
    await rdb
      .updateTable("submissions")
      .set({ status: "spam" })
      .where("email", "=", "r1@x.com")
      .execute();
    const rows = await listSubmissionsFiltered(
      rdb,
      { reason: "links", status: "spam_auto" },
      { limit: 50, offset: 0 },
    );
    expect(rows).toEqual([]);
    expect(await countSubmissionsFiltered(rdb, { reason: "links", status: "spam" })).toBe(1);
  });
});

describe("listSpamReasonsFiltered", () => {
  it("returns spam_reason strings for the WHOLE filter match (facets must outrun the page)", async () => {
    const db = await openDb({ url: ":memory:" });
    const mk = (n: number, status: "spam_auto" | "new", reason: string | null) =>
      createSubmission(db, {
        siteId: "recA",
        formType: "contact",
        name: `R${n}`,
        email: `r${n}@x.com`,
        message: "body",
        submittedAt: new Date(`2026-07-0${(n % 9) + 1}T00:00:00.000Z`),
        status,
        ...(reason !== null ? { spamReason: reason, spamScore: 60 } : {}),
      });
    await mk(1, "spam_auto", "keywords:4");
    await mk(2, "spam_auto", "turnstile-required-absent");
    await mk(3, "spam_auto", "turnstile-required-absent");
    await mk(4, "spam_auto", null); // no reason → excluded
    await mk(5, "new", "keywords:2"); // scored-but-delivered → excluded by the status filter

    const reasons = await listSpamReasonsFiltered(db, { status: "spam_auto" });
    expect(reasons.sort()).toEqual([
      "keywords:4",
      "turnstile-required-absent",
      "turnstile-required-absent",
    ]);
  });
});
