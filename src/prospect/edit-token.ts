import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The shared `PROSPECT_EDIT_TOKEN` check, used by both audit-report routes.
 *
 * Lifted out of `audit-report-overrides.mts` when the JSON route needed the
 * same check to serve a draft to the editor (W1): its own comment asked for
 * one neutral helper the day a further route needed it, rather than a copy.
 */

/**
 * The bearer token from an Authorization header, or "" for anything else.
 *
 * Case-insensitive on the SCHEME, because RFC 7235 says the scheme is
 * case-insensitive and a caller sending `bearer ` is not an attacker.
 *
 * Whitespace AROUND the token is stripped too — the header is trimmed, and so is
 * the captured value — so `Bearer   s3cret  ` presents as `s3cret` and is
 * accepted. What survives the strip is then compared byte for byte by
 * `tokenMatches`, against a `PROSPECT_EDIT_TOKEN` trimmed the same way, so both
 * sides agree on what surrounding whitespace means. Interior whitespace is part
 * of the secret and is never touched.
 */
export function bearerToken(header: string | null): string {
  const m = /^bearer[ \t]+(.+)$/i.exec((header ?? "").trim());
  return m ? m[1]!.trim() : "";
}

/**
 * Constant-time compare of the presented shared token against the configured
 * one, with respect to BOTH content and length.
 *
 * The SHA-256 is there to EQUALISE LENGTH, and for nothing else.
 * `timingSafeEqual` throws on buffers of different lengths, so a raw compare
 * needs a length guard, and that early return leaks the expected token's
 * length. Digesting first makes both operands 32 bytes always.
 *
 * Mirrors `verifyFormsToken` in src/forms/token.ts, which names its own
 * variable and so stays separate.
 */
export function tokenMatches(given: string, expected: string): boolean {
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

/**
 * Whether a request carries the configured `PROSPECT_EDIT_TOKEN` as its bearer.
 * False when the variable is unset or blank: fails closed, so an unconfigured
 * deploy never treats a request as the editor.
 */
export function carriesEditToken(req: Request): boolean {
  const configured = (process.env.PROSPECT_EDIT_TOKEN ?? "").trim();
  if (!configured) return false;
  const given = bearerToken(req.headers.get("authorization"));
  return given !== "" && tokenMatches(given, configured);
}
