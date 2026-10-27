/**
 * P1-78f: the triage page's address. The digest's empty-slug and fleet-wide
 * links open it, because the items they carry (a site with no page,
 * `url-probe-stale`) appear among its cardless items. The overview at `/`
 * (P1-78g) does not change it.
 */
export const TRIAGE_PATH = "/triage";

/**
 * Where sign-in lands when no safe return path was given: the overview at `/`
 * (P1-78g). Kept apart from TRIAGE_PATH, which the digest's links still need.
 */
export const SIGN_IN_HOME: string = "/";
