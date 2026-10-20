/**
 * The per-IP rate limit on the cockpit's pages (#582). Each page used to be a
 * Netlify function declaring `rateLimit: { windowSize: 60, windowLimit: 60,
 * aggregateBy: ["ip"] }`, "so a credential-guessing or scraping loop can't
 * hammer Turso". The SvelteKit adapter writes its page functions itself and
 * takes no rate-limit option, so the same limit sits on this edge function in
 * front of them. It changes nothing else: every request goes on to the page.
 */

type EdgeContext = { next: () => Promise<Response> };

export default (_request: Request, context: EdgeContext): Promise<Response> => context.next();

// Everything the SvelteKit functions answer, with the limit each page function
// carried. That is more than the five page paths: each page's `__data.json`,
// and every unknown path through the catch-all, also run the auth gate (Basic
// auth included) and the page loads. So the limit covers every path except the
// ones other functions own (they keep their own limits) and the hashed build
// assets, which a single page load fetches several of. A literal: Netlify
// reads this config statically, not by running the module.
export const config = {
  path: "/*",
  excludedPath: ["/api/*", "/auth/*", "/r/*", "/.netlify/*", "/_app/*"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};
