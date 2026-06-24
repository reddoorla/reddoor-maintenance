# Fleet-refresh Live Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the operator clicks "↻ Refresh fleet state," let the cockpit follow the dispatched `fleet-security` + `fleet-lighthouse` runs live (per-workflow spinner → ✓/✗) and auto-reload onto fresh numbers when both succeed.

**Architecture:** The dispatch POST returns a `since` timestamp; a new authed `GET /api/fleet/refresh/status?since=<iso>` re-finds each workflow's newest `workflow_dispatch` run (created on/after `since`) via a new `listWorkflowRuns` REST method, and a pure `summarizeFleetRunStatus` rolls the two runs into one verdict. The cockpit's inline script polls that endpoint every 10 s, renders a two-row status panel, and reloads on all-success / stops on any-failure / caps at 30 min. State is stashed in `localStorage` so a manual mid-run reload resumes the spinner.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, GitHub REST API (`fetch`-based `makeGitHubRest`), Netlify Functions (`.mts`), vanilla inline JS in a server-rendered template string.

---

## File Structure

- **Modify** `src/github/gh-rest.ts` — add `listWorkflowRuns` to the `GitHubRest` type + `makeGitHubRest` impl, and export a `WorkflowRun` type. The only new GitHub capability.
- **Modify** `src/dashboard/refresh-fleet.ts` — add the pure `summarizeFleetRunStatus` + its result/state types, alongside the existing `refreshFleetState`.
- **Modify** `src/dashboard/index.ts` — re-export `summarizeFleetRunStatus` + types so the `.mts` handler imports them from the dashboard barrel (matching `refreshFleetState`).
- **Modify** `netlify/functions/refresh-fleet.mts` — POST returns `since`; add the `GET …/status` branch + the `/status` path in `config`.
- **Modify** `src/dashboard/fleet-render.ts` — status-panel markup, spinner CSS, and the inline poll/resume client script.
- **Modify** `tests/github/gh-rest.test.ts` — `listWorkflowRuns` wire + mapping tests.
- **Modify** `tests/dashboard/refresh-fleet.test.ts` — `summarizeFleetRunStatus` unit tests.
- **Modify** `tests/dashboard/fleet-render.test.ts` — panel/poll/resume render assertions.
- **Create** `.changeset/fleet-refresh-live-status.md` — minor changeset.

---

## Task 1: `listWorkflowRuns` on the REST client

**Files:**
- Modify: `src/github/gh-rest.ts`
- Test: `tests/github/gh-rest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/github/gh-rest.test.ts`:

```ts
describe("makeGitHubRest.listWorkflowRuns", () => {
  const SINCE = "2026-06-24T21:28:00.000Z";

  it("GETs the workflow's runs with created/event/per_page filters and maps the fields", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          total_count: 1,
          workflow_runs: [
            {
              id: 42,
              status: "in_progress",
              conclusion: null,
              created_at: "2026-06-24T21:28:09Z",
              html_url: "https://github.com/reddoorla/acme/actions/runs/42",
            },
          ],
        },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    const runs = await gh.listWorkflowRuns("reddoorla/acme", "fleet-security.yml", {
      since: SINCE,
      event: "workflow_dispatch",
      perPage: 1,
    });
    expect(runs).toEqual([
      {
        id: 42,
        status: "in_progress",
        conclusion: null,
        createdAt: "2026-06-24T21:28:09Z",
        htmlUrl: "https://github.com/reddoorla/acme/actions/runs/42",
      },
    ]);
    expect(calls[0]!.url).toContain(
      "https://api.github.com/repos/reddoorla/acme/actions/workflows/fleet-security.yml/runs?",
    );
    const decoded = decodeURIComponent(calls[0]!.url);
    expect(decoded).toContain("created=>=" + SINCE);
    expect(decoded).toContain("event=workflow_dispatch");
    expect(decoded).toContain("per_page=1");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("returns [] when the response has no workflow_runs array", async () => {
    const { fn } = fakeFetch([{ status: 200, body: { total_count: 0 } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.listWorkflowRuns("reddoorla/acme", "fleet-security.yml", { since: SINCE })).toEqual(
      [],
    );
  });

  it("throws (with status) when the list call is non-2xx", async () => {
    const { fn } = fakeFetch([{ status: 404, body: { message: "Not Found" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.listWorkflowRuns("reddoorla/ghost", "fleet-security.yml", { since: SINCE }),
    ).rejects.toThrow(/404/);
  });

  it("rejects a traversal workflow name before any fetch", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { workflow_runs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(
      gh.listWorkflowRuns("reddoorla/acme", "../../etc", { since: SINCE }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/github/gh-rest.test.ts`
