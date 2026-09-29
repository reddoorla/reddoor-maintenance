import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import type { RawRecord } from "../../src/db/field-map.js";
import { storeHeaderImage, loadHeaderImage } from "../../src/db/header-images.js";
import { getSiteBySlug, mirrorSiteInsert } from "../../src/db/fleet-state.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const site = (id: string, name: string): RawRecord => ({ id, fields: { Name: name } });

async function seeded(rec: RawRecord) {
  const db = await openDb({ url: ":memory:" });
  await mirrorSiteInsert(db, rec, NOW.toISOString());
  return db;
}

describe("storeHeaderImage + the read layer", () => {
  it("a stored image reads back through headerImage (filename + type; url is the row itself)", async () => {
    const db = await seeded(site("recA", "Acme"));
    await storeHeaderImage(db, "recA", {
      bytes: PNG,
      filename: "acme.jpg",
      contentType: "image/jpeg",
      generatedAt: "2026-08-24T12:00:00.000Z",
    });
    const row = await getSiteBySlug(db, "acme");
    expect(row?.headerImage).toEqual({ url: "", filename: "acme.jpg", type: "image/jpeg" });
    const stored = await db.selectFrom("sites").select("header_image").executeTakeFirst();
    expect(new Uint8Array(stored!.header_image as Uint8Array)).toEqual(PNG);
  });

  it("a re-mirror never wipes the stored image (D5 held end-to-end)", async () => {
    const db = await seeded(site("recA", "Acme"));
    await storeHeaderImage(db, "recA", {
      bytes: PNG,
      filename: "acme.jpg",
      contentType: "image/jpeg",
      generatedAt: null,
    });
    await mirrorSiteInsert(db, site("recA", "Acme"), NOW.toISOString());
    expect((await getSiteBySlug(db, "acme"))?.headerImage).not.toBeNull();
  });
});

/**
 * The reader half of D5. `storeHeaderImage` has been dual-writing since the
 * header-image CLI landed — 12 of the 13 maintained sites carry a BLOB in
 * production — but nothing could READ the bytes back, so every consumer still
 * fetched Airtable's signed attachment URL. That is the gap this closes.
 *
 * Deliberately a separate query from the site read: `getSiteBySlug` excludes the
 * BLOB on purpose (it is 0.6–0.8 MB per site in production, and a selectAll
 * would haul megabytes into every dashboard GET and every form ingest). Reading
 * the bytes has to be an explicit, per-site act.
 */
describe("loadHeaderImage", () => {
  it("reads back exactly what storeHeaderImage wrote", async () => {
    const db = await seeded(site("recA", "Acme"));
    await storeHeaderImage(db, "recA", {
      bytes: PNG,
      filename: "acme.jpg",
      contentType: "image/jpeg",
      generatedAt: "2026-08-24T12:00:00.000Z",
    });

    const got = await loadHeaderImage(db, "recA");
    expect(got).not.toBeNull();
    expect(new Uint8Array(got!.bytes)).toEqual(PNG);
    expect(got!.filename).toBe("acme.jpg");
    expect(got!.contentType).toBe("image/jpeg");
  });

  it("returns null for a site with no stored image", async () => {
    const db = await seeded(site("recA", "Acme"));
    expect(await loadHeaderImage(db, "recA")).toBeNull();
  });

  it("returns null for an unknown site id rather than throwing", async () => {
    const db = await seeded(site("recA", "Acme"));
    expect(await loadHeaderImage(db, "recNOPE")).toBeNull();
  });

  it("returns null for a ZERO-LENGTH blob, not just a null one", async () => {
    // The two half-written shapes are different rows in the database and only
    // one of them is a NULL. A failed or truncated store leaves an empty buffer,
    // which `!bytes` does not catch — mutation-testing the null check is what
    // surfaced that the sibling test below never exercised this branch.
    const db = await seeded(site("recA", "Acme"));
    await storeHeaderImage(db, "recA", {
      bytes: new Uint8Array([]),
      filename: "acme.jpg",
      contentType: "image/jpeg",
      generatedAt: null,
    });
    expect(await loadHeaderImage(db, "recA")).toBeNull();
  });

  it("returns null when metadata is present and the BLOB column is NULL", async () => {
    // A half-written row must not read as usable: handing a consumer an empty
    // buffer with a filename would produce a report with a broken header rather
    // than a loud "no header image" failure.
    const db = await seeded(site("recA", "Acme"));
    await db
      .updateTable("sites")
      .set({ header_image_filename: "acme.jpg", header_image_type: "image/jpeg" })
      .where("id", "=", "recA")
      .execute();
    expect(await loadHeaderImage(db, "recA")).toBeNull();
  });
});
