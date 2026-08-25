import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Versioned HMAC-SHA256 over a string payload — the one security primitive the
 * cookie-session scheme rests on. Both the session cookie (session.ts) and the
 * OAuth state cookie (oauth-state.ts) are built from it, which is why it lives
 * on its own rather than inside either.
 *
 * Format: `v1.<base64url(payload)>.<base64url(mac)>`, where the MAC covers the
 * *encoded* payload segment. Signing the encoded form rather than the raw
 * string means verification never has to decode attacker-controlled bytes
 * before deciding whether to trust them.
 *
 * The version prefix exists so the format can change without silently
 * accepting old tokens: bump it and every previously-issued token stops
 * verifying.
 */

const VERSION = "v1";

function mac(encodedPayload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(encodedPayload).digest();
}

/** Sign a payload string. Throws on an empty secret — a deploy that signs with
 *  "" would hand out forgeable tokens, so this fails loudly rather than
 *  quietly issuing them. Callers check their env before getting here. */
export function sign(payload: string, secret: string): string {
  if (!secret) throw new Error("sign: refusing to sign with an empty secret");
  const encoded = Buffer.from(payload, "utf-8").toString("base64url");
  return `${VERSION}.${encoded}.${mac(encoded, secret).toString("base64url")}`;
}

/**
 * Verify and unwrap a token, returning the payload string, or null for any
 * failure: wrong shape, unknown version, bad signature, wrong secret.
 *
 * Never throws. Every input here is attacker-controlled — it arrives in a
 * cookie — so malformed input has to be an ordinary rejection rather than a
 * 500. In particular the MAC's byte length is checked before `timingSafeEqual`,
 * which throws `RangeError` on a length mismatch; this is the same lesson
 * already recorded in basic-auth.ts, where a JS-length guard would have turned
 * a wrong password into an uncaught error.
 */
export function verify(token: string | null | undefined, secret: string): string | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [version, encoded, signature] = parts as [string, string, string];
  if (version !== VERSION || !encoded || !signature) return null;

  const expected = mac(encoded, secret);
  const provided = Buffer.from(signature, "base64url");
  if (provided.length !== expected.length) return null;
  if (!timingSafeEqual(provided, expected)) return null;

  return Buffer.from(encoded, "base64url").toString("utf-8");
}
