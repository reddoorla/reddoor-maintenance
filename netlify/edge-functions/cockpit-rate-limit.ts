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

// The cockpit's five pages, with the limit each page function carried. A
// literal: Netlify reads this config statically, not by running the module.
export const config = {
  path: ["/", "/fleet", "/s/*", "/submissions", "/audits"],
  rateLimit: { windowSize: 60, windowLimit: 60, aggregateBy: ["ip"] },
};
