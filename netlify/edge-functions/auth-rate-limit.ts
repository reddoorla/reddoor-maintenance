/**
 * The sign-in pages' per-IP rate limit, stricter than the dashboard's shared
 * budget (cockpit-rate-limit.ts): `/auth/basic` checks the shared password and
 * `/auth/*` is reachable signed out, so a guessing loop meets 30 a minute, the
 * limit the old `auth` function declared. It changes nothing else.
 */

type EdgeContext = { next: () => Promise<Response> };

export default (_request: Request, context: EdgeContext): Promise<Response> => context.next();

// A literal: Netlify reads this config statically, not by running the module.
export const config = {
  path: "/auth/*",
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};
