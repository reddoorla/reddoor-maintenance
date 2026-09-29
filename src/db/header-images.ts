/** Header images live in Turso `sites.header_image*` (#539, design D5).
 *
 *  - `storeHeaderImage` — the shared write, used by `header-image --write-back`
 *    and by the draft-time refresh.
 *  - `loadHeaderImage` — the reader the send and the re-render use.
 */
import type { Db } from "./client.js";

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
