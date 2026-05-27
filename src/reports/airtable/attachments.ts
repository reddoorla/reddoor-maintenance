export async function fetchAttachmentBytes(url: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Airtable attachment ${res.status} ${res.statusText} (url=${url})`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const ab = await res.arrayBuffer();
  return { bytes: new Uint8Array(ab), contentType };
}
