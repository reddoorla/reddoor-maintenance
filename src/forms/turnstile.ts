/**
 * Server-side Cloudflare Turnstile verification. Central-only — NOT exported from
 * `src/forms/index.ts`. Never throws: every network failure, timeout, unset secret,
 * absent token, or malformed response collapses to `"unverifiable"` so the ingest
 * caller can fail open (never 502 an accepted lead). Only a definite Cloudflare
 * negative (`success: false`) is `"fail"`.
 */
export type TurnstileOutcome = "pass" | "fail" | "unverifiable";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: string | null | undefined;
  remoteip?: string | undefined;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Abort budget so a slow/hung edge can't stall the ingest response. */
  timeoutMs?: number;
}): Promise<TurnstileOutcome> {
  const secret = opts.secret;
  const token = opts.token;
  // No secret configured (ships dark) or no token forwarded (cached page, JS-off
  // visitor): unverifiable, and we never even reach the network.
  if (!secret || secret.trim().length === 0) return "unverifiable";
  if (!token || token.trim().length === 0) return "unverifiable";

  const doFetch = opts.fetch ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 2000);

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (opts.remoteip) body.set("remoteip", opts.remoteip);

  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    let parsed: unknown = null;
    try {
      parsed = await res.json();
    } catch {
      return "unverifiable";
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (!obj || typeof obj.success !== "boolean") return "unverifiable";
    return obj.success ? "pass" : "fail";
  } catch {
    // Network error or aborted (timeout) — fail open, distinct from a "fail".
    return "unverifiable";
  } finally {
    clearTimeout(timer);
  }
}
