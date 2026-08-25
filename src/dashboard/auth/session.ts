import { sign, verify } from "./signing.js";
import { serializeCookie, clearCookie } from "./cookies.js";

/**
 * The operator session: a signed cookie carrying a verified Google address and
 * an expiry. No server-side session record exists, deliberately.
 *
 * Revocation does not come from this module. `requireOperator` re-reads the
 * allowlist on every request, so removing an address ends that operator's
 * access on their next click even though their cookie is still cryptographically
 * valid. Rotating DASHBOARD_SESSION_SECRET invalidates every token at once.
 *
 * The consequence, recorded so it is not rediscovered as a surprise: an
 * individual live cookie (a stolen laptop) cannot be revoked on its own without
 * rotating the secret and signing everyone out. That is an accepted trade for a
 * three-operator tool, and the reason to revisit it is the operator list
 * growing, not the calendar.
 */

export const SESSION_COOKIE = "rd_session";

/** 30 days. Long is safe here precisely because the allowlist is re-checked per
 *  request — access can be withdrawn at any moment regardless of cookie age —
 *  and re-authenticating is one click for someone already signed in to Google. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export type SessionPayload = {
  /** Lowercased, Google-verified address. */
  email: string;
  /** Issued-at, epoch seconds. Informational — not enforced. */
  iat: number;
  /** Expiry, epoch seconds. Enforced. */
  exp: number;
};

/**
 * Mint a session token for a verified address.
 *
 * The email is lowercased here so the allowlist comparison downstream never has
 * to care about the casing Google happened to return.
 */
export function mintSession(
  email: string,
  secret: string,
  now: Date,
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload: SessionPayload = {
    email: email.trim().toLowerCase(),
    iat,
    exp: iat + ttlSeconds,
  };
  return sign(JSON.stringify(payload), secret);
}

/**
 * Verify a session token and return its payload, or null if it is missing,
 * malformed, forged, signed with a different secret, or expired.
 *
 * Only `exp` is enforced. `iat` is carried for debugging but deliberately not
 * validated: rejecting a future `iat` would turn ordinary clock skew between
 * deploys into a mysterious sign-out, and buys nothing — the token is signed by
 * us either way.
 */
export function verifySession(
  token: string | null | undefined,
  secret: string,
  now: Date,
): SessionPayload | null {
  const payload = verify(token, secret);
  if (payload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { email, iat, exp } = parsed as Record<string, unknown>;
  if (typeof email !== "string" || email.length === 0) return null;
  if (typeof iat !== "number" || !Number.isFinite(iat)) return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= now.getTime()) return null;

  return { email, iat, exp };
}

/** `Set-Cookie` for a freshly minted session. */
export function sessionSetCookie(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAgeSeconds: SESSION_TTL_SECONDS,
    path: "/",
    sameSite: "Lax",
  });
}

/**
 * `Set-Cookie` that ends the session.
 *
 * SameSite is Lax rather than Strict throughout, and that is a requirement
 * rather than a preference: the OAuth callback is a top-level navigation from
 * accounts.google.com, and Strict withholds cookies on cross-site navigations —
 * so a Strict state cookie would never arrive and every sign-in would fail
 * state validation. Lax sends on top-level GET and withholds on cross-site
 * POST, which is exactly the property this design wants.
 */
export function sessionClearCookie(): string {
  return clearCookie(SESSION_COOKIE, "/");
}
