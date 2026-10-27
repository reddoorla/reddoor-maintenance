import { sign, verify } from "./signing.js";
import { serializeCookie, clearCookie } from "./cookies.js";

/**
 * The short-lived cookie that carries one in-flight sign-in: the CSRF `state`,
 * the PKCE verifier, and where the operator was heading before we interrupted
 * them.
 *
 * It is signed even though it is HttpOnly. HttpOnly only stops *scripts* from
 * reading a cookie — the person at the keyboard can still edit it in devtools,
 * and `returnTo` rides inside it. Signing means a hand-edited returnTo fails
 * verification rather than being honoured.
 */

export const STATE_COOKIE = "rd_auth_state";

/** 10 minutes: comfortably longer than a Google sign-in, short enough that an
 *  abandoned attempt cannot be resumed later from a shared machine. */
export const STATE_TTL_SECONDS = 10 * 60;

export type OAuthState = {
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
};

export function mintOAuthState(
  input: { state: string; verifier: string; returnTo: string },
  secret: string,
  now: Date,
  ttlSeconds: number = STATE_TTL_SECONDS,
): string {
  const payload: OAuthState = {
    state: input.state,
    verifier: input.verifier,
    returnTo: safeReturnTo(input.returnTo),
    exp: Math.floor(now.getTime() / 1000) + ttlSeconds,
  };
  return sign(JSON.stringify(payload), secret);
}

/** Verify and unwrap; null for missing, malformed, forged or expired. Never
 *  throws — the input is a cookie. */
export function verifyOAuthState(
  token: string | null | undefined,
  secret: string,
  now: Date,
): OAuthState | null {
  const payload = verify(token, secret);
  if (payload === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const { state, verifier, returnTo, exp } = parsed as Record<string, unknown>;
  if (typeof state !== "string" || state.length === 0) return null;
  if (typeof verifier !== "string" || verifier.length === 0) return null;
  if (typeof returnTo !== "string") return null;
  if (typeof exp !== "number" || !Number.isFinite(exp)) return null;
  if (exp * 1000 <= now.getTime()) return null;

  // Re-validate on the way out as well as in. The signature already proves we
  // minted it, but this costs nothing and means a returnTo can never reach a
  // Location header unchecked, whatever future code path produced the token.
  return { state, verifier, returnTo: safeReturnTo(returnTo), exp };
}

/** True for any C0 control character or DEL. Written as a codepoint scan
 *  rather than a regex so no control byte has to appear literally in this
 *  source file. */
function hasControlChar(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Reduce a caller-supplied `returnTo` to a safe same-origin path, falling back
 * to "/".
 *
 * Without this the login endpoint is an open redirect: `?returnTo=https://evil`
 * would send an operator off-origin at the exact moment they have just proven
 * they trust the page. The dangerous forms are subtler than a bare absolute
 * URL — "//evil.com" is a protocol-relative URL that browsers treat as
 * absolute, and "/\evil.com" is normalised to the same thing by several
 * browsers — so a naive `startsWith("/")` check passes both.
 *
 * Control characters are rejected too: this value ends up in a `Location`
 * header, and an embedded CR or LF is header injection.
 *
 * `/auth/*` is refused as well. It is not a security problem, just a loop —
 * bouncing someone back to the login page after a successful sign-in leaves
 * them staring at a sign-in button they have already used.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw) return "/";
  const value = raw.trim();
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  if (value.startsWith("/\\")) return "/";
  if (hasControlChar(value)) return "/";
  if (value === "/auth" || value.startsWith("/auth/") || value.startsWith("/auth?")) return "/";
  return value;
}

/** `Set-Cookie` for an in-flight sign-in. Scoped to /auth: nothing outside the
 *  sign-in flow has any use for it, so nothing outside /auth should receive it. */
export function stateSetCookie(token: string): string {
  return serializeCookie(STATE_COOKIE, token, {
    maxAgeSeconds: STATE_TTL_SECONDS,
    path: "/auth",
    sameSite: "Lax",
  });
}

/** `Set-Cookie` that clears the in-flight sign-in. Sent on success *and* on
 *  every failure — a state cookie that outlives its attempt is a replayable
 *  credential for the length of its TTL. */
export function stateClearCookie(): string {
  return clearCookie(STATE_COOKIE, "/auth");
}
