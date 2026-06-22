import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import {
  createSubmission,
  listSubmissionsFiltered,
  countSubmissionsFiltered,
} from "../../src/db/submissions.js";
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
  it("filters by date range inclusive", async () => {
    const rows = await listSubmissionsFiltered(
      db,
      { from: "2026-06-05T00:00:00.000Z", to: "2026-06-15T00:00:00.000Z" },
      { limit: 50, offset: 0 },
    );
    expect(rows.map((r) => r.email)).toEqual(["bo@y.com"]);
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
