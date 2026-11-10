import { createHash, timingSafeEqual } from "node:crypto";

const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();

/** True only when `secret` is non-empty and body is an object whose `secret` string equals it. Compare sha256 digests with timingSafeEqual (equal lengths always). */
export function verifyPrismicSecret(body: unknown, secret: string | null | undefined): boolean {
  if (typeof secret !== "string" || secret === "") return false;
  if (typeof body !== "object" || body === null || Array.isArray(body)) return false;
  const given = (body as Record<string, unknown>).secret;
  if (typeof given !== "string") return false;
  return timingSafeEqual(digest(given), digest(secret));
}

export type PrismicWebhook = { type: string; documents: string[] };

/** type defaults to ""; documents = the string entries of body.documents, else []. */
export function parsePrismicWebhook(body: unknown): PrismicWebhook {
  const obj = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const type = typeof obj.type === "string" ? obj.type : "";
  const documents = Array.isArray(obj.documents)
    ? obj.documents.filter((d): d is string => typeof d === "string")
    : [];
  return { type, documents };
}
