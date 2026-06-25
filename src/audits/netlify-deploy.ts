import type { AuditResult } from "../types.js";
import type { AuditContext } from "./util/inject.js";
import { siteLabel } from "../util/site.js";

/** Result of probing a site's latest PRODUCTION Netlify deploy. Every field is
 *  nullable: a network/parse failure (or a site with no deploys yet) degrades to
 *  all-nulls rather than throwing, so the audit always returns a verdict.
 *  - `state` is Netlify's raw deploy state (`ready`/`error`/`building`/…), lower-cased,
 *    or null when it couldn't be read.
 *  - `deployedAt` is the deploy's publish/create time (ISO), or null.
 *  - `logUrl` links to the deploy (its live URL or the Netlify admin/build-log page).
 *  - `errorMessage` is Netlify's `error_message` for a failed build, or null. */
export type NetlifyDeployCheck = {
  state: string | null;
  deployedAt: string | null;
  logUrl: string | null;
  errorMessage: string | null;
};

/** Injected IO so the check is unit-testable without hitting the Netlify API.
 *  `fetchLatestProductionDeploy` returns the parsed first (latest) production
 *  deploy object, or null when the site has none / the call failed. `now` is the
 *  clock for the checked-at stamp. */
export type NetlifyDeployDeps = {
  fetchLatestProductionDeploy: (siteId: string) => Promise<NetlifyDeployCheck | null>;
  now: Date;
};

/** The Netlify deploy states we treat as a successful production build. */
const READY_STATES: ReadonlySet<string> = new Set(["ready"]);
/** States that mean the build actually failed — the "needs attention" case. */
const FAILED_STATES: ReadonlySet<string> = new Set(["error", "failed", "rejected"]);
/** States that mean a build is still in flight — neutral, not yet a verdict. */
const IN_PROGRESS_STATES: ReadonlySet<string> = new Set([
  "building",
  "enqueued",
  "new",
  "processing",
  "uploading",
  "preparing",
]);

export function isReadyState(state: string | null): boolean {
  return state !== null && READY_STATES.has(state);
}
export function isFailedState(state: string | null): boolean {
  return state !== null && FAILED_STATES.has(state);
}
export function isInProgressState(state: string | null): boolean {
  return state !== null && IN_PROGRESS_STATES.has(state);
}

/**
 * Probe one Netlify site's latest production deploy. PURE given its deps — the
 * real network/parse work lives in `defaultNetlifyDeployDeps`. A null return from
 * the fetch (no deploys, or a failed/unparseable call) degrades to an all-null
 * check, never a throw.
 */
export async function checkNetlifyDeploy(
  siteId: string,
  deps: NetlifyDeployDeps,
): Promise<NetlifyDeployCheck> {
  const fetched = await deps.fetchLatestProductionDeploy(siteId).catch(() => null);
  if (!fetched) {
    return { state: null, deployedAt: null, logUrl: null, errorMessage: null };
  }
  return fetched;
}

/** Coerce an untrusted value to a trimmed non-empty string, or null. */
function str(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Real Netlify API deps. Fetches the latest production deploy for `siteId` and
 * maps the raw JSON into a `NetlifyDeployCheck`. Any failure — network error,
 * non-2xx, empty list, malformed JSON — resolves to null (the check degrades to
 * all-nulls), NEVER throws: a fleet sweep must not red an unrelated site because
 * one site's Netlify call hiccuped.
 *
 * `fetchImpl` is injected (defaults to the global `fetch`) only so the default
 * deps themselves stay testable; production callers pass nothing.
 */
export function defaultNetlifyDeployDeps(
  token: string,
  now: Date,
  fetchImpl: typeof fetch = fetch,
): NetlifyDeployDeps {
  return {
    now,
    fetchLatestProductionDeploy: async (siteId) => {
      // `production=true` + `per_page=1` asks Netlify for ONLY the newest
      // production deploy, so we read `[0]` without paging. siteId is the
      // Airtable-supplied site identity; encode it so it can't break the path.
      const url =
        `https://api.netlify.com/api/v1/sites/${encodeURIComponent(siteId)}/deploys` +
        `?per_page=1&production=true`;
      let res: Response;
      try {
        res = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        return null;
      }
      if (!res.ok) return null;
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return null;
      }
      if (!Array.isArray(body) || body.length === 0) return null;
      const d = body[0] as Record<string, unknown>;
      const state = str(d["state"]);
      // Prefer the publish time; fall back to create time for an in-progress deploy.
      const deployedAt = str(d["published_at"]) ?? str(d["created_at"]);
      // Prefer the live deploy URL, then the Netlify admin page, then a raw log link.
      const logUrl = str(d["deploy_ssl_url"]) ?? str(d["admin_url"]) ?? str(d["deploy_url"]);
      const errorMessage = str(d["error_message"]);
      return {
        state: state ? state.toLowerCase() : null,
        deployedAt,
        logUrl,
        errorMessage,
      };
    },
  };
}

/**
 * Audit a site's latest PRODUCTION Netlify deploy health. Checkout-free — needs
 * only the site's Netlify id. Degrades gracefully fleet-wide:
 *  - no `site.netlifyId` → skip ("no netlify id"); the site simply isn't on Netlify
 *    (or hasn't been wired up) so there's nothing to check.
 *  - no `NETLIFY_PAT` in the env → skip ("no NETLIFY_PAT"); the whole audit is
 *    unconfigured, which must not red every site.
 *
 * Status mapping: `ready` → pass; a failed build (`error`/`failed`/`rejected`) →
 * fail (the "needs attention" status — it lands the site in the cockpit's attention
 * tier, mirroring a sub-floor Lighthouse score); an in-flight build or any
 * unknown/unreadable state → warn (neutral, no verdict yet). `details` carries
 * `{ state, deployedAt, logUrl, checkedAt }` for the Airtable writer + dashboard.
 */
export async function netlifyDeployAudit(ctx: AuditContext): Promise<AuditResult> {
  const { site } = ctx;
  const label = siteLabel(site);
  if (!site.netlifyId) {
    return { audit: "netlify-deploy", site: label, status: "skip", summary: "no netlify id" };
  }
  const token = process.env.NETLIFY_PAT;
  if (!token) {
    return { audit: "netlify-deploy", site: label, status: "skip", summary: "no NETLIFY_PAT" };
  }

  const now = ctx.now ?? new Date();
  const deps = ctx.netlifyDeployDeps ?? defaultNetlifyDeployDeps(token, now);
  const check = await checkNetlifyDeploy(site.netlifyId, deps);
  const checkedAt = now.toISOString();

  const status: AuditResult["status"] = isReadyState(check.state)
    ? "pass"
    : isFailedState(check.state)
      ? "fail"
      : "warn";

  const summary =
    check.state === null
      ? "no deploy found"
      : isFailedState(check.state)
        ? `deploy ${check.state}${check.errorMessage ? ` — ${check.errorMessage}` : ""}`
        : `deploy ${check.state}`;

  return {
    audit: "netlify-deploy",
    site: label,
    status,
    summary,
    details: {
      state: check.state,
      deployedAt: check.deployedAt,
      logUrl: check.logUrl,
      checkedAt,
    },
  };
}
