import type { Context, Config } from "@netlify/functions";
import { readAuthConfig } from "../../src/dashboard/auth/require.js";
import {
  createPkcePair,
  randomState,
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchVerifiedEmail,
} from "../../src/dashboard/auth/google.js";
import {
  mintOAuthState,
  verifyOAuthState,
  safeReturnTo,
  stateSetCookie,
  stateClearCookie,
  STATE_COOKIE,
} from "../../src/dashboard/auth/oauth-state.js";
import {
  mintSession,
  sessionSetCookie,
  sessionClearCookie,
} from "../../src/dashboard/auth/session.js";
import { isAllowedEmail } from "../../src/dashboard/auth/allowlist.js";
import { readCookie } from "../../src/dashboard/auth/cookies.js";
import { renderLoginPageHtml } from "../../src/dashboard/auth/render.js";
import { verifyBasicAuth } from "../../src/dashboard/basic-auth.js";
import { resolveDashboardBaseUrl, handlerError } from "../../src/dashboard/handler-helpers.js";

/**
 * Sign-in: the only routes on the dashboard that are NOT behind
 * `requireOperator`. They cannot be — the login page has to be reachable by
 * someone who is not yet signed in.
 *
 * Four paths on one function, the same convention refresh-fleet.mts uses for
 * /api/fleet/refresh and its /status poll.
 */
export const config: Config = {
  path: ["/auth/login", "/auth/callback", "/auth/logout", "/auth/basic"],
  // An unauthenticated surface, so capped harder than the read-only dashboards.
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

/** The redirect URI registered with Google. Derived from the same helper the
 *  rest of the dashboard uses so it cannot drift from the registered value —
 *  Google matches it exactly and permits no wildcards. */
function redirectUri(): string {
  return `${resolveDashboardBaseUrl(process.env.DASHBOARD_BASE_URL)}/auth/callback`;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, "content-type": "text/plain; charset=utf-8" });
  // Multiple Set-Cookie headers need append, not set — a success response
  // carries both the new session and the cleared state cookie.
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response("Redirecting…", { status: 302, headers });
}

function loginRedirect(params: Record<string, string>, cookies: string[] = []): Response {
  const query = new URLSearchParams(params).toString();
  return redirect(`/auth/login${query ? `?${query}` : ""}`, cookies);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Never let a sign-in page be cached or indexed.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function plainText(body: string, status: number, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...extra },
  });
}

/** GET /auth/login — render the page, or begin the Google flow. */
function handleLogin(url: URL): Response {
  const auth = readAuthConfig();
  const returnTo = safeReturnTo(url.searchParams.get("returnTo"));
  const start = url.searchParams.get("start") === "1";
  const switchAccount = url.searchParams.get("switch") === "1";

  if (!start && !switchAccount) {
    return html(
      renderLoginPageHtml({
        returnTo,
        denied: url.searchParams.get("denied") === "1",
        errorCode: url.searchParams.get("error"),
        basicFallbackAvailable: Boolean(auth.password),
      }),
    );
  }

  // Beginning the flow needs the full Google configuration. Falling back to the
  // page with ?error=config rather than 503 keeps the shared-password link
  // reachable on a deploy where only that is configured.
  if (!auth.googleReady || !auth.secret || !auth.clientId) {
    return loginRedirect({ error: "config" });
  }

  const { verifier, challenge } = createPkcePair();
  const state = randomState();
  const stateToken = mintOAuthState({ state, verifier, returnTo }, auth.secret, new Date());
  return redirect(
    buildAuthorizeUrl({
      clientId: auth.clientId,
      redirectUri: redirectUri(),
      state,
      challenge,
      selectAccount: switchAccount,
    }),
    [stateSetCookie(stateToken)],
  );
}

