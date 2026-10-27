import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of a presented ingest token against the configured
 * FORMS_INGEST_TOKEN. Both inputs are SHA-256'd to a fixed 32-byte digest before
 * comparing, so the compare is constant-time with respect to BOTH content AND
 * length — a raw-buffer compare would early-return on a length mismatch and leak
 * the secret's length. (Plain digest, not an HMAC: this is an equality check, not
 * a MAC, and both operands are already secrets.) Returns false on any
 * missing/blank input.
 */
export function verifyFormsToken(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!presented || !expected) return false;
  const a = createHash("sha256").update(presented, "utf-8").digest();
  const b = createHash("sha256").update(expected, "utf-8").digest();
  return timingSafeEqual(a, b);
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1]!.trim() : null;
}
