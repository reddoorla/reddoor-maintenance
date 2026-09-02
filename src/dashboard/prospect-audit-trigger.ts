import { assertUrlSegment } from "../github/gh.js";
import { OPERATOR_GOALS } from "../prospect/goals.js";
import { makeGitHubRest } from "../github/gh-rest.js";
import { isHttpUrl, isPrivateOrLoopbackHost, hostnameOf } from "../util/url.js";
import type { ProspectAuditListItem } from "../db/prospect-audits.js";

/**
 * Trigger logic for `POST /api/prospect-audit/run` (netlify/functions/prospect-audit-run.mts).
 * Kept here, deps-injected and framework-free, so it's unit-testable without
 * booting the Netlify handler — same split as trigger-renovate.ts.
 *
 * The audit itself runs as a `workflow_dispatch` in a PRIVATE repo (never this
 * one — this repo's Actions logs are world-readable, and a prospect URL there
 * would publish the sales pipeline), so every dispatch target is read from env
 * at the call site and threaded through as `{ repo, workflowFile }` — nothing
 * here hardcodes a repo.
 */

/** A repeat submission of the SAME url within this window is refused rather
 *  than spending a second audit — the double-press guard. A workflow retry
 *  (or an impatient second click before the first request's 202 lands) must
 *  not double-run and double-email. 10 minutes comfortably exceeds any
 *  plausible client retry/backoff window while staying far shorter than the
 *  audit's own several-minute runtime, so a genuine re-audit of the same
 *  prospect a bit later is never blocked. */
export const PROSPECT_AUDIT_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/** How many of the most-recent audits (across every url) `triggerProspectAudit`
 *  pulls to look for a same-url duplicate inside the window. Usage is
 *  low-volume and human-triggered (one operator, one button), so this comfortably
 *  covers the window without scanning the whole table; well under
 *  MAX_RECENT_PROSPECT_AUDITS (src/db/prospect-audits.ts). */
export const DUPLICATE_CHECK_LOOKBACK = 25;

/** Most audits that may be dispatched in any rolling 24 hours (#612 review).
 *
 *  The duplicate window stops the SAME url being re-run; nothing stopped
 *  DISTINCT urls. One authenticated session could dispatch ~30/minute against
 *  30 hostnames indefinitely, and one audit is structurally an Opus call plus
 *  up to 28 Sonnet calls with up to 112 billed web searches, a 20-page double
 *  crawl, a 3-pass Lighthouse and a PDF render, inside a billed Actions job.
 *
 *  25/day is far above real use (this is one operator clicking a button) and far
 *  below a number that could quietly cost hundreds. A cap that never binds in
 *  normal operation is the point: it is a runaway brake, not a quota. */
export const PROSPECT_AUDIT_DAILY_CAP = 25;

/** Lookback for the daily cap. Must exceed the cap so the count can actually
 *  reach it — a lookback at or below the cap would make the limit unreachable
 *  and the brake permanently disengaged, which is exactly the kind of guard
 *  that reads as working while doing nothing. */
export const DAILY_CAP_LOOKBACK = PROSPECT_AUDIT_DAILY_CAP * 2;

/** The workflow file dispatched when `PROSPECT_AUDIT_WORKFLOW_FILE` is unset. */
export const DEFAULT_PROSPECT_AUDIT_WORKFLOW_FILE = "prospect-audit.yml";

/** Shown in the success message when `PROSPECT_AUDIT_RECIPIENTS` is not mirrored
 *  into this cockpit's env. The authoritative list lives in the PRIVATE dispatch
 *  repo's workflow secrets, which this endpoint cannot read — so name no names.
 *  A message that confidently lists the wrong people is worse than a vague one,
 *  and it would drift silently the day someone is added. */
export const DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL = "the configured recipients";

/** Workflow inputs sent with the dispatch. All-string, matching GitHub Actions'
 *  `workflow_dispatch` input typing. */
export type ProspectAuditDispatchInputs = {
  url: string;
  business: string;
  requested_by: string;
  /** One of OPERATOR_GOALS. Required: see triggerProspectAudit. */
  goal: string;
};

/** Everything a dispatcher needs to fire one run — deliberately narrow (no
 *  GitHub-specific types leak past this boundary) so a future executor (a
 *  different CI, a queue) can implement this same shape without touching the
 *  endpoint or `triggerProspectAudit`. */
export type ProspectAuditDispatchTarget = {
  repo: string; // "owner/repo"
  workflowFile: string;
  inputs: ProspectAuditDispatchInputs;
};

export type ProspectAuditDispatchResult = { ok: true } | { ok: false; error: string };

/** The injectable seam: real dispatch is GitHub Actions today
 *  ({@link makeWorkflowDispatchDispatcher}); tests inject a fake. Never throws —
 *  a failure is reported as `{ ok: false, error }` so callers don't need a
 *  try/catch around every dispatch. */
