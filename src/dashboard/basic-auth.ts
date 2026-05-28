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
 * Wrong-password compare is constant-time; lengths are checked first
 * (timingSafeEqual throws on mismatch, and the length itself doesn't
 * leak — operator's password length is fixed per deploy).
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
  if (provided.length !== expectedPassword.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf-8"), Buffer.from(expectedPassword, "utf-8"));
}
