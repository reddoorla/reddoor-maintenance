/**
 * Server-side Cloudflare Turnstile verification. Central-only — NOT exported from
 * `src/forms/index.ts`. Never throws: every network failure, timeout, or malformed
 * response collapses to `"unverifiable"` so the ingest caller can fail open (never 502
 * an accepted lead).
 *
 * The four outcomes:
 * - `"pass"` — Cloudflare confirmed the token.
 * - `"fail"` — a bad/FORGED token (`success:false` with `invalid-input-response`).
 * - `"absent"` — the secret IS configured but NO token was forwarded at all. A real
 *   browser that renders the widget always sends one; a completely missing token is the
 *   signature of a direct-POST bot that never loaded the page. Distinct from
 *   `"unverifiable"` so a `requireTurnstile` site can escalate it (see ingest.ts) while
 *   sites that don't render the widget stay unaffected.
 * - `"unverifiable"` — everything else that must never punish a possibly-real visitor:
 *   unset secret (ships dark), network error/timeout, malformed response, and every
 *   benign `success:false` code (expired 300s token / `timeout-or-duplicate`,
 *   `internal-error`, secret misconfig). Crucially, an EXPIRED/duplicate token means a
 *   REAL browser rendered the widget — so it stays fail-open even under requireTurnstile.
 *
 * The full result also carries the siteverify `hostname` — WHERE a passing token was
 * solved. Cloudflare domain-binds sitekeys, but a loose widget allowlist would let a
 * token legitimately solved on one host ride a submission claiming another; ingest
 * compares it to the gated site's own host (defense-in-depth, `requireTurnstile` only).
 * `hostname` is null on every non-pass outcome and when the response omits it.
 */
export type TurnstileOutcome = "pass" | "fail" | "unverifiable" | "absent";

export type TurnstileVerification = {
  outcome: TurnstileOutcome;
  /** siteverify's `hostname` (where the widget was solved) on a `"pass"`; else null. */
  hostname: string | null;
};

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(opts: {
  secret: string | undefined;
  token: string | null | undefined;
  remoteip?: string | undefined;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Abort budget so a slow/hung edge can't stall the ingest response. */
  timeoutMs?: number;
}): Promise<TurnstileVerification> {
  const secret = opts.secret;
  const token = opts.token;
  // No secret configured (ships dark): unverifiable — Turnstile isn't operational
  // centrally, so we can't distinguish absent from anything, and never reach the network.
  if (!secret || secret.trim().length === 0) return { outcome: "unverifiable", hostname: null };
  // Secret IS set but no token was forwarded: ABSENT. On a requireTurnstile site this is
  // the direct-POST-bot tell (a real browser rendering the widget always sends a token);
  // on other sites ingest leaves it neutral. Distinct from "unverifiable" on purpose.
  if (!token || token.trim().length === 0) return { outcome: "absent", hostname: null };

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
      return { outcome: "unverifiable", hostname: null };
    }
    const obj = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    if (!obj || typeof obj.success !== "boolean")
      return { outcome: "unverifiable", hostname: null };
    if (obj.success) {
      return {
        outcome: "pass",
        hostname: typeof obj["hostname"] === "string" && obj["hostname"] ? obj["hostname"] : null,
      };
    }
    // success:false is only a definite negative for a bad/forged token. Benign
    // codes (`timeout-or-duplicate` = expired 300s token or double-submit —
    // real humans), Cloudflare-side `internal-error`, secret/config errors,
    // and unknown/absent codes all fail open.
    const codes = Array.isArray(obj["error-codes"]) ? obj["error-codes"] : [];
    return {
      outcome: codes.includes("invalid-input-response") ? "fail" : "unverifiable",
      hostname: null,
    };
  } catch {
    // Network error or aborted (timeout) — fail open, distinct from a "fail".
    return { outcome: "unverifiable", hostname: null };
  } finally {
    clearTimeout(timer);
  }
}