Expected: FAIL — `gh.listWorkflowRuns is not a function`.

- [ ] **Step 3: Add the type + implementation**

In `src/github/gh-rest.ts`, add the exported run type above `export type GitHubRest` (after the file's top doc comment):

```ts
/** A subset of a GitHub Actions workflow run, mapped to camelCase. */
export type WorkflowRun = {
  id: number;
  status: string; // "queued" | "in_progress" | "completed" | "requested" | "waiting" | ...
  conclusion: string | null; // "success" | "failure" | "cancelled" | "timed_out" | ... | null
  createdAt: string; // ISO
  htmlUrl: string;
};
```

Add to the `GitHubRest` type (after `dispatchWorkflow`):

```ts
  /** List a workflow's runs, newest first, created on/after `opts.since` (ISO).
   *  Used to re-find the run a prior `workflow_dispatch` started (dispatch returns
   *  204 with no id). Non-2xx surfaces as a thrown error carrying the status. */
  listWorkflowRuns: (
    repo: string,
    workflow: string,
    opts: { since: string; event?: string; perPage?: number },
  ) => Promise<WorkflowRun[]>;
```

Add the method to the returned object in `makeGitHubRest` (after `dispatchWorkflow`):

```ts
    async listWorkflowRuns(repo, workflow, opts) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      assertUrlSegment("path", workflow);
      const qs = new URLSearchParams({
        created: `>=${opts.since}`,
        per_page: String(opts.perPage ?? 1),
      });
      if (opts.event) qs.set("event", opts.event);
      const res = await doFetch(
        `${GITHUB_API}/repos/${owner}/${name}/actions/workflows/${workflow}/runs?${qs.toString()}`,
        { headers: baseHeaders },
      );
      if (!res.ok) {
        throw new Error(
          `GitHub GET runs ${owner}/${name}/${workflow} failed (${res.status}): ${await bodyText(res)}`,
        );
      }
      let body: { workflow_runs?: Array<Record<string, unknown>> };
      try {
        body = (await res.json()) as { workflow_runs?: Array<Record<string, unknown>> };
      } catch {
        throw new Error(`GitHub runs ${owner}/${name}/${workflow}: 200 with a non-JSON body`);
      }
      return (body.workflow_runs ?? []).map((r) => ({
        id: Number(r.id),
        status: String(r.status ?? ""),
        conclusion: (r.conclusion as string | null) ?? null,
        createdAt: String(r.created_at ?? ""),
        htmlUrl: String(r.html_url ?? ""),
      }));
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm vitest run tests/github/gh-rest.test.ts`
Expected: PASS (all `listWorkflowRuns` + existing cases).

- [ ] **Step 5: Commit**

```bash
git add src/github/gh-rest.ts tests/github/gh-rest.test.ts
git commit -m "feat(gh-rest): listWorkflowRuns — re-find dispatched runs by timestamp"
```

---

## Task 2: pure `summarizeFleetRunStatus`

**Files:**
- Modify: `src/dashboard/refresh-fleet.ts`
- Modify: `src/dashboard/index.ts`
- Test: `tests/dashboard/refresh-fleet.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/dashboard/refresh-fleet.test.ts` (add `summarizeFleetRunStatus` + `type WorkflowRun` to the imports first):

```ts
import { summarizeFleetRunStatus } from "../../src/dashboard/refresh-fleet.js";
import type { WorkflowRun } from "../../src/github/gh-rest.js";

function run(over: Partial<WorkflowRun>): WorkflowRun {
  return {
    id: 1,
    status: "completed",
    conclusion: "success",
    createdAt: "2026-06-24T21:28:09Z",
    htmlUrl: "https://github.com/reddoorla/x/actions/runs/1",
    ...over,
  };
}

describe("summarizeFleetRunStatus", () => {
  it("reports 'starting' (not done) for a workflow with no runs yet", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [] },
      { workflow: "fleet-lighthouse.yml", runs: [] },
    ]);
    expect(s.perWorkflow).toEqual([
      { workflow: "fleet-security.yml", state: "starting", url: null },
      { workflow: "fleet-lighthouse.yml", state: "starting", url: null },
    ]);
    expect(s.allDone).toBe(false);
  });

  it("is not done while one run is still in_progress", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({ conclusion: "success" })] },
      { workflow: "fleet-lighthouse.yml", runs: [run({ status: "in_progress", conclusion: null })] },
    ]);
    expect(s.allDone).toBe(false);
    expect(s.perWorkflow[1]!.state).toBe("in_progress");
  });

  it("is done + all-success when both completed successfully", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({})] },
      { workflow: "fleet-lighthouse.yml", runs: [run({})] },
    ]);
    expect(s.allDone).toBe(true);
    expect(s.anySuccess).toBe(true);
    expect(s.anyFailure).toBe(false);
  });

  it("flags anyFailure for failure / cancelled / timed_out conclusions", () => {
    for (const c of ["failure", "cancelled", "timed_out"]) {
      const s = summarizeFleetRunStatus([
        { workflow: "fleet-security.yml", runs: [run({ conclusion: c })] },
        { workflow: "fleet-lighthouse.yml", runs: [run({ conclusion: "success" })] },
      ]);
      expect(s.allDone).toBe(true);
      expect(s.anyFailure).toBe(true);
      expect(s.perWorkflow[0]!.state).toBe(c);
    }
  });

  it("treats a completed run with an odd conclusion as a (terminal) failure", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({ conclusion: "action_required" })] },
      { workflow: "fleet-lighthouse.yml", runs: [run({ conclusion: "success" })] },
    ]);
    expect(s.allDone).toBe(true);
    expect(s.anyFailure).toBe(true);
    expect(s.perWorkflow[0]!.state).toBe("failure");
  });

  it("uses the newest (first) run and carries its url", () => {
    const s = summarizeFleetRunStatus([
      {
        workflow: "fleet-security.yml",
        runs: [run({ id: 99, htmlUrl: "u99" }), run({ id: 1, htmlUrl: "u1" })],
      },
      { workflow: "fleet-lighthouse.yml", runs: [run({})] },
    ]);
    expect(s.perWorkflow[0]!.url).toBe("u99");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/dashboard/refresh-fleet.test.ts`
Expected: FAIL — `summarizeFleetRunStatus` is not exported.

- [ ] **Step 3: Implement the pure core**

Append to `src/dashboard/refresh-fleet.ts`:

```ts
import type { WorkflowRun } from "../github/gh-rest.js";

/** A single workflow's run state, normalized for the cockpit panel. */
export type WorkflowRunState =
  | "starting" // dispatched but no run has appeared yet
  | "queued"
  | "in_progress"
  | "success"
  | "failure"
  | "cancelled"
  | "timed_out";

export type FleetRunStatus = {
  perWorkflow: { workflow: string; state: WorkflowRunState; url: string | null }[];
  allDone: boolean; // every workflow's newest run has completed
  anySuccess: boolean; // ≥1 completed with conclusion "success"
  anyFailure: boolean; // ≥1 completed with a non-success conclusion
};

const TERMINAL: WorkflowRunState[] = ["success", "failure", "cancelled", "timed_out"];

/** Map a single (newest) run — or its absence — into one normalized state. */
function runState(run: WorkflowRun | undefined): WorkflowRunState {
  if (!run) return "starting";
  if (run.status !== "completed") {
    return run.status === "in_progress" ? "in_progress" : "queued";
  }
  switch (run.conclusion) {
    case "success":
      return "success";
    case "cancelled":
      return "cancelled";
    case "timed_out":
      return "timed_out";
    default:
      // failure + any other terminal conclusion (action_required, neutral, …) — all
      // terminal, all surfaced as a failure so the operator checks the run.
      return "failure";
  }
}

/**
 * Roll the two fleet workflows' newest runs into one verdict the status endpoint
 * returns and the cockpit panel renders. Pure: no I/O. `runs` per workflow is the
 * newest-first list from `listWorkflowRuns`; only `[0]` is considered.
 */
export function summarizeFleetRunStatus(
  runsByWorkflow: { workflow: string; runs: WorkflowRun[] }[],
): FleetRunStatus {
  const perWorkflow = runsByWorkflow.map(({ workflow, runs }) => {
    const newest = runs[0];
    return { workflow, state: runState(newest), url: newest?.htmlUrl ?? null };
  });
  return {
    perWorkflow,
    allDone: perWorkflow.every((w) => TERMINAL.includes(w.state)),
    anySuccess: perWorkflow.some((w) => w.state === "success"),
    anyFailure: perWorkflow.some(
      (w) => w.state === "failure" || w.state === "cancelled" || w.state === "timed_out",
    ),
  };
}
```

- [ ] **Step 4: Export from the dashboard barrel**

In `src/dashboard/index.ts`, replace the refresh-fleet export pair:

```ts
export { refreshFleetState, FLEET_REFRESH_WORKFLOWS } from "./refresh-fleet.js";
export type { RefreshFleetDeps, RefreshFleetResult } from "./refresh-fleet.js";
```

with:

```ts
export {
  refreshFleetState,
  summarizeFleetRunStatus,
  FLEET_REFRESH_WORKFLOWS,
} from "./refresh-fleet.js";
export type {
  RefreshFleetDeps,
  RefreshFleetResult,
  FleetRunStatus,
  WorkflowRunState,
} from "./refresh-fleet.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm vitest run tests/dashboard/refresh-fleet.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/dashboard/refresh-fleet.ts src/dashboard/index.ts tests/dashboard/refresh-fleet.test.ts
git commit -m "feat(dashboard): summarizeFleetRunStatus — roll the two sweeps into one verdict"
```

---

## Task 3: endpoint — return `since` on POST, add `GET …/status`

**Files:**
- Modify: `netlify/functions/refresh-fleet.mts`

(No unit test — `.mts` handlers are covered by `tsc -p tsconfig.netlify.json` + `pnpm test:dist` import-resolution, like the other handlers. Pure logic lives in Tasks 1–2, which are unit-tested.)

- [ ] **Step 1: Add the status import**

Change the dashboard import line:

```ts
import { verifyBasicAuth, refreshFleetState } from "../../src/dashboard/index.js";
```

to:

```ts
import {
  verifyBasicAuth,
  refreshFleetState,
  summarizeFleetRunStatus,
  FLEET_REFRESH_WORKFLOWS,
} from "../../src/dashboard/index.js";
```

- [ ] **Step 2: Add the `/status` path to the config**

Change:

```ts
  path: ["/api/fleet/refresh", "/.netlify/functions/refresh-fleet"],
```

to:

```ts
  path: [
    "/api/fleet/refresh",
    "/api/fleet/refresh/status",
    "/.netlify/functions/refresh-fleet",
  ],
```

- [ ] **Step 3: Add a shared auth helper and the status branch**

Add this helper above `export default` (it factors the password/basic-auth/token gate shared by POST and the status GET):

```ts
/** Shared auth gate: returns a token on success, or a Response to return on failure. */
function gateAuth(req: Request): { token: string } | { fail: Response } {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[refresh-fleet] DASHBOARD_PASSWORD missing");
    return { fail: json({ ok: false, error: "unconfigured" }, 503) };
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return {
      fail: json({ ok: false, error: "unauthorized" }, 401, {
        "www-authenticate": 'Basic realm="Reddoor fleet"',
      }),
    };
  }
  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return { fail: json({ ok: false, error: "not-configured" }, 503) };
  return { token };
}
```

Then, inside `export default`, immediately after the bare-`GET` health check block, add the status branch (a non-mutating read — auth, no CSRF):

```ts
  // Live status poll: re-find the dispatched runs by timestamp and summarize them.
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname.endsWith("/status")) {
    const since = url.searchParams.get("since") ?? "";
    if (!since || Number.isNaN(new Date(since).getTime())) {
      return json({ ok: false, error: "bad-since" }, 400);
    }
    const gated = gateAuth(req);
    if ("fail" in gated) return gated.fail;
    try {
      const gh = makeGitHubRest({ token: gated.token });
      const runsByWorkflow = await Promise.all(
        FLEET_REFRESH_WORKFLOWS.map(async (workflow) => ({
          workflow,
          runs: await gh.listWorkflowRuns(CENTRAL_REPO, workflow, {
            since,
            event: "workflow_dispatch",
            perPage: 1,
          }),
        })),
      );
      return json({ ok: true, status: summarizeFleetRunStatus(runsByWorkflow) }, 200);
    } catch (err) {
      return handlerError("refresh-fleet-status", err);
    }
  }
```

> Note: the existing bare-`GET` health check must only answer `/api/fleet/refresh` — guard it so it doesn't swallow `/status`. Change its condition from `if (req.method === "GET")` to `if (req.method === "GET" && !new URL(req.url).pathname.endsWith("/status"))`. (Compute the `URL` once if you prefer; correctness over micro-optimization.)

- [ ] **Step 4: Make POST return `since` and reuse the gate**

Replace the POST body (the CSRF check stays first; then swap the inline password/auth/token lines for `gateAuth`, and add `since`):

```ts
  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  // CSRF defense before auth — state-changing endpoint.
  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const gated = gateAuth(req);
  if ("fail" in gated) return gated.fail;

  try {
    const gh = makeGitHubRest({ token: gated.token });
    const ref = await gh.defaultBranch(CENTRAL_REPO);
    // Capture the instant just before dispatch; the client polls /status?since=<this>.
    const since = new Date().toISOString();
    const result = await refreshFleetState({
      dispatch: (workflow) => gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref),
    });
    if (result.dispatched.length === 0) {
      return json({ ok: false, error: "dispatch-failed", failed: result.failed }, 502);
    }
    return json(
      { ok: true, dispatched: result.dispatched, failed: result.failed, since },
      200,
    );
  } catch (err) {
    return handlerError("refresh-fleet", err);
  }
```

- [ ] **Step 5: Typecheck the handler + verify import resolution**

Run: `pnpm typecheck`
Expected: PASS (includes `tsconfig.netlify.json`, so the `.mts` is type-checked).

Run: `pnpm build && pnpm test:dist`
Expected: PASS — the dist smoke test confirms `refresh-fleet.mts` resolves all its `src/` imports (now incl. `summarizeFleetRunStatus`, `FLEET_REFRESH_WORKFLOWS`, `listWorkflowRuns`).

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/refresh-fleet.mts
git commit -m "feat(dashboard): POST returns since + GET /api/fleet/refresh/status poll"
```

---

## Task 4: cockpit — status panel, spinner CSS, poll/resume client

**Files:**
- Modify: `src/dashboard/fleet-render.ts`
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing render tests**

Replace the existing `describe("renderCockpitHtml — Refresh fleet state button", …)` block (at the end of `tests/dashboard/fleet-render.test.ts`) with:

```ts
describe("renderCockpitHtml — Refresh fleet state button + live status", () => {
  it("renders a fleet refresh button wired to POST /api/fleet/refresh", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('class="refresh-fleet"');
    expect(html).toContain('data-refresh-url="/api/fleet/refresh"');
    expect(html).toContain("Refresh fleet state");
  });

  it("includes the live-status panel scaffold and the poll endpoint", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain('id="rf-status"');
    expect(html).toContain("/api/fleet/refresh/status?since=");
  });

  it("wires localStorage resume so a mid-run reload keeps following", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("reddoor:fleet-refresh");
    expect(html).toMatch(/localStorage/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`
Expected: FAIL — `id="rf-status"` / `/api/fleet/refresh/status` / `reddoor:fleet-refresh` not present.

- [ ] **Step 3: Add the status-panel markup**

In `src/dashboard/fleet-render.ts`, change the `.fleet-actions` block (currently the button alone, ~line 190):

```ts
    <div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Refresh fleet state</button>
    </div>`;
```

to:

```ts
    <div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Refresh fleet state</button>
      <div id="rf-status" class="rf-status" aria-live="polite"></div>
    </div>`;
```

- [ ] **Step 4: Add the spinner CSS**

In the `STYLES` block, after the `.refresh-fleet` rules (~line 126, after the dark-mode `.refresh-fleet` line), add:

```css
.rf-status { margin-top:0.6rem; font-size:0.85rem; }
.rf-row { padding:0.1rem 0; }
.rf-row a { margin-left:0.3rem; }
.rf-spin { display:inline-block; width:0.8em; height:0.8em; border:2px solid #999; border-top-color:transparent; border-radius:50%; animation:rf-spin 0.8s linear infinite; vertical-align:-0.1em; }
@keyframes rf-spin { to { transform:rotate(360deg); } }
```

- [ ] **Step 5: Replace the refresh-fleet click handler with the poll/resume client**

Replace the existing refresh-fleet handler block (the `var rf = document.querySelector('button.refresh-fleet'); …` through its closing `});`, ~lines 372–382) with:

```js
  // fleet-refresh live status: dispatch, then poll the actual runs and follow them.
  // Vanilla JS, string-concat only (no template literals) — this lives inside a TS
  // template string, so backticks/${} would break the server render.
  var RF_KEY = 'reddoor:fleet-refresh';
  var RF_POLL_MS = 10000;
  var RF_MAX_MS = 30 * 60 * 1000;
  function rfPanel(){ return document.getElementById('rf-status'); }
  function rfStop(){ try { localStorage.removeItem(RF_KEY); } catch(e){} }
  function rfRender(status){
    var p = rfPanel(); if (!p) return '';
    var failed = function(s){ return s === 'failure' || s === 'cancelled' || s === 'timed_out'; };
    return status.perWorkflow.map(function(w){
      var label = w.workflow.replace('.yml','').replace('fleet-','');
      var icon = w.state === 'success' ? '✓' : failed(w.state) ? '✗' : '<span class="rf-spin"></span>';
      var link = (failed(w.state) && w.url) ? ' <a href="'+w.url+'" target="_blank" rel="noopener">run</a>' : '';
      return '<div class="rf-row">'+icon+' '+label+' — '+w.state.replace('_',' ')+link+'</div>';
    }).join('');
  }
  function rfPoll(since, startedAt){
    fetch('/api/fleet/refresh/status?since=' + encodeURIComponent(since)).then(function(res){
      return res.ok ? res.json() : null;
    }).then(function(data){
      var p = rfPanel();
      if (data && data.status){
        if (p) p.innerHTML = rfRender(data.status);
        if (data.status.allDone){
          if (!data.status.anyFailure){
            if (p) p.innerHTML += '<div class="rf-row">✓ Done — reloading…</div>';
            rfStop(); setTimeout(function(){ location.reload(); }, 2000); return;
          }
          if (p) p.innerHTML += '<div class="rf-row"><button type="button" onclick="location.reload()">Reload</button></div>';
          rfStop(); return;
        }
      }
      if (Date.now() - startedAt > RF_MAX_MS){
        if (p) p.innerHTML += '<div class="rf-row">Still running — reload later.</div>';
        rfStop(); return;
      }
      setTimeout(function(){ rfPoll(since, startedAt); }, RF_POLL_MS);
    }).catch(function(){
      if (Date.now() - startedAt > RF_MAX_MS){ rfStop(); return; }
      setTimeout(function(){ rfPoll(since, startedAt); }, RF_POLL_MS);
    });
  }
  function rfBegin(since, startedAt){
    try { localStorage.setItem(RF_KEY, JSON.stringify({ since: since, startedAt: startedAt })); } catch(e){}
    var p = rfPanel(); if (p) p.innerHTML = '<div class="rf-row"><span class="rf-spin"></span> starting…</div>';
    rfPoll(since, startedAt);
  }
  var rf = document.querySelector('button.refresh-fleet');
  if (rf) rf.addEventListener('click', async function(){
    if (!confirm('Kick off the security + Lighthouse sweeps for the whole fleet? They take a few minutes.')) return;
    rf.disabled = true; rf.textContent = 'Refreshing…';
    try {
      var res = await fetch(rf.dataset.refreshUrl, { method: 'POST' });
      if (res.ok){
        var data = await res.json();
        rf.textContent = '↻ Refresh running…';
        if (data && data.since) rfBegin(data.since, Date.now());
      } else { rf.textContent = 'Failed to start'; rf.disabled = false; }
    } catch(e){ rf.textContent = 'Failed to start'; rf.disabled = false; }
  });
  // Resume-on-reload: if a refresh is in flight (<30 min old), keep following it.
  try {
    var rfSaved = JSON.parse(localStorage.getItem(RF_KEY) || 'null');
    if (rfSaved && rfSaved.since && rfSaved.startedAt && (Date.now() - rfSaved.startedAt) < RF_MAX_MS){
      if (rf){ rf.disabled = true; rf.textContent = '↻ Refresh running…'; }
      rfBegin(rfSaved.since, rfSaved.startedAt);
    } else if (rfSaved) { rfStop(); }
  } catch(e){}
```

- [ ] **Step 6: Run the render tests to verify they pass**

Run: `pnpm vitest run tests/dashboard/fleet-render.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): cockpit follows the refresh runs live (poll + spinner + resume)"
```

---

## Task 5: changeset + full gate

**Files:**
- Create: `.changeset/fleet-refresh-live-status.md`

- [ ] **Step 1: Write the changeset**

Create `.changeset/fleet-refresh-live-status.md`:

```md
---
"@reddoorla/maintenance": minor
---

Dashboard: the "Refresh fleet state" button now follows its runs live. After
dispatch the cockpit polls the actual fleet-security + fleet-lighthouse runs
(per-workflow spinner → ✓/✗), auto-reloads onto fresh numbers when both succeed,
links the run on failure, and resumes the spinner across a manual reload.
Adds `GET /api/fleet/refresh/status`, a `listWorkflowRuns` REST method, and the
pure `summarizeFleetRunStatus`.
```

- [ ] **Step 2: Run the full pre-merge gate**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist`
Expected: all PASS. (This is the full gate from the merge-authority + `test:dist` memory — `build` passing alone doesn't catch a renamed/removed public export.)

- [ ] **Step 3: Commit**

```bash
git add .changeset/fleet-refresh-live-status.md
git commit -m "chore(changeset): fleet-refresh live status"
```

---

## Self-Review

**Spec coverage:**
- Re-find by timestamp → Task 3 (POST returns `since`, status branch lists `created>=since`). ✓
- `listWorkflowRuns` → Task 1. ✓
- `summarizeFleetRunStatus` (`allDone`/`anySuccess`/`anyFailure`) → Task 2. ✓
- POST returns `since` + `GET …/status` authed, no-CSRF, `bad-since` 400 → Task 3. ✓
- Client poll 10 s, two-row panel, auto-reload on all-success, stop+run-link on failure, 30-min cap, localStorage resume → Task 4. ✓
- Spinner CSS → Task 4 Step 4. ✓
- Tests: pure core + gh-rest wire + render → Tasks 1/2/4; `.mts` via typecheck+test:dist → Task 3. ✓
- Error handling (run-not-found→starting, bad-since→400, transient poll errors tolerated, token absent→503) → Tasks 2/3/4. ✓
- YAGNI: no per-site granularity, no server-side persistence — honored. ✓

**Placeholder scan:** none — every step carries full code/commands.

**Type consistency:** `WorkflowRun` (Task 1) is consumed by `summarizeFleetRunStatus` (Task 2) and the tests; `FleetRunStatus`/`WorkflowRunState` exported in Task 2 and re-exported in `index.ts`; `summarizeFleetRunStatus` + `FLEET_REFRESH_WORKFLOWS` imported in the `.mts` (Task 3) from the barrel; client reads `status.perWorkflow[].{workflow,state,url}` + `allDone`/`anyFailure` exactly as Task 2 produces. Consistent.
