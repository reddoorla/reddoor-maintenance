import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { recordScreenOut, listScreenOutsSince, screenOutsSince } from "../../src/db/screenouts.js";
import { backfillSubmission, setSubmissionStatusRow } from "../../src/db/submissions.js";
import { makeSubmissionRow } from "../_helpers/submission-row.js";

/** Seed one submission row at a given status + arrival time (for the derived markedSpam). */
async function seedSubmission(
  db: Awaited<ReturnType<typeof openDb>>,
  over: { id: string; siteId: string; status: "new" | "spam"; submittedAt: string },
): Promise<void> {
  await backfillSubmission(db, makeSubmissionRow(over));
}

describe("db recordScreenOut (atomic upsert)", () => {
  it("creates the bucket at 1 then increments in place", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recSITE", "too-fast", "2026-06-22");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals).toEqual({ honeypot: 2, tooFast: 1, markedSpam: 0 });
  });

  it("counts exactly under concurrent calls for the same (site, date)", async () => {
    const db = await openDb({ url: ":memory:" });
    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () => recordScreenOut(db, "recSITE", "honeypot", "2026-06-22")),
    );
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recSITE")!;
    expect(totals.honeypot).toBe(N);
  });
});

describe("db listScreenOutsSince — markedSpam derived from submissions", () => {
  it("re-marking a submission never double-counts (counted once from its current status)", async () => {
    const db = await openDb({ url: ":memory:" });
    // The exact bug: one submission toggled spam → new → spam. The old per-transition
    // counter recorded 2; deriving from the row's current status counts it once.
    await seedSubmission(db, {
      id: "recA1",
      siteId: "recA",
      status: "spam",
      submittedAt: "2026-06-20T10:00:00.000Z",
    });
    await setSubmissionStatusRow(db, "recA1", "new");
    await setSubmissionStatusRow(db, "recA1", "spam");
    const totals = (await listScreenOutsSince(db, "2026-06-01")).get("recA")!;
    expect(totals.markedSpam).toBe(1);
  });

  it("counts each currently-spam submission once; excludes non-spam and pre-window", async () => {
    const db = await openDb({ url: ":memory:" });
    await seedSubmission(db, {
      id: "s1",
      siteId: "recX",
      status: "spam",
      submittedAt: "2026-06-20T00:00:00.000Z",
    });
    await seedSubmission(db, {
      id: "s2",
      siteId: "recX",
      status: "spam",
      submittedAt: "2026-06-21T00:00:00.000Z",
    });
    await seedSubmission(db, {
      id: "s3",
      siteId: "recX",
      status: "new", // not spam → excluded
      submittedAt: "2026-06-22T00:00:00.000Z",
    });
    await seedSubmission(db, {
      id: "s4",
      siteId: "recX",
      status: "spam",
      submittedAt: "2026-05-01T00:00:00.000Z", // before the window → excluded
    });
    const totals = (await listScreenOutsSince(db, "2026-06-15")).get("recX")!;
    expect(totals.markedSpam).toBe(2);
  });

  it("un-marking self-corrects: a submission moved off spam stops counting", async () => {
    const db = await openDb({ url: ":memory:" });
    await seedSubmission(db, {
      id: "u1",
      siteId: "recU",
      status: "spam",
      submittedAt: "2026-06-20T00:00:00.000Z",
    });
    await setSubmissionStatusRow(db, "u1", "new");
    const totals = await listScreenOutsSince(db, "2026-06-15");
    expect(totals.get("recU")?.markedSpam ?? 0).toBe(0);
  });

  it("includes a site with marked-spam submissions but no screen-out bucket", async () => {
    const db = await openDb({ url: ":memory:" });
    await seedSubmission(db, {
      id: "o1",
      siteId: "recOnlySpam",
      status: "spam",
      submittedAt: "2026-06-20T00:00:00.000Z",
    });
    const totals = (await listScreenOutsSince(db, "2026-06-15")).get("recOnlySpam")!;
    expect(totals).toEqual({ honeypot: 0, tooFast: 0, markedSpam: 1 });
  });
});

describe("db listScreenOutsSince", () => {
  it("sums per site across the window and excludes earlier dates", async () => {
    const db = await openDb({ url: ":memory:" });
    await recordScreenOut(db, "recA", "honeypot", "2026-06-20");
    await recordScreenOut(db, "recA", "honeypot", "2026-06-22");
    await recordScreenOut(db, "recB", "too-fast", "2026-06-21");
    await recordScreenOut(db, "recA", "honeypot", "2026-05-01"); // before the window
    const map = await listScreenOutsSince(db, "2026-06-15");
    expect(map.get("recA")).toEqual({ honeypot: 2, tooFast: 0, markedSpam: 0 });
    expect(map.get("recB")).toEqual({ honeypot: 0, tooFast: 1, markedSpam: 0 });
  });
});

describe("screenOutsSince", () => {
  it("returns the YYYY-MM-DD `days` before now", () => {
    expect(screenOutsSince(new Date("2026-06-22T00:00:00.000Z"), 30)).toBe("2026-05-23");
  });
});
