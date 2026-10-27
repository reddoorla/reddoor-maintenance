/**
 * P1-78f: where "the cockpit's home" points. The triage start page moved to
 * `/triage`, and until the overview lands at `/` (P1-78g) every fallback that
 * named the root names this instead: the digest's empty-slug and fleet-wide
 * links, and the sign-in return default. `/` answers with a temporary redirect
 * here meanwhile, so an old link still lands on the right page. P1-78g changes
 * this one constant back to "/".
 */
export const COCKPIT_HOME = "/triage";
