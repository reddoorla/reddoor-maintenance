/**
 * The sign-in pages' per-IP rate limit, stricter than the dashboard's shared
 * budget (cockpit-rate-limit.ts): `/auth/*` is reachable signed out and
 * `/auth/basic` checks the shared password, so it keeps the 30 a minute the old
 * `auth` function declared. It is not the whole bound on password guessing:
 * the pages and `/api/*` also take the shared password as Basic auth, on the
 * shared budget of 120, so one IP gets at most 150 guesses a minute across the
 * two. It changes nothing else.
 */

type EdgeContext = { next: () => Promise<Response> };

export default (_request: Request, context: EdgeContext): Promise<Response> => context.next();

// A literal: Netlify reads this config statically, not by running the module.
export const config = {
  path: "/auth/*",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};
