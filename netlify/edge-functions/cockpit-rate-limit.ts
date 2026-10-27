/**
 * The dashboard's per-IP rate limit (#582, maintenance#1642). The Pro plan
 * honours at most 5 code-based rate-limit rules per project, and with 18
 * declared none applied: from one IP, 260 requests over four limits got no 429.
 * With this rule alone on a deploy preview, request 66 of 90 got one. So the
 * dashboard is one SvelteKit function (pages, `/api/*` and the sign-in pages),
 * and this rule covers all of it with one budget. It changes nothing else:
 * every request goes on to the page. A test refuses a sixth rule site-wide.
 */

type EdgeContext = { next: () => Promise<Response> };

export default (_request: Request, context: EdgeContext): Promise<Response> => context.next();

// Everything the site answers, including the prospect report (`/r/*`) and the
// audit report's JSON (`/api/audit-report/*`), which share this budget. Left
// out: `/auth/*`, which has its own stricter rule (auth-rate-limit.ts);
// `/api/forms/*`, the fleet's contact forms, whose function keeps its own rule;
// `/.netlify/*`, the Resend webhook and the clocks; and the hashed build assets
// (`/_app/*`), which a single page load fetches several of. 120 a minute is
// over twice an operator's busiest plausible minute (a navigation or an action
// a second for most of it, plus the fleet refresh's poll every 10 s) and the
// most generous of the per-function limits it replaces (`audit-report-json`,
// `report-preview`). The cost: the pages and `/api/*` take the shared password
// as Basic auth, so this is also the bound on guessing it there, where the page
// rule declared 60 and the endpoints 20 to 120 (none of which applied).
//
// A literal: Netlify reads this config statically, not by
// running the module.
export const config = {
  path: "/*",
  excludedPath: ["/api/forms/*", "/auth/*", "/.netlify/*", "/_app/*"],
  rateLimit: { windowSize: 60, windowLimit: 120, aggregateBy: ["ip"] },
};
