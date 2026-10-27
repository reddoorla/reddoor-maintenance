import { timingSafeEqual } from "node:crypto";

/**
 * Verify an `Authorization: Basic <base64>` header against the configured
 * dashboard password. Username is intentionally ignored — operators may
 * type anything when the browser prompts; only the password gates entry.
 *
 * Returns false for any of:
 * - missing/empty Authorization header
 * - non-Basic auth scheme
 * - malformed base64 or payload (no colon to split user:password)
 * - wrong password
 * - expected password missing (DASHBOARD_PASSWORD not configured)
 *
 * Wrong-password compare is constant-time; BYTE lengths are checked first
 * (timingSafeEqual throws a RangeError on a buffer-length mismatch, and the
 * length itself doesn't leak — operator's password length is fixed per deploy).
 * Comparing JS-string lengths instead of byte lengths could let an equal-char
 * but unequal-byte password (a multibyte char) reach timingSafeEqual and throw,
 * turning a wrong password into an uncaught 500.
 */
export function verifyBasicAuth(
  authHeader: string | null | undefined,
  expectedPassword: string | null,
): boolean {
  if (!authHeader || !expectedPassword) return false;
  // RFC 7235: scheme is case-insensitive.
  const match = /^basic\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return false;
  let decoded: string;
  try {
    decoded = Buffer.from(match[1]!, "base64").toString("utf-8");
  } catch {
    return false;
  }
  // Base64-decoding never throws in Node, but a payload of garbage may
  // produce a string with no colon. user:password form is required.
  const colonIdx = decoded.indexOf(":");
  if (colonIdx === -1) return false;
  const provided = decoded.slice(colonIdx + 1);
  // Compare BYTE lengths, not JS-string lengths: timingSafeEqual compares the
  // underlying buffers and throws a RangeError if they differ in byte length.
  // Two strings can share a JS length but differ in UTF-8 byte length (e.g. a
  // multibyte char), so a JS-length guard would let mismatched buffers through
  // and crash the handler with a 500.
  const a = Buffer.from(provided, "utf-8");
  const b = Buffer.from(expectedPassword, "utf-8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
