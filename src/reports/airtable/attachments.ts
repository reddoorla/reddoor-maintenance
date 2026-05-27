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
  return { bytes: new Uint8Array(ab), contentType };
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
