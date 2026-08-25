/** Cheap HTML sniff: an Airtable signed-URL "200" that is really a login/error page
 *  starts with `<!doctype html`, `<html`, or `<head` after an optional UTF-8 BOM /
 *  leading whitespace. We only need to catch the common error-page case, not parse
 *  HTML. */
function looksLikeHtml(bytes: Uint8Array): boolean {
  // Inspect the first ~64 bytes as ASCII (1 byte → 1 char; enough for a doctype /
  // opening tag). Skip a leading UTF-8 BOM (bytes EF BB BF) by index, then strip any
  // leading ASCII whitespace, and match the common HTML openers case-insensitively.
  const start = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  const head = Buffer.from(bytes.slice(start, start + 64))
    .toString("ascii")
    .replace(/^[\s]+/, "")
    .toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head");
}

export async function fetchAttachmentBytes(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch Airtable attachment ${res.status} ${res.statusText} (url=${url})`,
    );
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  const bytes = new Uint8Array(ab);
  // Sanity-gate the body: a 200 that is actually an HTML error/login page (expired
  // signed URL, auth wall) would otherwise be attached as the "image" and ship a
  // broken header. Accept an explicit image/* content-type; otherwise reject anything
  // that sniffs as HTML — so the send fails loudly rather than emailing a broken image.
  const isImageType = contentType.toLowerCase().startsWith("image/");
  if (!isImageType && looksLikeHtml(bytes)) {
    throw new Error(
      `Airtable attachment did not return image data (content-type="${contentType}", ` +
        `body looks like an HTML page — the signed URL may have expired) (url=${url})`,
    );
  }
  return { bytes, contentType };
}

/**
 * Upload bytes (or a string) as an attachment to a specific record + field.
 * Uses Airtable's content.airtable.com upload endpoint (base64 body) because
 * the standard SDK only accepts public URLs for attachments, and we don't
 * host the generated content anywhere public.
 *
 * Docs: https://airtable.com/developers/web/api/upload-attachment
 *
 * Requires AIRTABLE_PAT + AIRTABLE_BASE_ID in env (same as the rest of the
 * reports module). The fieldName is URL-encoded for the request path.
 */
/**
 * Upload one file into an Airtable attachment field.
 *
 * ⚠️ Airtable's uploadAttachment endpoint APPENDS — it never replaces. Every
 * re-upload therefore stacks another file in the field while readers
 * (`websites.ts`, `db/header-images.ts`) take attachment [0], the OLDEST. Left
 * alone that means a field silently serves a stale image forever: beachfront
 * accumulated four headers and kept sending the first, which is how a
 * pre-clean-plate header reached a 2026-08-24 announcement and got a second
 * headline printed over its baked one.
 *
 * Pass `{ replaceIn: "<table>" }` for a field that should hold exactly one
 * current file (the site header). Omit it where history is wanted (per-period
 * report previews, which are one row per period anyway).
 *
 * The table is part of the option rather than a separate flag because the prune
 * PATCHes `/v0/{baseId}/{table}/{recordId}` — an earlier version omitted the
 * table segment entirely and 403'd on every call, so `replace` cannot be asked
 * for without supplying it.
 */
export async function uploadAttachment(
  recordId: string,
  fieldName: string,
  body: Uint8Array | string,
  filename: string,
  contentType: string,
  opts: { replaceIn?: string } = {},
): Promise<void> {
  const apiKey = process.env.AIRTABLE_PAT;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!apiKey || !baseId) {
    throw new Error("AIRTABLE_PAT and AIRTABLE_BASE_ID must be set");
  }
  const base64 =
    typeof body === "string"
      ? Buffer.from(body, "utf-8").toString("base64")
      : Buffer.from(body).toString("base64");
  const payload = { contentType, file: base64, filename };
  const url = `https://content.airtable.com/v0/${baseId}/${recordId}/${encodeURIComponent(fieldName)}/uploadAttachment`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Airtable upload failed: ${res.status} ${res.statusText} ${await res.text()}`);
  }
  if (!opts.replaceIn) return;

  // The upload response carries the record with the field's full, post-append
  // attachment list. Keep only the last entry (the one just uploaded) by
  // PATCHing the field to that id — Airtable preserves an attachment referenced
  // by id alone and drops any omitted. Best-effort: the file IS uploaded by this
  // point, so a prune failure must not fail the caller; it only leaves the
  // field over-full, which the next successful run tidies.
  try {
    const body = (await res.json()) as {
      fields?: Record<string, Array<{ id?: string }> | undefined>;
    };
    // Airtable keys this response's `fields` by FIELD ID, not field name — verified
    // live 2026-08-24: {"id":"rec…","createdTime":…,"fields":{"fldBUAW180p8MIpvh":[…]}}.
    // Looking it up by NAME therefore yielded undefined, `list` was [], and the
    // `length <= 1` guard returned silently — so `replace` never pruned anything on a
    // real call, while a name-keyed test stub kept it green. Eleven site header fields
    // stacked before the discrepancy surfaced. The endpoint writes exactly ONE field,
    // so its response carries exactly one entry: take it whatever it is keyed by, and
    // fall back to the name in case Airtable ever switches.
    const lists = Object.values(body.fields ?? {}).filter((v) => Array.isArray(v));
    const list = body.fields?.[fieldName] ?? (lists.length === 1 ? lists[0] : undefined);
    if (!list) {
      // Never return quietly here: silence is what let the no-op ship.
      console.warn(
        `⚠ attachment prune skipped for "${fieldName}": upload response carried no ` +
          `attachment list (fields keys: ${Object.keys(body.fields ?? {}).join(", ") || "none"})`,
      );
      return;
    }
    if (list.length <= 1) return;
    const newest = list[list.length - 1]?.id;
    if (!newest) {
      console.warn(`⚠ kept ${list.length} attachments in "${fieldName}": newest entry has no id`);
      return;
    }
    // /v0/{baseId}/{table}/{recordId} — the table segment is REQUIRED. Without it
    // Airtable answers 403 Forbidden (not 404), which reads like a token-scope
    // problem and sent this in the wrong direction once already.
    const patchUrl = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(opts.replaceIn)}/${recordId}`;
    const patch = await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { [fieldName]: [{ id: newest }] } }),
    });
    if (!patch.ok) {
      console.warn(
        `⚠ kept ${list.length} attachments in "${fieldName}" — prune failed: ${patch.status} ${patch.statusText}`,
      );
    }
  } catch (e) {
    console.warn(`⚠ attachment prune skipped for "${fieldName}": ${(e as Error).message}`);
  }
}
