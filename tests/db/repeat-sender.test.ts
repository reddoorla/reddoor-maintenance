import { describe, it, expect, beforeEach } from "vitest";
import { openDb } from "../../src/db/client.js";
import { createSubmission, listRecentSubmissionsForEmail } from "../../src/db/submissions.js";
import type { Db } from "../../src/db/client.js";

let db: Db;

beforeEach(async () => {
  db = await openDb({ url: ":memory:" });
  // Same sender on two different sites (the cross-site solicitation tell), one
  // stored with case/padding variation; a newsletter signup from the same address
  // (excluded — subscribing on two sites is legitimate); an out-of-window contact;
  // and an unrelated sender.
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Spray",
    email: "vendor@example.com",
    message: "pitch one",
    submittedAt: new Date("2026-06-25T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recB",
    formType: "contact",
    name: "Spray",
    email: "  Vendor@Example.COM ",
    message: "pitch two",
    status: "read",
    submittedAt: new Date("2026-06-26T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recC",
    formType: "newsletter",
    name: "Spray",
    email: "vendor@example.com",
    submittedAt: new Date("2026-06-26T12:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recC",
    formType: "contact",
    name: "Spray",
    email: "vendor@example.com",
    message: "pitch three",
    submittedAt: new Date("2026-06-01T00:00:00.000Z"),
  });
  await createSubmission(db, {
    siteId: "recA",
    formType: "contact",
    name: "Real",
    email: "genuine@example.com",
    message: "hello",
    submittedAt: new Date("2026-06-27T00:00:00.000Z"),
  });
});

describe("listRecentSubmissionsForEmail", () => {
  it("returns in-window non-newsletter rows for the email, case/whitespace-folded both ways", async () => {
    const rows = await listRecentSubmissionsForEmail(db, "vendor@example.com", "2026-06-20");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.siteId).sort()).toEqual(["recA", "recB"]);
    // Query-side folding: padded mixed case finds the same rows.
    const folded = await listRecentSubmissionsForEmail(db, "  VENDOR@example.com ", "2026-06-20");
    expect(folded).toHaveLength(2);
  });

  it("carries id + status so the caller can retro-bucket only still-'new' rows", async () => {
    const rows = await listRecentSubmissionsForEmail(db, "vendor@example.com", "2026-06-20");
    expect(rows.map((r) => r.status).sort()).toEqual(["new", "read"]);
    for (const r of rows) expect(r.id).toMatch(/^sub_/);
  });

  it("excludes newsletter rows (a person may subscribe on several sites)", async () => {
    const rows = await listRecentSubmissionsForEmail(db, "vendor@example.com", "2026-06-20");
    expect(rows.some((r) => r.siteId === "recC")).toBe(false);
  });

  it("excludes out-of-window rows", async () => {
    const rows = await listRecentSubmissionsForEmail(db, "vendor@example.com", "2026-06-26");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.siteId).toBe("recB");
  });

  it("returns [] immediately for a blank email (never matches empty-email rows)", async () => {
    await createSubmission(db, {
      siteId: "recA",
      formType: "contact",
      name: "Blank",
      email: "   ",
      message: "no address",
      submittedAt: new Date("2026-06-27T00:00:00.000Z"),
    });
    expect(await listRecentSubmissionsForEmail(db, "", "2026-06-20")).toEqual([]);
    expect(await listRecentSubmissionsForEmail(db, "   ", "2026-06-20")).toEqual([]);
  });

  it("returns [] for an unseen email", async () => {
    expect(await listRecentSubmissionsForEmail(db, "nobody@nowhere.com", "2026-06-20")).toEqual([]);
  });
});
