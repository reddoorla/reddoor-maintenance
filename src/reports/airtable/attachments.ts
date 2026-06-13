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
export async function uploadAttachment(
  recordId: string,
  fieldName: string,
  body: Uint8Array | string,
  filename: string,
  contentType: string,
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
}
