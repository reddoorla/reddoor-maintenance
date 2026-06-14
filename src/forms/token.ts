import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time compare of a presented ingest token against the configured
 * FORMS_INGEST_TOKEN. Byte lengths are checked first (timingSafeEqual throws on
 * a length mismatch). Returns false on any missing/blank/mismatched input.
 */
export function verifyFormsToken(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!presented || !expected) return false;
  const a = Buffer.from(presented, "utf-8");
  const b = Buffer.from(expected, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Extract the bearer token from an Authorization header, or null. */
export function bearerToken(authHeader: string | null | undefined): string | null {
  if (!authHeader) return null;
  const m = /^bearer\s+(.+)$/i.exec(authHeader.trim());
  return m ? m[1]!.trim() : null;
}
