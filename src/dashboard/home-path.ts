/**
 * P1-78f: the triage start page's address. The digest's empty-slug and
 * fleet-wide links open it, because the items they carry (a site with no page,
 * `url-probe-stale`) appear among its cardless items, and `/` redirects here
 * until the overview lands there (P1-78g). The overview does not change it.
 */
export const TRIAGE_PATH = "/triage";

/**
 * Where sign-in lands when no safe return path was given. It is the triage page
 * while `/` only redirects there; P1-78g sets it back to "/" when the overview
 * takes the root. This is the one value P1-78g flips; TRIAGE_PATH stays.
 */
export const SIGN_IN_HOME: string = TRIAGE_PATH;
