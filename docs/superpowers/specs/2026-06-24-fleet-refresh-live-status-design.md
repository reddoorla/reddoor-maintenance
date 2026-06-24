# Fleet-refresh live status — design

**Date:** 2026-06-24
**Status:** Approved (brainstorm)
**Follows:** `2026-06-24-refresh-fleet-state-design.md` (the dispatch button this builds on)

## Goal

After the operator clicks **↻ Refresh fleet state**, let the cockpit *follow the
actual GitHub Actions runs* it dispatched — show per-workflow live status
(security ✓ done · lighthouse running…), then land the operator on fresh numbers
automatically when both finish. This removes the standing limitation of the
dispatch button: today it confirms *dispatch*, not *completion*, so the operator
clicks, sees "updates in a few min," and has to guess when to reload.

## Background — the constraint

`workflow_dispatch` returns `204` with **no run id**. So the dashboard cannot
deep-link or directly poll "the run it just started"; it must *re-find* the runs.
The existing `makeGitHubRest` client (the `fetch`-based one — the dashboard runs
on Netlify/Lambda where the `gh` CLI is absent, per the #305 hotfix) today exposes
only `defaultBranch` + `dispatchWorkflow`. Following runs needs one new read
capability.

## Approach — re-find by timestamp (no id-matching, no race)

The dispatch POST captures a server timestamp `since` (the instant *just before*
dispatch) and returns it. A new status endpoint, given `since`, lists each
workflow's runs created on/after `since` (newest first, `event=workflow_dispatch`)
and reports their state. A run that hasn't materialized yet simply reads as
"starting" — there is no dispatch→id race to handle, and no need for unique
dispatch inputs.

Clock skew between Netlify and GitHub is sub-second (both NTP-synced); `since` is
used unbuffered. Two refreshes within the same second is not a real operator
workflow, so "newest run since `since`" is unambiguous in practice.

## Architecture

Four small, independently-testable pieces. Three extend existing files; no new
runtime dependencies, no new Airtable fields, no consumer-facing surface.

### Component 1 — `src/github/gh-rest.ts`: add `listWorkflowRuns`

```
listWorkflowRuns: (
  repo: string,
  workflow: string,                 // filename, e.g. "fleet-security.yml"
  opts: { since: string; event?: string; perPage?: number },
) => Promise<WorkflowRun[]>;

type WorkflowRun = {
  id: number;
  status: string;            // "queued" | "in_progress" | "completed" | ...
  conclusion: string | null; // "success" | "failure" | "cancelled" | "timed_out" | null
  createdAt: string;         // ISO
  htmlUrl: string;
};
```

Calls `GET /repos/{owner}/{repo}/actions/workflows/{workflow}/runs` with query
`created=>=<since>&event=<event>&per_page=<perPage>`, newest-first (GitHub's
default order). `assertUrlSegment` on `workflow` (same guard `dispatchWorkflow`
uses). Throws on non-2xx carrying status + capped body, like the existing methods.
The only new GitHub capability in the codebase.

### Component 2 — `src/dashboard/refresh-fleet.ts`: add pure `summarizeFleetRunStatus`

```
export type WorkflowRunState = "starting" | "queued" | "in_progress" | "success"
  | "failure" | "cancelled" | "timed_out" | "unknown";

export type FleetRunStatus = {
  perWorkflow: { workflow: string; state: WorkflowRunState; url: string | null }[];
  allDone: boolean;     // every workflow reached a terminal state
  anySuccess: boolean;  // ≥1 workflow concluded success
  anyFailure: boolean;  // ≥1 workflow concluded failure/timed_out/cancelled
};

export function summarizeFleetRunStatus(
  runsByWorkflow: { workflow: string; runs: WorkflowRun[] }[],
): FleetRunStatus;
```

Pure mapper: takes the newest run per workflow (empty → `state: "starting"`,
`url: null`), maps GitHub's `status`/`conclusion` pair into a single
`WorkflowRunState`, and rolls up `allDone` / `anySuccess` / `anyFailure`. No I/O.
Sibling of `refreshFleetState`; the two share `FLEET_REFRESH_WORKFLOWS`.

### Component 3 — `netlify/functions/refresh-fleet.mts`: two changes

1. **POST returns `since`.** Capture `since = new Date().toISOString()` immediately
   before the dispatch loop; success/partial responses become
   `{ ok, dispatched, failed, since }`. (All-failed still → `502`; no `since`
   needed when nothing started.)

2. **New `GET /api/fleet/refresh/status?since=<iso>` branch.** Add
   `/api/fleet/refresh/status` to `config.path`; branch on
   `new URL(req.url).pathname.endsWith("/status")` (the existing bare-`GET`
   health-check stays for `/api/fleet/refresh`).
   - Same auth posture as the rest read-path: require `verifyBasicAuth`
     (`DASHBOARD_PASSWORD` missing → 503, bad creds → 401). No CSRF gate — it is a
     non-mutating GET. Token absent → `not-configured` 503.
   - Validate `since` is a parseable ISO date → else `400 {error:"bad-since"}`.
   - `makeGitHubRest({ token })`; for each `FLEET_REFRESH_WORKFLOWS` entry call
     `listWorkflowRuns(CENTRAL_REPO, wf, { since, event: "workflow_dispatch", perPage: 1 })`;
     feed into `summarizeFleetRunStatus`; return `200 { ok:true, status }`.
   - `handlerError("refresh-fleet-status", err)` on any throw.

Reuses the existing `CENTRAL_REPO` constant + `GITHUB_REPOSITORY` override.

### Component 4 — `src/dashboard/fleet-render.ts`: the client poll loop

Replace the one-shot status text with a small **status panel** (two rows:
`security`, `lighthouse`) driven by polling. In the cockpit's inline script:

1. On click → existing `confirm` → `POST /api/fleet/refresh`. On `ok`, read
   `since` from the JSON and call `startPolling(since)`. On failure → existing
   "✗ failed to start" path.
2. `startPolling(since)`:
   - Persist `{ since, startedAt }` to `localStorage` (`reddoor:fleet-refresh`).
   - Every **10 s**, `GET /api/fleet/refresh/status?since=<since>`; render each
     `perWorkflow` row with a CSS spinner for active states, ✓ for success, ✗ for
     failure (failure rows link to `url`).
   - **`allDone && !anyFailure`** → "✓ Done — reloading…", clear `localStorage`,
     `location.reload()` after ~2 s (lands on fresh Airtable numbers).
   - **`allDone && anyFailure`** → stop, keep the ✗ row + run link, show a manual
     **Reload** button, clear `localStorage`.
   - **Hard cap 30 min** (Lighthouse ≈ 18 min) → stop, "Still running — reload
     later," clear `localStorage`.
3. **Resume-on-reload:** on cockpit load, if `localStorage` holds a `since` newer
   than 30 min, resume `startPolling(since)` so a manual mid-run reload keeps the
   spinner instead of dropping it.

Polling cadence (6 req/min) stays well under the function's
`rateLimit { windowLimit: 30 / 60s }`; ~20 min × 2 workflows ≈ 240 GitHub calls,
trivially within the token's 5000/hr.

## Data flow

click → `POST /api/fleet/refresh` (returns `since`) → client stores `since`,
polls `GET …/status?since` every 10 s → endpoint `listWorkflowRuns` ×2 →
`summarizeFleetRunStatus` → panel renders per-workflow state → both terminal →
all-success: auto-reload to fresh state · any-failure: stop + run link.

## Error handling

- **Run not found yet** → `state:"starting"` (not an error); spinner continues.
- **`since` malformed** → `400 bad-since` (defensive; the client always sends the
  server-issued value).
- **Status poll errors** (network / GitHub 5xx) → client tolerates a few
  consecutive failures (keeps last good render, keeps polling); a persistent
  failure surfaces "couldn't read status — reload to check" without killing the
  page.
- **Token absent** → `not-configured` 503 (ships safe).
- Any unexpected throw → `handlerError`, no token leak (thrown messages carry
  status + capped body only).

## Testing

- **Pure core** (`tests/dashboard/refresh-fleet.test.ts`, extend): `summarizeFleetRunStatus`
  for — both starting (no runs) → `allDone:false`; one in_progress + one success →
  not done; both success → `allDone && anySuccess && !anyFailure`; one failure +
  one success → `allDone && anyFailure`; cancelled/timed_out map to failure; newest
  run is the one chosen when a workflow has several.
- **gh-rest** (`tests/github/gh-rest.test.ts` or sibling): `listWorkflowRuns`
  builds the right URL (`created=>=`, `event`, `per_page`), maps the response
  fields, throws on non-2xx. (Mock `fetch`, mirroring existing gh-rest tests.)
- **Render** (`tests/dashboard/fleet-render.test.ts`, extend): cockpit HTML
  contains the status panel scaffold + the `/api/fleet/refresh/status` poll target;
  inline script references `localStorage` resume + the 10 s/30 min constants.
- **`.mts` handler** covered by `tsc -p tsconfig.netlify.json` + `test:dist`
  import-resolution (the new `/status` branch resolves all its `src/` imports).

## Non-goals / YAGNI

- **No per-site Lighthouse granularity** ("site 4 of 12") — per-workflow status
  only. The runs don't expose per-matrix-leg progress without much heavier
  introspection, and per-workflow is enough to answer "is it still going?"
- **No persistence beyond `localStorage`** — refresh state is per-browser and
  ephemeral; the source of truth stays the Actions runs + Airtable. A second
  operator's cockpit won't show the first's in-flight spinner (acceptable; both
  can dispatch and both land on fresh data).
- No new Airtable fields, no schedule changes, no `./forms`/`./configs` surface.
