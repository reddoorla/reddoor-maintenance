/**
 * Impersonation-subject failover, shared by the GA Data client and the Search Console
 * client (both impersonate the same `GA_SUBJECT` list via domain-wide delegation).
 *
 * The point: one personal Workspace account backing every site's analytics is a fleet-wide
 * SPOF — if it's offboarded/suspended or loses property access, all analytics soft-fail to
 * blank at once. With `GA_SUBJECT` as an ordered list, an auth failure on one subject falls
 * through to the next, and a *partial* outage (primary dying, backup carrying) is surfaced
 * as a greppable `subject failover` warning before it becomes a total one.
 */

const AUTH_HTTP_STATUS = new Set([401, 403]);
/** gRPC PERMISSION_DENIED (7) / UNAUTHENTICATED (16) — how the GA Data API surfaces auth. */
const AUTH_GRPC_CODES = new Set([7, 16]);
/** Message shapes across the three auth surfaces: gRPC code names (GA Data), OAuth token
 *  exchange (`invalid_grant` = suspended/deleted subject, `unauthorized_client` = DWD scope
 *  missing), and plain HTTP 401/403 texts (Search Console via gaxios). */
const AUTH_MESSAGE =
  /permission[_ ]denied|unauthenticated|unauthorized|invalid_grant|access[_ ]denied|forbidden|insufficient permission|status code 40[13]/i;

type ErrorShape = {
  code?: number | string;
  status?: number | string;
  response?: { status?: number };
  /** Explicit opt-in marker for errors that aren't auth-shaped per se but mean "this
   *  subject can't do the job, try the next one" (see the search client's empty
   *  sites.list case — that API hides inaccessible properties instead of 403ing). */
  failoverToNextSubject?: boolean;
};

/** True when an error looks like THIS subject's auth/authorization failed — the only
 *  condition worth retrying under a different subject. Network/5xx/bad-input errors
 *  would fail identically for every subject, so they propagate immediately. */
export function isAuthShapedError(e: unknown): boolean {
  const err = e as ErrorShape | null | undefined;
  if (err?.failoverToNextSubject === true) return true;
  if ([err?.status, err?.response?.status].some((s) => AUTH_HTTP_STATUS.has(Number(s))))
    return true;
  if (AUTH_HTTP_STATUS.has(Number(err?.code)) || AUTH_GRPC_CODES.has(Number(err?.code)))
    return true;
  const msg = e instanceof Error ? e.message : String(e);
  return AUTH_MESSAGE.test(msg);
}

/**
 * Run `attempt` with each subject in order until one succeeds. Auth-shaped failures fall
 * through to the next subject; anything else throws immediately. When all subjects fail,
 * the LAST error is thrown — callers keep their existing catch-and-soft-fail behavior.
 * When an earlier subject failed but a later one succeeded, emit ONE console.warn so a
 * dying primary is visible in the cron log before it becomes a total outage.
 */
export async function withSubjectFailover<T>(
  subjects: readonly string[],
  label: string,
  attempt: (subject: string) => Promise<T>,
): Promise<T> {
  if (subjects.length === 0) throw new Error(`${label}: no impersonation subjects configured`);
  const failed: string[] = [];
  let lastError: unknown;
  for (const subject of subjects) {
    try {
      const result = await attempt(subject);
      if (failed.length > 0) {
        console.warn(
          `⚠ ${label} subject failover: ${failed.join("; ")} — succeeded via ${subject}. ` +
            `Restore the failing subject's access or drop it from GA_SUBJECT ` +
            `(docs/runbooks/ga-search-role-account-cutover.md).`,
        );
      }
      return result;
    } catch (e) {
      if (!isAuthShapedError(e)) throw e;
      failed.push(`${subject} (${e instanceof Error ? e.message : String(e)})`);
      lastError = e;
    }
  }
  throw lastError;
}
