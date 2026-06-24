# Refresh fleet state — design

**Date:** 2026-06-24
**Status:** Approved (brainstorm)

## Goal

Give the operator a single cockpit button that, on demand, re-runs the fleet-wide
state sweeps that normally only run on a nightly cron — so the dashboard's
vulnerabilities, auto-check signals, Lighthouse scores, and GitHub signals can be
refreshed immediately instead of waiting for the next night.

## Background — what produces fleet state

Two GitHub Actions workflows in `reddoorla/reddoor-maintenance` produce ~all the
cockpit/report state, and **both already expose `workflow_dispatch`**:

- **`fleet-security.yml`** (cron 06:00 UTC) → vulnerabilities (`Security advisories`),
  `Security Auto-Fix Attempts` counters, the Security-Updates auto-check.
- **`fleet-lighthouse.yml`** (cron 08:00 UTC) → Lighthouse scores, domain/browser/links
  audits, the Google-indexed auto-check, **and** the `github-signals` sweep (open PRs /
  CI rollup / last-commit) which runs as a step inside it.

Dispatching both therefore refreshes everything the user named ("vulns, auto checks, etc.").

## Scope decision

Dispatch **both** sweeps (full refresh). The user explicitly wants vulns + auto-checks;
those span both workflows. The Lighthouse leg is a multi-minute Playwright matrix, but it
already runs nightly — manual dispatch just runs it now.

Out of scope: splitting `github-signals` into its own lighter workflow (would be needed
only for a "signals without Lighthouse" mode, which was not chosen).

## Architecture

A fleet-level sibling of the per-site Trigger Renovate action (#303/#305). It reuses the
established authed-write pattern and the `fetch`-based `makeGitHubRest` client (the dashboard
runs on Netlify/Lambda, where the `gh` CLI is absent — see
`2026-06-24-interactive-cockpit-design.md` and the #305 hotfix).

### Component 1 — pure core: `src/dashboard/refresh-fleet.ts`

```
export const FLEET_REFRESH_WORKFLOWS = ["fleet-security.yml", "fleet-lighthouse.yml"] as const;

export type RefreshFleetDeps = {
  // Dispatch one workflow file on the central repo's default branch. Throws on failure.
  dispatch: (workflow: string) => Promise<void>;
};

export type RefreshFleetResult = {
  dispatched: string[];                          // workflow files that fired
  failed: { workflow: string; error: string }[]; // workflow files that threw
};

export async function refreshFleetState(deps: RefreshFleetDeps): Promise<RefreshFleetResult>;
```

Dispatches each workflow **independently** (one failure does not prevent the other), never
throws, and returns a partial result. This mirrors the best-effort posture of
`applyAutoFixAttemptUpdates`.

### Component 2 — endpoint: `netlify/functions/refresh-fleet.mts` → `POST /api/fleet/refresh`

Same gate chain as `trigger-renovate.mts`:

1. `GET` → health-check JSON (presence of `AIRTABLE_PAT`, `AIRTABLE_BASE_ID`,
   `DASHBOARD_PASSWORD`, `RENOVATE_TOKEN`), mirroring the other endpoints.
2. `POST`: `isCsrfAllowed` → 403; `DASHBOARD_PASSWORD` missing → 503; `verifyBasicAuth` →
   401; token (`RENOVATE_TOKEN` ?? `GH_TOKEN`) absent → `not-configured` 503.
3. Build `makeGitHubRest({ token })`; resolve the central repo's default branch once; pass a
   `dispatch` that fires `gh.dispatchWorkflow(centralRepo, workflow, ref)`.
4. Map result: all dispatched → `200 {ok:true, dispatched, failed:[]}`; partial →
   `200 {ok:true, dispatched, failed}`; **both** failed → `502 {ok:false, error:"dispatch-failed", failed}`.
5. `handlerError` on any unexpected throw.

`config.path = ["/api/fleet/refresh", "/.netlify/functions/refresh-fleet"]`,
`rateLimit { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] }`.

**Central repo:** a constant `CENTRAL_REPO = "reddoorla/reddoor-maintenance"` with a
`process.env.GITHUB_REPOSITORY` override (the standard Actions var shape `owner/repo`), so a
fork/rename doesn't hardcode-break it.

### Component 3 — UI: cockpit header button (`src/dashboard/fleet-render.ts`)

A single **"↻ Refresh fleet state"** button in the cockpit header (alongside the filter
chips), rendered fleet-level (NOT per-site). Behavior in the cockpit's inline script:

1. On click → `confirm("Kick off the security + Lighthouse sweeps for the whole fleet? They
   take a few minutes.")` — these are heavy fleet-wide runs; a misclick is expensive (the
   per-site Trigger Renovate has no confirm, but it's cheap and idempotent; this is not).
2. `fetch("/api/fleet/refresh", { method: "POST" })` (same-origin; Basic-auth creds replay).
3. Transient button status: success → **✓ "Refresh started — vulns & scores update in a few
   min"**, disabled briefly; partial/failure → **✗ "<sweep> failed to start"**.

No live run link: `workflow_dispatch` returns `204` with no run id, so the exact run can't be
deep-linked. The message sets the expectation to check back.

## Data flow

operator click → `confirm` → `POST /api/fleet/refresh` → auth gates → `makeGitHubRest` →
2× `workflow_dispatch` on `reddoorla/reddoor-maintenance` → GitHub Actions run the sweeps →
sweeps write to Airtable/Turso → operator reloads cockpit later → refreshed state.

## Error handling

- Per-workflow isolation: both fail → 502; one fails → 200 with `failed:[…]`; UI names the
  failed sweep.
- Token absent → `not-configured` 503 (ships safe; the env var is already set in prod).
- Any unexpected exception → `handlerError` 502, no token leak (the REST client's thrown
  messages carry status + capped body only).

## Testing

- **Pure core** (`tests/dashboard/refresh-fleet.test.ts`): both dispatch → `dispatched=[both]`,
  `failed=[]`; one throws → partial (`dispatched=[one]`, `failed=[other]`); both throw →
  `failed=[both]`, `dispatched=[]`; dispatch is called once per workflow with the right names.
- **Render** (`tests/dashboard/fleet-render.test.ts`): cockpit HTML contains the refresh button
  + its POST target `/api/fleet/refresh`; the inline script wires it.
- `.mts` handler covered by `tsc -p tsconfig.netlify.json` + `test:dist` import-resolution
  ("refresh-fleet.mts resolves all its src/ imports").

## Non-goals / inherent limitations

- The button confirms **dispatch**, not completion. State updates only after the sweeps finish
  (~minutes), write back, and the operator reloads. This is inherent to async workflows.
- No new Airtable fields, no schedule changes, no consumer-facing (`./forms`/`./configs`)
  surface — `refresh-fleet.ts` is internal to the dashboard like `trigger-renovate.ts`.
