/**
 * #539 Phase 5: the multi-column twin of `mirrorSiteField`, for writers that
 * touch more than one `sites` cell in a single Airtable update.
 *
 * `updateLaunched` is the reason it exists — it flips `Status` AND stamps
 * `Launched at` in one write, and mirroring those as two separate UPDATEs would
 * leave a window where Turso says a site is maintained but never launched.
 *
 * Same contract as `mirrorHealthFields`, deliberately: it takes the EXACT
 * FieldSet just written to Airtable (the writers return it), resolves columns
 * through the importer's own `SITE_FIELDS` + `siteValueFor`, and reports whether
 * a row matched so a caller can count a not-yet-imported site honestly instead
 * of claiming it mirrored.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import { mirrorSiteFields } from "../../src/db/fleet-state.js";

const NOW = new Date("2026-08-25T12:00:00.000Z");
const SITE: RawRecord = {
  id: "recSITE",
  fields: { Name: "Acme Gallery", Status: "launching", "Launched at": null },
};

const io = (records: RawRecord[]): ImportIo => ({
  listWebsiteRecords: async () => records,
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
});

async function dbWithSite() {
  const db = await openDb({ url: ":memory:" });
  await importFleetState(db, io([SITE]));
  return db;
}

const stored = async (db: Awaited<ReturnType<typeof openDb>>) =>
  db
    .selectFrom("sites")
    .select(["status", "launched_at", "require_turnstile", "accepted_watch_conditions"])
    .where("id", "=", "recSITE")
    .executeTakeFirst();

describe("mirrorSiteFields", () => {
  it("writes every column of one Airtable update in a single UPDATE", async () => {
    const db = await dbWithSite();

    const matched = await mirrorSiteFields(db, "recSITE", {
      Status: "maintained",
      "Launched at": "2026-08-25T12:00:00.000Z",
    });

    expect(matched).toBe(true);
    expect(await stored(db)).toMatchObject({
      status: "maintained",
      launched_at: "2026-08-25T12:00:00.000Z",
    });
  });

  it("delegates coercion to the importer, so parity stays raw-to-raw", async () => {
    // The whole risk of a mirror is coercing differently from the importer:
    // parity compares raw-to-raw, so storing "true" where the importer stores 1
    // reds every hourly run until the next import papers over it.
    const db = await dbWithSite();

    await mirrorSiteFields(db, "recSITE", {
      "Require Turnstile": true,
      "Accepted Watch Conditions": ["cert-warning", "prismic"],
    });

    const row = await stored(db);
    expect(row?.require_turnstile).toBe(1);
    expect(row?.accepted_watch_conditions).toBe(JSON.stringify(["cert-warning", "prismic"]));
  });

  it("reports false when no sites row matched (site not imported yet)", async () => {
    const db = await dbWithSite();
    expect(await mirrorSiteFields(db, "recUNKNOWN", { Status: "maintained" })).toBe(false);
  });

  it("an empty FieldSet runs no SQL and is not a miss", async () => {
    const db = await dbWithSite();
    expect(await mirrorSiteFields(db, "recUNKNOWN", {})).toBe(true);
  });

  it("throws on a column the importer does not claim", async () => {
    // Same contract as mirrorHealthFields: an unmapped column silently dropped
    // is a stale cell nobody notices, so make it loud at the seam.
    const db = await dbWithSite();
    await expect(mirrorSiteFields(db, "recSITE", { "Not A Column": "x" })).rejects.toThrow(
      /Not A Column/,
    );
  });
});
