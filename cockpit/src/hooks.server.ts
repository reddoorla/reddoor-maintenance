import type { Handle } from "@sveltejs/kit";
import { requireOperator, denialResponse } from "../../src/dashboard/auth/require.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";

/**
 * Every cockpit page is operator-only, through `requireOperator`: a signed
 * session cookie, or the shared-password fallback where that is still allowed.
 * Navigations are redirected to sign-in, never sent JSON. The dashboard's own
 * `/api/*` and `/auth/*` endpoints are routes in this app too (one function, one
 * rate-limit budget: maintenance#1642), and they bring their own checks.
 */
/**
 * Prefixes no cockpit page lives under. A path there that no route of this app
 * owns (`/api/nope`, `/r/a/b`, `/_app/remote/x`) still reaches the app as its
 * one function answers `/*`, and the edge rate limit leaves `/auth/*`,
 * `/api/forms/*`, `/.netlify/*` and `/_app/*` to other rules or none, so the
 * gate below would be an unlimited password oracle there (302 for a wrong
 * password, 404 for the right one). They are answered 404 before the gate
 * instead. Every prefix the edge function excludes must sit under one of
 * these; a test binds the two.
 */
export const NOT_COCKPIT_PREFIXES = ["/api/", "/auth/", "/r/", "/.netlify/", "/_app/"] as const;

/**
 * Of those prefixes, the ones this app's endpoint routes live under. A request
 * that matched one of those routes goes to it without the page gate: each
 * `/api/*` handler answers its own methods and runs its own `requireOperator`
 * (JSON denials, not redirects) and, where it changes state, its own CSRF
 * check; `/auth/*` is sign-in itself. A test pins both for every route.
 */
export const ENDPOINT_ROUTE_PREFIXES = ["/api/", "/auth/"] as const;

export const handle: Handle = async ({ event, resolve }) => {
  // The raw request path: SvelteKit rewrites `event.url` for its own requests
  // (a remote call's is not `/_app/remote/…`), so it cannot be trusted here.
  // Compared decoded, lowercased and with runs of slashes collapsed, so no
  // spelling of a prefix (`/%61pi/x`, `/API/x`, `//api/x`, `/api`) gets past
  // this check while an edge router that normalises paths excludes it from the
  // limit. Refusing more than the edge excludes is safe: no page lives there.
  let path = new URL(event.request.url).pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // a malformed escape: compare it as it came
  }
  path = `${path.replace(/[/\\]+/g, "/").toLowerCase()}/`;
  if (NOT_COCKPIT_PREFIXES.some((p) => path.startsWith(p))) {
    const route = event.route.id;
    // The raw path must sit under the same prefix as the route it matched, so a
    // path under a prefix the edge limit skips never reaches an endpoint.
    if (route && ENDPOINT_ROUTE_PREFIXES.some((p) => route.startsWith(p) && path.startsWith(p)))
      return resolve(event);
    return new Response("Not found.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // A state-changing POST from another site is refused before auth, as the page
  // functions refuse it: the browser replays Basic auth cross-site.
  if (event.request.method === "POST" && !isCsrfAllowed(event.request)) {
    return new Response("Cross-site request rejected.", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  // `event.url`, not the raw request URL, so a signed-out data request
  // (`/fleet/__data.json`) returns to the page after sign-in, not to its JSON.
  const auth = requireOperator(
    { headers: event.request.headers, url: event.url.href },
    { wants: "redirect" },
  );
  if (!auth.ok) return denialResponse(auth.denial);
  event.locals.email = auth.email;
  return resolve(event);
};
