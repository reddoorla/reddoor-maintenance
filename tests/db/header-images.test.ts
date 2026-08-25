import { describe, it, expect } from "vitest";
import { openDb } from "../../src/db/client.js";
import { importFleetState, type ImportIo, type RawRecord } from "../../src/db/import-airtable.js";
import {
  storeHeaderImage,
  backfillHeaderImages,
  formatBackfillResult,
  headerImageAttachment,
} from "../../src/db/header-images.js";
import { getSiteBySlug } from "../../src/db/fleet-state.js";

const NOW = new Date("2026-08-24T12:00:00.000Z");
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const site = (id: string, name: string, attachment?: unknown): RawRecord => ({
  id,
  fields: { Name: name, ...(attachment !== undefined ? { "Header image": attachment } : {}) },
});

const ATT = [
  { url: "https://airtable.example/signed/img1", filename: "acme.jpg", type: "image/jpeg" },
];

const io = (records: RawRecord[]): ImportIo => ({
  listWebsiteRecords: async () => records,
  listReportRecords: async () => [],
  fetchAttachment: async () => null,
  now: () => NOW,
});

describe("storeHeaderImage + the read layer", () => {
  it("a stored image reads back through headerImage (filename + type; url is the row itself)", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io([site("recA", "Acme")]));
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

  it("a re-import never wipes the stored image (D5 held end-to-end)", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(db, io([site("recA", "Acme")]));
    await storeHeaderImage(db, "recA", {
      bytes: PNG,
      filename: "acme.jpg",
      contentType: "image/jpeg",
      generatedAt: null,
    });
    await importFleetState(db, io([site("recA", "Acme")]));
    expect((await getSiteBySlug(db, "acme"))?.headerImage).not.toBeNull();
  });
});

describe("backfillHeaderImages", () => {
  it("stores where absent, skips populated, counts attachment-less, names failures — and the line is always emitted", async () => {
    const db = await openDb({ url: ":memory:" });
    await importFleetState(
      db,
      io([
        site("recA", "Acme", ATT), // fetchable → stored
        site("recB", "Bravo", ATT), // BLOB pre-populated → skipped, NOT overwritten
        site("recC", "Charlie"), // no attachment → absent
        site("recD", "Delta", [
          { url: "https://airtable.example/dead", filename: "d.jpg", type: "image/jpeg" },
        ]), // fetch fails → named
      ]),
    );
    await storeHeaderImage(db, "recB", {
      bytes: new Uint8Array([1, 2, 3]),
      filename: "fresh.jpg",
      contentType: "image/jpeg",
      generatedAt: "2026-08-24T00:00:00.000Z",
    });

    const result = await backfillHeaderImages(db, {
      listWebsiteRecords: async () => [
        site("recA", "Acme", ATT),
        site("recB", "Bravo", ATT),
        site("recC", "Charlie"),
        site("recD", "Delta", [
          { url: "https://airtable.example/dead", filename: "d.jpg", type: "image/jpeg" },
        ]),
      ],
      fetchBytes: async (url) => (url.includes("dead") ? null : PNG),
    });

    expect(result).toEqual({ stored: 1, skipped: 1, absent: 1, failed: ["recD"] });
    expect(formatBackfillResult(result)).toContain(
      "HEADER_IMAGE_BACKFILL stored=1 skipped=1 absent=1 failed=1",
    );
    // The populated BLOB survived untouched.
    const b = await db
      .selectFrom("sites")
      .select(["header_image_filename"])
      .where("id", "=", "recB")
      .executeTakeFirst();
    expect(b?.header_image_filename).toBe("fresh.jpg");
    // A backfilled copy carries NO generator stamp.
    const a = await db
      .selectFrom("sites")
      .select(["header_image_generated_at", "header_image_filename"])
      .where("id", "=", "recA")
      .executeTakeFirst();
    expect(a).toEqual({ header_image_generated_at: null, header_image_filename: "acme.jpg" });
  });

  it("a clean no-op run still emits the machine line", () => {
    expect(formatBackfillResult({ stored: 0, skipped: 0, absent: 0, failed: [] })).toBe(
      "HEADER_IMAGE_BACKFILL stored=0 skipped=0 absent=0 failed=0",
    );
  });

  // REGRESSION (2026-08-24): Airtable's uploadAttachment APPENDS, so a stacked field's
  // NEWEST file is the tail. Reading [0] served the oldest forever — how a pre-clean-plate
  // header reached a live announcement (#574/#577). Must stay in step with the mapping in
  // reports/airtable/websites.ts, or the Turso mirror and the send path disagree.
  it("headerImageAttachment takes the NEWEST attachment, not the oldest", () => {
    const stacked = [
      { url: "https://airtable.example/signed/old", filename: "old.jpg", type: "image/jpeg" },
      { url: "https://airtable.example/signed/new", filename: "new.jpg", type: "image/jpeg" },
    ];
    expect(headerImageAttachment(site("recX", "X", stacked))?.filename).toBe("new.jpg");
  });

  it("headerImageAttachment tolerates malformed attachment cells", () => {
    expect(headerImageAttachment(site("recX", "X", "not an array"))).toBeNull();
    expect(headerImageAttachment(site("recX", "X", [{}]))).toBeNull();
    expect(headerImageAttachment(site("recX", "X", [{ url: "https://a/b" }]))).toEqual({
      url: "https://a/b",
      filename: "header-image",
      type: "application/octet-stream",
    });
  });
});
