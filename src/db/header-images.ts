/** Header images move to Turso (#539, design D5 completed).
 *
 *  Since Phase 1 the schema has reserved `sites.header_image*` as the image's
 *  home — the importer deliberately never touches those columns — but nothing
 *  wrote them, so the read layer's `headerImage` was null fleet-wide and both
 *  cockpit preflight and approve-report stayed pinned to the Airtable reader.
 *  Two writers and one reader close that:
 *
 *  - `storeHeaderImage` — the shared write, used by the header-image CLI's
 *    dual-write (Airtable upload + Turso store, until Phase 5 freezes Airtable)
 *    and by the backfill.
 *  - `loadHeaderImage` — the reader. Until it existed the bytes went in and could
 *    not come out, so every consumer still fetched Airtable's signed URL.
 *  - `backfillHeaderImages` — one-shot: copy every site's CURRENT Airtable
 *    attachment into Turso. Idempotent — a site whose BLOB is already
 *    populated is skipped, so re-runs never clobber a freshly generated image
 *    with a stale Airtable copy. Emits its machine line on EVERY run.
 */
import type { Db } from "./client.js";
import type { RawRecord } from "./import-airtable.js";

export type StoredHeaderImage = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
  /** The generator's stamp; null for a backfilled copy (a backfill is not a
   *  generation — the column keeps meaning "when the generator made it"). */
  generatedAt: string | null;
};

export async function storeHeaderImage(
  db: Db,
  siteId: string,
  image: StoredHeaderImage,
): Promise<void> {
  await db
    .updateTable("sites")
    .set({
      header_image: image.bytes,
      header_image_filename: image.filename,
      header_image_type: image.contentType,
      header_image_generated_at: image.generatedAt,
    })
    .where("id", "=", siteId)
    .execute();
}

/**
 * Read one site's stored header image back.
 *
 * A SEPARATE query from the site read, deliberately. `getSiteBySlug` excludes
 * the BLOB on purpose — it is 0.6–0.8 MB per site in production, so a selectAll
 * would haul megabytes into every dashboard GET and every form ingest — which
 * means reading the bytes has to be an explicit, per-site act rather than a
 * field that arrives for free.
 *
 * Null when the site has no image, when the id is unknown, and when the
 * metadata is present but the BLOB is not: handing a consumer an empty buffer
 * with a filename would render a report with a broken header instead of failing
 * loudly with "no header image".
 */
export async function loadHeaderImage(db: Db, siteId: string): Promise<StoredHeaderImage | null> {
  const row = await db
    .selectFrom("sites")
    .select([
      "header_image",
      "header_image_filename",
      "header_image_type",
      "header_image_generated_at",
    ])
    .where("id", "=", siteId)
    .executeTakeFirst();
  if (!row) return null;
  // Normalize BEFORE measuring. libSQL can hand the BLOB back as an ArrayBuffer
  // rather than a Uint8Array, and an ArrayBuffer has `byteLength`, not `length` —
  // so a naive `bytes.length === 0` compares `undefined` to 0, passes, and lets a
  // zero-length image through as if it were real. Mutation-testing the null check
  // is what exposed that; the guard did not do what its own name said.
  const raw = row.header_image;
  if (raw === null || raw === undefined) return null;
  // `raw` is a Uint8Array on some drivers and an ArrayBuffer on others; the
  // Uint8Array constructor accepts either, but the two do not share a TS type.
  const bytes = new Uint8Array(raw as unknown as ArrayBufferLike);
  if (bytes.length === 0) return null;

  return {
    bytes,
    filename: row.header_image_filename ?? "header-image",
    contentType: row.header_image_type ?? "application/octet-stream",
    generatedAt: row.header_image_generated_at ?? null,
  };
}

type Attachment = { url: string; filename: string; type: string };

/** NEWEST "Header image" attachment of a raw Websites record, or null.
 *
 *  The tail, not the head: Airtable's uploadAttachment APPENDS, so a field that ever
 *  held more than one file served its OLDEST image from `[0]` forever — see the note
 *  in `reports/airtable/websites.ts` and #574/#577. Kept in step with that reader so
 *  the Turso mirror and the send path can never disagree about which file is current. */
export function headerImageAttachment(rec: RawRecord): Attachment | null {
  const atts = rec.fields["Header image"] as Array<Partial<Attachment>> | undefined;
  const a = atts?.at(-1);
  return a && typeof a.url === "string" && a.url.length > 0
    ? {
        url: a.url,
        filename: typeof a.filename === "string" ? a.filename : "header-image",
        type: typeof a.type === "string" ? a.type : "application/octet-stream",
      }
    : null;
}

export type BackfillIo = {
  listWebsiteRecords: () => Promise<RawRecord[]>;
  /** Fetch attachment bytes; null on failure (named in the summary, not fatal). */
  fetchBytes: (url: string) => Promise<Uint8Array | null>;
};

export type BackfillResult = {
  stored: number;
  /** Sites whose BLOB was already populated — never overwritten. */
  skipped: number;
  /** Sites with no Airtable attachment at all. */
  absent: number;
  /** Record ids whose attachment fetch failed — named, never silent. */
  failed: string[];
};

export async function backfillHeaderImages(db: Db, io: BackfillIo): Promise<BackfillResult> {
  const records = await io.listWebsiteRecords();
  const populated = new Set(
    (await db.selectFrom("sites").select("id").where("header_image", "is not", null).execute()).map(
      (r) => r.id,
    ),
  );
  const result: BackfillResult = { stored: 0, skipped: 0, absent: 0, failed: [] };
  for (const rec of records) {
    const att = headerImageAttachment(rec);
    if (!att) {
      result.absent++;
      continue;
    }
    if (populated.has(rec.id)) {
      result.skipped++;
      continue;
    }
    const bytes = await io.fetchBytes(att.url);
    if (bytes === null) {
      result.failed.push(rec.id);
      continue;
    }
    await storeHeaderImage(db, rec.id, {
      bytes,
      filename: att.filename,
      contentType: att.type,
      generatedAt: null,
    });
    result.stored++;
  }
  return result;
}

/** Human lines + the machine line, emitted on every run (count=0 included). */
export function formatBackfillResult(r: BackfillResult): string {
  const lines: string[] = [];
  if (r.failed.length > 0) {
    lines.push(`⚠ ${r.failed.length} attachment fetch(es) failed: ${r.failed.join(", ")}`);
  }
  lines.push(
    `HEADER_IMAGE_BACKFILL stored=${r.stored} skipped=${r.skipped} absent=${r.absent} failed=${r.failed.length}`,
  );
  return lines.join("\n");
}
