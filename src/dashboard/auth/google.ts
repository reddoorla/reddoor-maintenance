import { createHash, randomBytes } from "node:crypto";

/**
 * The Google half of sign-in: PKCE, the authorization URL, the code exchange,
 * and reading back a verified address.
 *
 * Endpoints confirmed against
 * https://accounts.google.com/.well-known/openid-configuration on 2026-08-25.
 * They are hardcoded rather than discovered at runtime: one fewer network call
 * on the sign-in path, one fewer thing that can be down, and this URL set has
 * been stable for years. If Google ever moves them, the discovery document
 * above is where the new values come from.
 */

export const GOOGLE_AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_ENDPOINT = "https://openidconnect.googleapis.com/v1/userinfo";

/** `openid email` and nothing more. The cockpit needs to know *who*, not their
 *  display name or profile picture. */
export const GOOGLE_SCOPES = "openid email";

/** Injectable so every test runs offline. */
export type GoogleDeps = { fetch: typeof fetch };

export function defaultGoogleDeps(): GoogleDeps {
  return { fetch };
}

export type PkcePair = { verifier: string; challenge: string };

/**
 * A PKCE verifier and its S256 challenge.
 *
 * PKCE is not strictly required for a confidential client — we hold a client
 * secret — but it is free and it closes authorization-code injection, where an
 * attacker feeds their own code into someone else's session.
 *
 * 32 random bytes base64url-encode to 43 characters, the minimum RFC 7636
 * allows and comfortably enough entropy.
 */
export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/** Opaque CSRF value tying a callback back to the request that started it. */
export function randomState(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Build the URL to send the operator to.
 *
 * `selectAccount` adds `prompt=select_account`, used only on the "try a
 * different account" path. Defaulting it on would force the account chooser at
 * every sign-in; leaving it off entirely would trap someone whose browser has
 * cached the wrong Google account in a loop they cannot escape.
 */
export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
  selectAccount?: boolean;
}): string {
  const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", opts.clientId);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES);
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (opts.selectAccount) url.searchParams.set("prompt", "select_account");
  return url.toString();
}

export type TokenExchangeResult = { ok: true; accessToken: string } | { ok: false; error: string };

/**
 * Trade an authorization code for tokens.
 *
 * Never throws: a network failure and a rejected code are both `{ ok: false }`,
 * so the handler has one failure path rather than a try/catch plus a branch.
 */
export async function exchangeCodeForTokens(
  opts: {
    code: string;
    verifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  deps: GoogleDeps = defaultGoogleDeps(),
): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    code: opts.code,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    redirect_uri: opts.redirectUri,
    grant_type: "authorization_code",
    code_verifier: opts.verifier,
  });

  let res: Response;
  try {
    res = await deps.fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) {
    // Google's error bodies are small and secret-free ({"error":"invalid_grant"}).
    // Truncated anyway — an error string from an upstream is not a place to
    // relax about what might be in it.
    const detail = await res.text().catch(() => "<no body>");
    return { ok: false, error: `token endpoint ${res.status}: ${detail.slice(0, 200)}` };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "token endpoint returned a non-JSON body" };
  }
  const accessToken = (parsed as Record<string, unknown>)?.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, error: "token endpoint returned no access_token" };
  }
  return { ok: true, accessToken };
}

export type VerifiedEmailResult = { ok: true; email: string } | { ok: false; error: string };

/**
 * Read the signed-in address from Google's userinfo endpoint.
 *
 * The token response also carries an `id_token` whose signature OIDC Core
 * §3.1.3.7 permits skipping when it arrives straight from the token endpoint
 * over TLS, which would save this round trip. Doing that would put a "decode
 * this JWT without verifying it" helper in the codebase — a genuinely
 * dangerous thing for someone to later reuse on a token from an untrusted
 * source. Sign-in is rare; the extra request costs nothing that matters.
 *
 * `email_verified` is required. An unverified address on a Google account is
 * not proof of controlling that mailbox, so matching it against the allowlist
 * would be matching against something the holder chose rather than something
 * Google checked.
 */
export async function fetchVerifiedEmail(
  accessToken: string,
  deps: GoogleDeps = defaultGoogleDeps(),
): Promise<VerifiedEmailResult> {
  let res: Response;
  try {
    res = await deps.fetch(GOOGLE_USERINFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  if (!res.ok) return { ok: false, error: `userinfo ${res.status}` };

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { ok: false, error: "userinfo returned a non-JSON body" };
  }
  const record = (parsed ?? {}) as Record<string, unknown>;
  const email = record.email;
  if (typeof email !== "string" || email.length === 0) {
    return { ok: false, error: "userinfo returned no email" };
  }
  if (record.email_verified !== true) {
    return { ok: false, error: "google reports this address as unverified" };
  }
  return { ok: true, email: email.trim().toLowerCase() };
}
