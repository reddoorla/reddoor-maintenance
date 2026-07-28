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
  /** Set on an `"unverifiable"` caused by `invalid-input-secret` — the token was
   *  minted by a DIFFERENT widget than this secret's (verified empirically
   *  2026-07-28: such an attempt does NOT consume the single-use token), so
   *  `verifyTurnstileWithSecrets` can safely retry with the next widget's secret. */
  wrongSecret?: boolean;
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
    // codes (`timeout-or-duplicate` = double-submit — real humans),
    // Cloudflare-side `internal-error`, secret/config errors, and
    // unknown/absent codes all fail open. NB: Cloudflare documents
    // `invalid-input-response` as "invalid OR expired", so an expired-yet-
    // never-redeemed token also lands in "fail" — acceptable because the
    // widget auto-refreshes tokens before their 300s expiry (`refresh-expired`
    // defaults to auto), making genuine expiry-at-submit rare.
    const codes = Array.isArray(obj["error-codes"]) ? obj["error-codes"] : [];
    if (codes.includes("invalid-input-response")) return { outcome: "fail", hostname: null };
    return {
      outcome: "unverifiable",
      hostname: null,
      // Wrong-widget marker: this (valid) secret belongs to another widget than
      // the token's. Exposed so the multi-widget wrapper can retry; on its own
      // it stays fail-open exactly as before.
      ...(codes.includes("invalid-input-secret") ? { wrongSecret: true } : {}),
    };
  } catch {
    // Network error or aborted (timeout) — fail open, distinct from a "fail".
    return { outcome: "unverifiable", hostname: null };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Multi-widget verification. Cloudflare Turnstile caps a widget at 10
 * hostnames, so a growing fleet spans several widgets — but a token only
 * verifies against ITS widget's secret, and nothing in the forwarded envelope
 * says which widget minted it. Try each configured secret in order: a
 * wrong-widget attempt comes back as `invalid-input-secret` WITHOUT consuming
 * the single-use token (verified against the live API 2026-07-28), so retrying
 * with the next secret is safe. Every other outcome (pass / fail / absent /
 * plain unverifiable) is final on the first attempt that produces it. Order
 * the secrets busiest-widget-first — the retry costs one extra round trip.
 * All-secrets-wrong (or none configured) collapses to "unverifiable",
 * preserving the fail-open contract.
 */
export async function verifyTurnstileWithSecrets(opts: {
  /** Widget secrets to try in order; blank/undefined entries are skipped. */
  secrets: Array<string | undefined>;
  token: string | null | undefined;
  remoteip?: string | undefined;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
  /** Abort budget PER ATTEMPT (see verifyTurnstile). */
  timeoutMs?: number;
}): Promise<TurnstileVerification> {
  const secrets = opts.secrets.filter((s): s is string => !!s && s.trim().length > 0);
  if (secrets.length === 0) return { outcome: "unverifiable", hostname: null };
  let last: TurnstileVerification = { outcome: "unverifiable", hostname: null };
  for (const secret of secrets) {
    last = await verifyTurnstile({
      secret,
      token: opts.token,
      ...(opts.remoteip !== undefined ? { remoteip: opts.remoteip } : {}),
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });
    if (!last.wrongSecret) return last;
  }
  // Every secret was some other widget's — operationally misconfigured, so
  // fail open exactly like the single-secret bad-config path.
  return last;
}