/** GET /auth/callback — the registered redirect URI. */
async function handleCallback(req: Request, url: URL): Promise<Response> {
  const auth = readAuthConfig();
  if (!auth.googleReady || !auth.secret || !auth.clientId || !auth.clientSecret) {
    return loginRedirect({ error: "config" }, [stateClearCookie()]);
  }

  // The state cookie is cleared on EVERY exit from here, success or failure. A
  // state cookie that outlives its attempt is a replayable credential for the
  // rest of its TTL.
  const cleared = [stateClearCookie()];

  // Google reports a refusal (including the operator pressing Cancel) as
  // ?error=. access_denied is a deliberate choice, not a fault — send them back
  // to a clean login page rather than an error message.
  const googleError = url.searchParams.get("error");
  if (googleError) {
    return googleError === "access_denied"
      ? loginRedirect({}, cleared)
      : loginRedirect({ error: "exchange" }, cleared);
  }

  const parsed = verifyOAuthState(
    readCookie(req.headers.get("cookie"), STATE_COOKIE),
    auth.secret,
    new Date(),
  );
  if (!parsed) return loginRedirect({ error: "state" }, cleared);
  if (url.searchParams.get("state") !== parsed.state) {
    return loginRedirect({ error: "state" }, cleared);
  }

  const code = url.searchParams.get("code");
  if (!code) return loginRedirect({ error: "exchange" }, cleared);

  const tokens = await exchangeCodeForTokens({
    code,
    verifier: parsed.verifier,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    redirectUri: redirectUri(),
  });
  if (!tokens.ok) {
    console.error(`[auth] token exchange failed: ${tokens.error}`);
    return loginRedirect({ error: "exchange" }, cleared);
  }

  const identity = await fetchVerifiedEmail(tokens.accessToken);
  if (!identity.ok) {
    console.error(`[auth] userinfo failed: ${identity.error}`);
    const errorCode = identity.error.includes("unverified") ? "unverified" : "userinfo";
    return loginRedirect({ error: errorCode }, cleared);
  }

  if (!isAllowedEmail(identity.email, auth.allowed)) {
    // Logged, because a real person being refused is worth seeing in the
    // function logs — a typo in DASHBOARD_ALLOWED_EMAILS looks exactly like an
    // intruder from the operator's side of the screen.
    console.warn(`[auth] refused sign-in for a non-allowlisted address`);
    return loginRedirect({ denied: "1" }, cleared);
  }

  const session = mintSession(identity.email, auth.secret, new Date());
  return redirect(parsed.returnTo, [...cleared, sessionSetCookie(session)]);
}

/** GET /auth/logout — end the session. */
function handleLogout(): Response {
  return loginRedirect({}, [sessionClearCookie()]);
}

/**
 * GET /auth/basic — deliberately trigger the browser's Basic-auth challenge.
 *
 * Browsers only volunteer Basic credentials to an origin after being
 * challenged once, and the operator gate never sends `WWW-Authenticate` (a
 * native password dialog popping in the middle of a `fetch` is awful). Without
 * this route the shared-password fallback would be unreachable in a browser,
 * which would lock everyone out of deploy previews, where Google sign-in
 * cannot work at all.
 */
function handleBasic(req: Request, url: URL): Response {
  const auth = readAuthConfig();
  // Not configured here — behave as though the route does not exist rather than
  // advertising a password prompt no password can satisfy.
  if (!auth.password) return plainText("Not found.", 404);

  if (verifyBasicAuth(req.headers.get("authorization"), auth.password)) {
    return redirect(safeReturnTo(url.searchParams.get("returnTo")));
  }
  return plainText("Authentication required.", 401, {
    "www-authenticate": 'Basic realm="Reddoor fleet"',
  });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method !== "GET") return plainText("Method not allowed.", 405);

  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return plainText("Bad request.", 400);
  }

  try {
    switch (url.pathname) {
      case "/auth/login":
        return handleLogin(url);
      case "/auth/callback":
        return await handleCallback(req, url);
      case "/auth/logout":
        return handleLogout();
      case "/auth/basic":
        return handleBasic(req, url);
      default:
        return plainText("Not found.", 404);
    }
  } catch (err) {
    return handlerError("auth", err);
  }
};
