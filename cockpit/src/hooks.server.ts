import type { Handle } from "@sveltejs/kit";
import { requireOperator, denialResponse } from "../../src/dashboard/auth/require.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";

/**
 * Every cockpit page is operator-only, through the same gate the Netlify page
 * functions call: a signed session cookie, or the shared-password fallback where
 * that is still allowed. Navigations are redirected to sign-in, never sent JSON.
 * Sign-in itself (`/auth/*`) and the `/api/*` endpoints stay with the Netlify
 * functions.
 */
/**
 * Prefixes that belong to the Netlify functions or to the build, never to a
 * cockpit page. A path under one that no function owns (`/api/nope`, `/r/a/b`,
 * `/_app/remote/x`) still reaches this app through the catch-all, and the edge
 * rate limit leaves these prefixes alone, so the gate below would be an
 * unlimited password oracle there (302 for a wrong password, 404 for the right
 * one). They are answered 404 before the gate instead. The edge function's
 * `excludedPath` must list the same prefixes; a test binds the two.
 */
export const NOT_COCKPIT_PREFIXES = ["/api/", "/auth/", "/r/", "/.netlify/", "/_app/"] as const;

export const handle: Handle = async ({ event, resolve }) => {
  // The raw request path: SvelteKit rewrites `event.url` for its own requests
  // (a remote call's is not `/_app/remote/…`), so it cannot be trusted here.
  const path = new URL(event.request.url).pathname;
  if (NOT_COCKPIT_PREFIXES.some((p) => path.startsWith(p))) {
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
