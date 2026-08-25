import { escapeHtml } from "../../util/html.js";
import { FAVICON_LINK } from "../favicon.js";

/**
 * The sign-in page, and the "signed in as …" fragment the dashboard pages
 * carry in their headers.
 *
 * A page rather than a bare redirect to Google, on purpose: a stale bookmark
 * should not fling someone at an account chooser with no explanation, and
 * "that account is not authorised" needs somewhere to be said.
 */

/**
 * Failure codes the login page knows how to explain.
 *
 * Query text is never echoed into the page — an unknown code falls back to the
 * generic message. Same discipline as `STAGE_FAILED_MESSAGE` in the prospect
 * report: a fixed lookup, so a crafted `?error=` cannot put attacker-chosen
 * prose (or markup) in front of an operator.
 */
export const LOGIN_ERROR_MESSAGE: Record<string, string> = {
  state: "That sign-in link expired or was already used. Try again.",
  exchange: "Google could not complete the sign-in. Try again.",
  userinfo: "Google signed you in but would not share a verified address.",
  unverified: "That Google account's email address is not verified.",
  config: "Sign-in is not configured on this deploy.",
};

const GENERIC_ERROR = "Sign-in did not complete. Try again.";

/** Resolve a code to a message, never trusting the code itself as text. */
export function loginErrorMessage(code: string | null | undefined): string | null {
  if (!code) return null;
  return LOGIN_ERROR_MESSAGE[code] ?? GENERIC_ERROR;
}

const STYLES = `
:root { color-scheme: light dark; }
body { font: 16px/1.5 system-ui, -apple-system, sans-serif; max-width: 26rem; margin: 4rem auto; padding: 0 1rem; color: #1a1a1a; }
@media (prefers-color-scheme: dark) { body { color: #e8e8e8; background: #111; } a { color: #6cb6ff; } .card { border-color: #333; } }
h1 { margin: 0 0 0.25rem; font-size: 1.5rem; }
.meta { color: #666; margin: 0 0 1.5rem; }
.card { border: 1px solid #ddd; border-radius: 10px; padding: 1.5rem; }
.google { display: block; text-align: center; font: inherit; font-weight: 600; padding: 0.7rem 1rem; border-radius: 8px; border: 1px solid #4285f4; background: #4285f4; color: #fff; text-decoration: none; }
.google:hover { background: #3367d6; border-color: #3367d6; }
.notice { padding: 0.7rem 0.9rem; border-radius: 8px; margin-bottom: 1.25rem; font-size: 0.92rem; }
.notice-denied { border: 1px solid #b00; color: #b00; background: #bb000010; }
.notice-error { border: 1px solid #c80; color: #a60; background: #cc880010; }
.alt { margin: 1.25rem 0 0; font-size: 0.85rem; color: #666; text-align: center; }
`;

export type LoginPageInput = {
  /** Where to send the operator once signed in. Already sanitised by
   *  `safeReturnTo` — this renderer escapes but does not validate. */
  returnTo: string;
  /** The account authenticated but is not on the allowlist. */
  denied?: boolean;
  /** A failure code from {@link LOGIN_ERROR_MESSAGE}. */
  errorCode?: string | null;
  /** Whether `DASHBOARD_PASSWORD` is set on this deploy. Controls only whether
   *  the shared-password link is offered — it gates nothing. */
  basicFallbackAvailable: boolean;
};

export function renderLoginPageHtml(input: LoginPageInput): string {
  const returnTo = encodeURIComponent(input.returnTo);
  const error = loginErrorMessage(input.errorCode);

  // "Try a different account" restarts with prompt=select_account. Without it,
  // someone whose browser has cached the wrong Google account is stuck being
  // silently re-authenticated as the account that just got refused.
  const notice = input.denied
    ? `<div class="notice notice-denied">That Google account is not on the cockpit's list. Ask Tucker to add it, or <a href="/auth/login?returnTo=${returnTo}&amp;switch=1">try a different account</a>.</div>`
    : error
      ? `<div class="notice notice-error">${escapeHtml(error)}</div>`
      : "";

  const alt = input.basicFallbackAvailable
    ? `<p class="alt"><a href="/auth/basic?returnTo=${returnTo}">Use the shared password instead</a><br />Deploy previews only — Google sign-in needs the production URL.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  ${FAVICON_LINK}
  <title>Sign in — Reddoor cockpit</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Reddoor cockpit</h1>
  <p class="meta">Operator access only.</p>
  <div class="card">
    ${notice}
    <a class="google" href="/auth/login?returnTo=${returnTo}&amp;start=1">Sign in with Google</a>
    ${alt}
  </div>
</body>
</html>`;
}

/**
 * The "signed in as … · sign out" fragment for a dashboard page header.
 *
 * There is no shared page shell — five renderers each emit their own
 * `<!doctype html>` — so this is a fragment each one drops in rather than a
 * layout. Converting the dashboard to a framework with a real layout is
 * tracked separately (#582); until then, five one-line insertions is the
 * honest cost.
 *
 * Returns empty for a session with no identity (the shared-password fallback):
 * showing "signed in as cockpit" would dress an anonymous shared credential up
 * as a person.
 */
export function renderAuthChrome(email: string | null | undefined): string {
  if (!email) return "";
  // Styled inline rather than by class: the four dashboard pages each carry
  // their own <style> block, and a fragment that depends on a rule existing in
  // all four is a fragment that silently loses its styling in whichever one
  // gets missed.
  return `<div style="float:right;font-size:0.8rem;color:#666">${escapeHtml(email)} · <a href="/auth/logout">sign out</a></div>`;
}
