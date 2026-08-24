/** Header images move to Turso (#539, design D5 completed).
 *
 *  Since Phase 1 the schema has reserved `sites.header_image*` as the image's
 *  home — the importer deliberately never touches those columns — but nothing
 *  wrote them, so the read layer's `headerImage` was null fleet-wide and both
 *  cockpit preflight and approve-report stayed pinned to the Airtable reader.
 *  Two writers close that:
 *
 *  - `storeHeaderImage` — the shared write, used by the header-image CLI's
 *    dual-write (Airtable upload + Turso store, until Phase 5 freezes Airtable)
 *    and by the backfill.
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

type Attachment = { url: string; filename: string; type: string };

/** First "Header image" attachment of a raw Websites record, or null. */
export function headerImageAttachment(rec: RawRecord): Attachment | null {
  const atts = rec.fields["Header image"] as Array<Partial<Attachment>> | undefined;
  const a = atts?.[0];
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