export type ProspectAuditDispatcher = (
  target: ProspectAuditDispatchTarget,
) => Promise<ProspectAuditDispatchResult>;

const GITHUB_API = "https://api.github.com";

/**
 * The actual dispatch call: a GitHub Actions `workflow_dispatch` against
 * `target.repo`'s default branch, carrying `target.inputs`. Built on
 * `makeGitHubRest` for `defaultBranch` (repo lookup), but hand-rolls the
 * dispatch POST itself — `GitHubRest.dispatchWorkflow` (src/github/gh-rest.ts)
 * only sends `{ ref }`, with no `inputs` support, and this endpoint's whole
 * point is passing `url`/`business`/`requested_by` through to the runner.
 *
 * This is the one piece of the module that is "GitHub Actions" — everything
 * else depends only on the narrow {@link ProspectAuditDispatcher} shape, so
 * swapping the executor later means writing a new function of that type, not
 * touching the trigger logic or the endpoint.
 */
export function makeWorkflowDispatchDispatcher(deps: {
  token: string;
  fetch?: typeof fetch;
}): ProspectAuditDispatcher {
  const doFetch = deps.fetch ?? fetch;
  const gh = makeGitHubRest({ token: deps.token, fetch: doFetch });
  return async ({ repo, workflowFile, inputs }) => {
    try {
      const [owner, name, ...rest] = repo.split("/");
      if (!owner || !name || rest.length > 0) {
        return { ok: false, error: `expected "owner/repo", got ${JSON.stringify(repo)}` };
      }
      const ref = await gh.defaultBranch(repo);
      // Defense in depth, mirroring gh-rest.ts's own dispatchWorkflow — every
      // segment below interpolates into the API path.
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      assertUrlSegment("path", workflowFile);
      assertUrlSegment("branch", ref);
      const res = await doFetch(
        `${GITHUB_API}/repos/${owner}/${name}/actions/workflows/${workflowFile}/dispatches`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${deps.token}`,
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            "user-agent": "reddoor-maintenance-dashboard",
            "content-type": "application/json",
          },
          body: JSON.stringify({ ref, inputs }),
        },
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "<no body>");
        return {
          ok: false,
          error: `GitHub workflow_dispatch ${owner}/${name}/${workflowFile} failed (${res.status}): ${body.slice(0, 300)}`,
        };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
}

/** Everything `triggerProspectAudit` needs from the outside world, injected so
 *  it never touches Turso or the network directly. */
export type ProspectAuditTriggerDeps = {
  /** Newest-first recent audits, e.g. `(limit) => listRecentProspectAudits(db, limit)`. */
  listRecent: (limit: number) => Promise<ProspectAuditListItem[]>;
  dispatch: ProspectAuditDispatcher;
  /** Injectable clock for the duplicate-window check; defaults to `Date.now`. */
  now?: () => Date;
};

export type ProspectAuditTriggerInput = {
  url: string;
  business: string | null;
  requestedBy: string;
  /** What the site should get a visitor to do. Empty is refused. */
  goal: string;
};

export type ProspectAuditTriggerResult =
  | { status: "invalid-url" }
  | { status: "private-host" }
  /** Gate B: a client-facing audit grades the site against a goal a person
   *  chose. Inference is for internal runs; the cockpit is the client path. */
  | { status: "missing-goal" }
  | { status: "duplicate"; existing: ProspectAuditListItem }
  /** The 24h runaway brake tripped (#612 review). Carries both numbers so the
   *  operator sees a real limit rather than a bare refusal. */
  | { status: "daily-cap"; count: number; cap: number }
  | { status: "dispatch-failed"; error: string }
  | { status: "dispatched" };

/**
 * Validate, de-duplicate, then dispatch. Order matches the design's threat
 * model: cheap shape checks first (no DB read, no dispatch) — malformed and
 * private-host input never reach the database or the dispatcher — THEN the
 * duplicate check (one DB read, still no dispatch on a hit) — THEN the 24h
 * runaway brake — THEN, only for a genuinely new, safe, public URL under the
 * cap, the actual dispatch that spends an audit.
 */
export async function triggerProspectAudit(
  deps: ProspectAuditTriggerDeps,
  target: { repo: string; workflowFile: string },
  input: ProspectAuditTriggerInput,
): Promise<ProspectAuditTriggerResult> {
  const url = input.url.trim();
  if (!isHttpUrl(url)) return { status: "invalid-url" };

  // isHttpUrl already proved this parses; re-parsing here is cheap and keeps
  // the hostname extraction local to this one call site.
  const hostname = new URL(url).hostname;
  if (isPrivateOrLoopbackHost(hostname)) return { status: "private-host" };

  const goal = input.goal.trim();
  if (!(OPERATOR_GOALS as readonly string[]).includes(goal)) return { status: "missing-goal" };

  const now = (deps.now ?? (() => new Date()))();
  const cutoff = now.getTime() - PROSPECT_AUDIT_DUPLICATE_WINDOW_MS;
  const recent = await deps.listRecent(Math.max(DUPLICATE_CHECK_LOOKBACK, DAILY_CAP_LOOKBACK));
  const existing = recent.find((r) => r.url === url && Date.parse(r.created_at) >= cutoff);
  if (existing) return { status: "duplicate", existing };

  // Runaway brake. Checked AFTER the duplicate check on purpose: a repeated
  // click on one url should read as "duplicate", which is the truthful and more
  // useful answer, and should not consume the day's budget.
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const today = recent.filter((r) => Date.parse(r.created_at) >= dayAgo).length;
  if (today >= PROSPECT_AUDIT_DAILY_CAP) {
    return { status: "daily-cap", count: today, cap: PROSPECT_AUDIT_DAILY_CAP };
  }

  const business = input.business?.trim() || null;
  const result = await deps.dispatch({
    repo: target.repo,
    workflowFile: target.workflowFile,
    inputs: { url, business: business ?? "", requested_by: input.requestedBy, goal },
  });
  if (!result.ok) return { status: "dispatch-failed", error: result.error };
  return { status: "dispatched" };
}

/**
 * The `requested_by` workflow input: the operator's Google-verified address, or
 * `"cockpit"` when there is no identity to report.
 *
 * This takes `requireOperator`'s verified email rather than reading a name off
 * the request. The predecessor pulled the username out of the `Authorization`
 * header — which `verifyBasicAuth` documents itself as deliberately ignoring,
 * so any operator could type any name and the audit log recorded it verbatim.
 * That made `requested_by` unverified free text, which is precisely the problem
 * Google sign-in was introduced to fix.
 *
 * `null` (the shared-password fallback, used on deploy previews) still yields
 * `"cockpit"`: an anonymous shared credential genuinely has no person behind
 * it, and inventing one would put the old lie back.
 */
export function resolveRequestedBy(operatorEmail: string | null | undefined): string {
  return operatorEmail?.trim() || "cockpit";
}

/** Human label for who gets the audit email, from the optional
 *  `PROSPECT_AUDIT_RECIPIENTS` value (comma-separated names/emails) mirrored
 *  into this cockpit's env, falling back to the design doc's stated audience.
 *  The actual send + its recipient list live in the private dispatch repo's
 *  workflow — this is a best-effort label for the success message only. */
export function prospectAuditRecipientsLabel(raw: string | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL;
  const parts = trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : DEFAULT_PROSPECT_AUDIT_RECIPIENTS_LABEL;
}

/** JSON status + body for one `ProspectAuditTriggerResult`. Kept pure and
 *  separate from the .mts handler so each message is unit-testable directly. */
export function respondToProspectAuditTrigger(
  result: ProspectAuditTriggerResult,
  opts: { recipientsLabel: string },
): { status: number; body: Record<string, unknown> } {
  switch (result.status) {
    case "invalid-url":
      return {
        status: 400,
        body: { ok: false, error: "invalid-url", message: "Enter a valid http(s) URL to audit." },
      };
    case "missing-goal":
      return {
        status: 400,
        body: {
          ok: false,
          error: "missing-goal",
          message:
            "Choose what the site should get a visitor to do. Every client-facing audit grades the site against a goal a person chose.",
        },
      };
    case "private-host":
      return {
        status: 400,
        body: {
          ok: false,
          error: "private-host",
          message: "That host looks internal or private — audits only run against public sites.",
        },
      };
    case "duplicate":
      return {
        status: 409,
        body: {
          ok: false,
          error: "duplicate",
          message: `${hostnameOf(result.existing.url)} was already audited in the last 10 minutes — see the existing report instead of running another.`,
          reportUrl: `/r/${result.existing.token}`,
        },
      };
    case "daily-cap":
      return {
        // 429, not 400: the request is well-formed and the caller is
        // authorised — it is the rate that is refused, and it will succeed
        // again later without any change on their part.
        status: 429,
        body: {
          ok: false,
          error: "daily-cap",
          message: `${result.count} audits have run in the last 24 hours (cap ${result.cap}). This is a runaway brake — if the run is genuinely needed, raise PROSPECT_AUDIT_DAILY_CAP.`,
        },
      };
    case "dispatch-failed":
      return {
        status: 502,
        body: {
          ok: false,
          error: "dispatch-failed",
          message: `Could not start the audit: ${result.error}`,
        },
      };
    case "dispatched":
      return {
        status: 202,
        body: {
          ok: true,
          message: `Audit started. ${opts.recipientsLabel} will get an email with the report in a few minutes.`,
        },
      };
  }
}
