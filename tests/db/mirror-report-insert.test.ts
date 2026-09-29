/**
 * #539 Phase 5. The instrument is EQUIVALENCE WITH `mapReportRecord(rec)`, not
 * a column checklist. Asserting that directly means a new Reports column can
 * never be half-mirrored.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { mapReportRecord, type RawRecord } from "../../src/db/field-map.js";
import { mirrorReportInsert } from "../../src/db/fleet-state.js";

/** Every field `createDraft` writes. */
const DRAFT: RawRecord = {
  id: "recRPT_NEW",
  fields: {
    "Report ID": "acme-gallery-2026-08",
    Site: ["recSITE"],
    "Report type": "Maintenance",
    Period: "2026-08",
    "Period start": "2026-08-01",
    "Period end": "2026-08-31",
    "Completed on": "2026-08-25",
    "Lighthouse — Performance": 98,
    "Lighthouse — Accessibility": 100,
    "Lighthouse — Best Practices": 96,
    "Lighthouse — SEO": 92,
    "GA users (period)": 412,
    "GA users (prev period)": 388,
    "Search found page 1": true,
    "Search position": 3,
    "Last tested date": "2026-08-24",
    "Delivery status": "pending",
    "Checklist auto-evidence": JSON.stringify({ "Lighthouse run": { at: "2026-08-25" } }),
  },
};

/** Only the columns `createDraft` never writes — proves the mirror stores the
 *  importer's defaults for them rather than leaving them out of the INSERT. */
const SPARSE: RawRecord = { id: "recRPT_BARE", fields: { "Report ID": "bare" } };

async function rowOf(db: Awaited<ReturnType<typeof openDb>>, id: string) {
  return db.selectFrom("reports").selectAll().where("id", "=", id).executeTakeFirst();
}

async function expectEquivalent(rec: RawRecord) {
  const mirrored = await openDb({ url: ":memory:" });
  await mirrorReportInsert(mirrored, rec);

  const got = await rowOf(mirrored, rec.id);
  expect(got).toBeDefined();
  expect(got).toEqual(mapReportRecord(rec, null));
}

describe("mirrorReportInsert ≡ the importer (the Phase 5 create-side instrument)", () => {
  it("a freshly created draft row matches the importer field for field", async () => {
    await expectEquivalent(DRAFT);
  });

  it("a record carrying only Report ID still matches — every default included", async () => {
    await expectEquivalent(SPARSE);
  });

  it("is an upsert: re-mirroring the same id updates rather than throwing", async () => {
    const db = await openDb({ url: ":memory:" });
    await mirrorReportInsert(db, DRAFT);
    await mirrorReportInsert(db, {
      id: DRAFT.id,
      fields: { ...DRAFT.fields, "Lighthouse — SEO": 71 },
    });
    expect((await rowOf(db, DRAFT.id))?.lighthouse_seo).toBe(71);
  });

  it("preserves an already-stored rendered body, exactly as the importer does", async () => {
    // The mirror never carries HTML (the body is produced after the row exists,
    // by a separate sharp-bearing batch step). Writing the mapped row wholesale
    // on conflict would therefore blank a body that had already been stored —
    // the preview would 404 on a row whose render had demonstrably succeeded.
    const db = await openDb({ url: ":memory:" });
    await mirrorReportInsert(db, DRAFT);
    await db
      .updateTable("reports")
      .set({ rendered_html: "<p>rendered</p>" })
      .where("id", "=", DRAFT.id)
      .execute();

    await mirrorReportInsert(db, DRAFT);

    expect((await rowOf(db, DRAFT.id))?.rendered_html).toBe("<p>rendered</p>");
  });
});
