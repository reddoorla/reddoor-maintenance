/**
 * #539 Phase 5: `ensure-site` CREATES a Websites row, and every site mirror
 * built so far is an UPDATE — which does nothing at all for a row that does not
 * exist yet. So a site bootstrapped at 09:05 was invisible to Turso until the
 * 09:20 sync, and every mirror the bootstrap fired afterwards reported
 * `mirrored=missed` because there was no row to update.
 *
 * The instrument is EQUIVALENCE WITH `mapWebsiteRecord(rec)`, the same one
 * `mirrorReportInsert` uses.
 *
 * All THREE rows go in, not just `sites`: a later `mirrorHealthFields` would
 * return `missed` forever with nothing to update.
 */
import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { mapWebsiteRecord, type RawRecord } from "../../src/db/field-map.js";
import { mirrorSiteInsert } from "../../src/db/fleet-state.js";

const NOW = "2026-08-25T12:00:00.000Z";

/** The record `ensure-site` creates. */
const CREATED: RawRecord = {
  id: "recNEWSITE",
  fields: {
    Name: "Acme Gallery",
    Status: "building",
    "Git repo": "reddoorla/acme-gallery",
    url: "https://acme.example.com",
    "point of contact": "owner@acme.example.com",
  },
};

/** Name only — every default has to be stored, not omitted from the INSERT. */
const SPARSE: RawRecord = { id: "recBARE", fields: { Name: "Bare Site" } };

async function rowsOf(db: Awaited<ReturnType<typeof openDb>>, id: string) {
  return {
    site: await db.selectFrom("sites").selectAll().where("id", "=", id).executeTakeFirst(),
    health: await db
      .selectFrom("site_health")
      .selectAll()
      .where("site_id", "=", id)
      .executeTakeFirst(),
    schedule: await db
      .selectFrom("site_schedule")
      .selectAll()
      .where("site_id", "=", id)
      .executeTakeFirst(),
  };
}

async function expectEquivalent(rec: RawRecord) {
  const mirrored = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(mirrored, rec, NOW);

  const got = await rowsOf(mirrored, rec.id);
  expect(got.site).toBeDefined();
  const mapped = mapWebsiteRecord(rec, NOW);
  expect(got).toEqual({
    site: {
      ...mapped.site,
      header_image: null,
      header_image_filename: null,
      header_image_type: null,
      header_image_generated_at: null,
    },
    health: mapped.health,
    schedule: mapped.schedule,
  });
}

describe("mirrorSiteInsert ≡ the importer (the Phase 5 site-create instrument)", () => {
  it("a freshly bootstrapped site matches the importer across all three tables", async () => {
    await expectEquivalent(CREATED);
  });

  it("a Name-only record still matches — every default included", async () => {
    await expectEquivalent(SPARSE);
  });

  it("writes site_health and site_schedule rows, not just sites", async () => {
    // mirrorHealthFields would report `missed` forever with nothing to hit.
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(db, CREATED, NOW);
    const rows = await rowsOf(db, CREATED.id);
    expect(rows.health).toBeDefined();
    expect(rows.schedule).toBeDefined();
  });

  it("stores the slug the readers look sites up by", async () => {
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(db, CREATED, NOW);
    const row = await rowsOf(db, CREATED.id);
    expect(row.site?.slug).toBe("acme-gallery");
  });

  it("is an upsert: re-mirroring the same id updates rather than throwing", async () => {
    // ensure-site is re-run to RESUME a bootstrap, so a second create-path pass
    // for the same record must not be a hard error.
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(db, CREATED, NOW);
    await mirrorSiteInsert(
      db,
      { id: CREATED.id, fields: { ...CREATED.fields, Status: "launching" } },
      NOW,
    );
    expect((await rowsOf(db, CREATED.id)).site?.status).toBe("launching");
  });

  it("does NOT blank the header image on a re-mirror", async () => {
    // The header-image CLI dual-writes those columns and the importer never
    // imports them (design D5), so writing the mapped row wholesale on conflict
    // would destroy a stored plate — bytes that live in NO other store.
    const db = await openDb({ url: ":memory:" });
    await mirrorSiteInsert(db, CREATED, NOW);
    await db
      .updateTable("sites")
      .set({
        header_image: Buffer.from("PNGBYTES"),
        header_image_filename: "acme.png",
        header_image_type: "image/png",
      })
      .where("id", "=", CREATED.id)
      .execute();

    await mirrorSiteInsert(db, CREATED, NOW);

    const row = await rowsOf(db, CREATED.id);
    expect(row.site?.header_image_filename).toBe("acme.png");
  });
});
