import { verifyBasicAuth } from "../basic-auth.js";
import { readCookie } from "./cookies.js";
import { SESSION_COOKIE, verifySession, sessionClearCookie } from "./session.js";
import { parseAllowedEmails, isAllowedEmail } from "./allowlist.js";

/**
 * The gate every operator endpoint calls.
 *
 * Kept free of `Request`/`Response` on the way in and mostly on the way out —
 * it takes a minimal header/url shape and returns a *description* of the
 * refusal, which `denialResponse` turns into an actual Response. Same split as
 * csrf.ts and `respondToProspectAuditTrigger`: the decision is unit-testable
 * without constructing web platform objects, and the handler stays thin glue.
 */

/** The slice of a request this module reads. A whatwg `Request` satisfies it. */
export type AuthRequestLike = {
  headers: { get: (name: string) => string | null };
  url: string;
};

export type OperatorDenial = {
  status: number;
  headers: Record<string, string>;
  body: string;
  contentType: "text/plain" | "application/json";
};

/**
 * The gate's verdict. On success, `email` is null when entry came via the
 * shared-password fallback, which carries no identity — callers that record who
 * acted must report that honestly rather than inventing a name.
 */
export type OperatorAuth =
  { ok: true; email: string | null } | { ok: false; denial: OperatorDenial };

/**
 * How the caller reaches this route — chosen by what the *browser* does with
 * it, never by the URL prefix.
 *
 * A 302 to Google inside the approve button's `fetch` is useless: the response
 * the script gets back is Google's HTML, not a signal it can act on. So
 * navigations redirect and `fetch` targets get JSON. `report-preview` sits
 * under /api/ but is opened as a link in a new tab, and so redirects; sorting
 * by path would get it wrong.
 */
export type Wants = "redirect" | "json";

export type AuthConfig = {
  secret: string | null;
  allowed: string[];
  clientId: string | null;
  clientSecret: string | null;
  password: string | null;
  /** Every ingredient sign-in needs is present. */
  googleReady: boolean;
};

/** Read the auth environment contract in one place, so the gate and the
 *  sign-in handler can never disagree about what "configured" means. */
export function readAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const secret = env.DASHBOARD_SESSION_SECRET?.trim() || null;
  const allowed = parseAllowedEmails(env.DASHBOARD_ALLOWED_EMAILS);
  const clientId = env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
  const password = env.DASHBOARD_PASSWORD?.trim() || null;
  return {
    secret,
    allowed,
    clientId,
    clientSecret,
    password,
    googleReady: Boolean(secret && clientId && clientSecret && allowed.length > 0),
  };
}

/** The path (plus query) an operator was trying to reach, for `returnTo`. */
export function pathWithQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/";
  }
}

function unauthenticated(wants: Wants, returnTo: string): OperatorDenial {
  if (wants === "json") {
    return {
      status: 401,
      headers: {},
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "unauthenticated",
        message: "Your session has expired. Reload the page to sign in again.",
      }),
    };
  }
  return {
    status: 302,
    headers: { location: `/auth/login?returnTo=${encodeURIComponent(returnTo)}` },
    contentType: "text/plain",
    body: "Sign in to continue.",
  };
}

function denied(wants: Wants): OperatorDenial {
  // Clear the cookie in both shapes: the session is cryptographically valid but
  // its holder is no longer an operator, so leaving it in place would re-run
  // this same rejection on every subsequent request.
  if (wants === "json") {
    return {
      status: 403,
      headers: { "set-cookie": sessionClearCookie() },
      contentType: "application/json",
      body: JSON.stringify({
        ok: false,
        error: "forbidden",
        message: "That account is not authorised for the cockpit.",
      }),
    };
  }
  return {
    status: 302,
    headers: { "set-cookie": sessionClearCookie(), location: "/auth/login?denied=1" },
    contentType: "text/plain",
    body: "That account is not authorised for the cockpit.",
  };
}

function unconfigured(wants: Wants): OperatorDenial {
  const message =
    "The cockpit is unconfigured — no sign-in method is available. Set the Google " +
    "OAuth variables (or DASHBOARD_PASSWORD) in the Netlify site env.";
  if (wants === "json") {
    return {
      status: 503,
      headers: {},
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "unconfigured", message }),
    };
  }
  return { status: 503, headers: {}, contentType: "text/plain", body: message };
}

/**
 * Decide whether this request may act as an operator.
 *
 * The order matters, and one part of it is easy to get wrong. Google
 * configuration and the shared-password fallback are checked *independently*:
 * treating a missing `DASHBOARD_ALLOWED_EMAILS` as an immediate 503 — the
 * obvious way to write "fail closed" — would 503 every deploy preview, where
 * Google sign-in cannot work (no wildcard redirect URIs) and the shared
 * password is the only way in. Each mechanism is unconfigured on its own terms;
 * only the absence of *both* is a misconfiguration.
 */
export function requireOperator(
  req: AuthRequestLike,
  opts: { wants: Wants; env?: NodeJS.ProcessEnv; now?: Date },
): OperatorAuth {
  const config = readAuthConfig(opts.env ?? process.env);
  const now = opts.now ?? new Date();

  // 1. A signed session, re-checked against the current allowlist. This is the
  //    revocation mechanism: removing an address ends access on the next click
  //    even though the cookie itself is still perfectly valid.
  if (config.secret) {
    const payload = verifySession(
      readCookie(req.headers.get("cookie"), SESSION_COOKIE),
      config.secret,
      now,
    );
    if (payload) {
      if (isAllowedEmail(payload.email, config.allowed)) {
        return { ok: true, email: payload.email };
      }
      return { ok: false, denial: denied(opts.wants) };
    }
  }

  // 2. The shared-password fallback: deploy previews, and the first day of the
  //    rollout. No identity to report.
  if (config.password && verifyBasicAuth(req.headers.get("authorization"), config.password)) {
    return { ok: true, email: null };
  }

  // 3. Neither mechanism configured — say so rather than admitting everyone.
  if (!config.googleReady && !config.password) {
    return { ok: false, denial: unconfigured(opts.wants) };
  }

  // 4. Configured, but this caller has not authenticated.
  return { ok: false, denial: unauthenticated(opts.wants, pathWithQuery(req.url)) };
}

/** Turn a denial into the Response a Netlify handler returns. */
export function denialResponse(denial: OperatorDenial): Response {
  return new Response(denial.body, {
    status: denial.status,
    headers: { "content-type": `${denial.contentType}; charset=utf-8`, ...denial.headers },
  });
}
