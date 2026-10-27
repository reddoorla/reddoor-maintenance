# Refresh Fleet State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a cockpit "Refresh fleet state" button that dispatches the `fleet-security` and `fleet-lighthouse` GitHub Actions workflows on demand, so vulns / auto-checks / Lighthouse / GitHub-signals refresh immediately instead of waiting for the nightly cron.

**Architecture:** A fleet-level sibling of the per-site Trigger Renovate action. Pure core (`refresh-fleet.ts`) dispatches both workflows independently and returns a partial result; a thin `.mts` handler (`POST /api/fleet/refresh`) reuses the authed-write gate chain + the `fetch`-based `makeGitHubRest` client (Netlify/Lambda has no `gh` binary); a single button on the cockpit header POSTs to it.

**Tech Stack:** TypeScript ESM (NodeNext, `.js` specifiers), Vitest, Netlify Functions (`.mts`), `makeGitHubRest` (REST via global `fetch`), changesets.

---

### Task 1: Pure core — `refreshFleetState`

**Files:**

- Create: `src/dashboard/refresh-fleet.ts`
- Test: `tests/dashboard/refresh-fleet.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  refreshFleetState,
  FLEET_REFRESH_WORKFLOWS,
  type RefreshFleetDeps,
} from "../../src/dashboard/refresh-fleet.js";

describe("refreshFleetState", () => {
  it("dispatches every fleet workflow and reports them all dispatched", async () => {
    const calls: string[] = [];
    const deps: RefreshFleetDeps = {
      dispatch: async (wf) => {
        calls.push(wf);
      },
    };
    const r = await refreshFleetState(deps);
    expect(calls).toEqual([...FLEET_REFRESH_WORKFLOWS]);
    expect(r.dispatched).toEqual([...FLEET_REFRESH_WORKFLOWS]);
    expect(r.failed).toEqual([]);
  });

  it("isolates a single failure (still dispatches the others, reports partial)", async () => {
    const deps: RefreshFleetDeps = {
      dispatch: async (wf) => {
        if (wf === "fleet-security.yml") throw new Error("403 no actions:write");
      },
    };
    const r = await refreshFleetState(deps);
    expect(r.dispatched).toEqual(["fleet-lighthouse.yml"]);
    expect(r.failed).toEqual([{ workflow: "fleet-security.yml", error: "403 no actions:write" }]);
  });

  it("reports both failed when every dispatch throws (never throws itself)", async () => {
    const deps: RefreshFleetDeps = {
      dispatch: async () => {
        throw new Error("boom");
      },
    };
    const r = await refreshFleetState(deps);
    expect(r.dispatched).toEqual([]);
    expect(r.failed.map((f) => f.workflow)).toEqual([...FLEET_REFRESH_WORKFLOWS]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/dashboard/refresh-fleet.test.ts`
Expected: FAIL — `Cannot find module '../../src/dashboard/refresh-fleet.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * Fleet-level on-demand refresh: dispatch the GitHub Actions workflows that
 * produce all the cockpit/report state, so the operator can refresh now instead
 * of waiting for the nightly cron. Sibling of trigger-renovate.ts but fleet-wide
 * (no slug) and central-repo-targeted.
 *
 * Both workflows already expose `workflow_dispatch`:
 *  - fleet-security.yml   → vulns, auto-fix-attempt counters, security auto-check
 *  - fleet-lighthouse.yml → Lighthouse, domain/browser/links + indexed auto-checks,
 *                           AND the github-signals sweep (runs as a step inside it)
 */
export const FLEET_REFRESH_WORKFLOWS = ["fleet-security.yml", "fleet-lighthouse.yml"] as const;

export type RefreshFleetDeps = {
  /** Dispatch one workflow file (on the central repo's default branch). Throws on failure. */
  dispatch: (workflow: string) => Promise<void>;
};

export type RefreshFleetResult = {
  dispatched: string[];
  failed: { workflow: string; error: string }[];
};

/**
 * Dispatch every fleet-refresh workflow INDEPENDENTLY — one failure must not stop
 * the others. Never throws; returns a partial result the handler maps to a status.
 */
export async function refreshFleetState(deps: RefreshFleetDeps): Promise<RefreshFleetResult> {
  const dispatched: string[] = [];
  const failed: { workflow: string; error: string }[] = [];
  for (const workflow of FLEET_REFRESH_WORKFLOWS) {
    try {
      await deps.dispatch(workflow);
      dispatched.push(workflow);
    } catch (e) {
      failed.push({ workflow, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { dispatched, failed };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/dashboard/refresh-fleet.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/dashboard/refresh-fleet.ts tests/dashboard/refresh-fleet.test.ts
git commit -m "feat(dashboard): refreshFleetState pure core (dispatch both fleet sweeps)"
```

---

### Task 2: Barrel export

**Files:**

- Modify: `src/dashboard/index.ts` (after the trigger-renovate exports, ~line 11)

- [ ] **Step 1: Add the export**

```ts
export { refreshFleetState, FLEET_REFRESH_WORKFLOWS } from "./refresh-fleet.js";
export type { RefreshFleetDeps, RefreshFleetResult } from "./refresh-fleet.js";
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: clean (no output)

- [ ] **Step 3: Commit**

```bash
git add src/dashboard/index.ts
git commit -m "feat(dashboard): export refreshFleetState from the dashboard barrel"
```

---

### Task 3: Endpoint — `netlify/functions/refresh-fleet.mts`

**Files:**

- Create: `netlify/functions/refresh-fleet.mts` (model on `netlify/functions/trigger-renovate.mts`)

- [ ] **Step 1: Write the handler**

```ts
import type { Context, Config } from "@netlify/functions";
import { verifyBasicAuth, refreshFleetState } from "../../src/dashboard/index.js";
import { isCsrfAllowed } from "../../src/dashboard/csrf.js";
import { handlerError } from "../../src/dashboard/handler-helpers.js";
import { makeGitHubRest } from "../../src/github/gh-rest.js";

// Fleet-level refresh: dispatch the nightly state sweeps on demand. No slug — it
// targets the CENTRAL repo (where fleet-security.yml / fleet-lighthouse.yml live),
// not a per-site repo. Path-routed on the function like the other endpoints.
export const config: Config = {
  path: ["/api/fleet/refresh", "/.netlify/functions/refresh-fleet"],
  rateLimit: { windowSize: 60, windowLimit: 30, aggregateBy: ["ip"] },
};

// The repo whose Actions run the fleet sweeps. Defaults to the dashboard's own
// repo; GITHUB_REPOSITORY (Actions' "owner/repo" var) overrides so a fork/rename
// doesn't hardcode-break it.
const CENTRAL_REPO = process.env.GITHUB_REPOSITORY?.trim() || "reddoorla/reddoor-maintenance";

function json(body: unknown, status: number, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}

export default async (req: Request, _ctx: Context): Promise<Response> => {
  if (req.method === "GET") {
    return Response.json(
      {
        status: "ok",
        service: "reddoor-refresh-fleet",
        env: {
          DASHBOARD_PASSWORD: typeof process.env.DASHBOARD_PASSWORD === "string",
          RENOVATE_TOKEN:
            typeof process.env.RENOVATE_TOKEN === "string" ||
            typeof process.env.GH_TOKEN === "string",
        },
      },
      { status: 200 },
    );
  }

  if (req.method !== "POST") return json({ ok: false, error: "method-not-allowed" }, 405);

  if (!isCsrfAllowed(req)) return json({ ok: false, error: "cross-site-rejected" }, 403);

  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.error("[refresh-fleet] DASHBOARD_PASSWORD missing");
    return json({ ok: false, error: "unconfigured" }, 503);
  }
  if (!verifyBasicAuth(req.headers.get("authorization"), password)) {
    return json({ ok: false, error: "unauthorized" }, 401, {
      "www-authenticate": 'Basic realm="Reddoor fleet"',
    });
  }

  const token = process.env.RENOVATE_TOKEN?.trim() || process.env.GH_TOKEN?.trim();
  if (!token) return json({ ok: false, error: "not-configured" }, 503);

  try {
    const gh = makeGitHubRest({ token });
    // Resolve the central repo's default branch once; dispatch each workflow on it.
    const ref = await gh.defaultBranch(CENTRAL_REPO);
    const result = await refreshFleetState({
      dispatch: (workflow) => gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref),
    });
    // Every dispatch failed → 502 (nothing kicked off). Otherwise 200 with the
    // partial breakdown (the UI names any sweep that didn't start).
    if (result.dispatched.length === 0) {
      return json({ ok: false, error: "dispatch-failed", failed: result.failed }, 502);
    }
    return json({ ok: true, dispatched: result.dispatched, failed: result.failed }, 200);
  } catch (err) {
    return handlerError("refresh-fleet", err);
  }
};
```

- [ ] **Step 2: Verify the `.mts` typechecks (Netlify tsconfig)**

Run: `pnpm exec tsc --noEmit -p tsconfig.netlify.json`
Expected: clean (no output)

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/refresh-fleet.mts
git commit -m "feat(dashboard): POST /api/fleet/refresh endpoint (dispatch fleet sweeps)"
```

---

### Task 4: Cockpit button + handler + style + render test

**Files:**

- Modify: `src/dashboard/fleet-render.ts` — `summaryBar` (~line 185), `FILTER_SCRIPT` (~line 364), styles (~line 122)
- Test: `tests/dashboard/fleet-render.test.ts`

- [ ] **Step 1: Write the failing render test**

Add to `tests/dashboard/fleet-render.test.ts` (inside the existing `describe` for `renderCockpitHtml`; if a `renderCockpitHtml` model helper already exists in the file, reuse it rather than rebuilding):

```ts
it("renders a fleet refresh button wired to POST /api/fleet/refresh", () => {
  const html = renderCockpitHtml(makeCockpitModel()); // existing helper in this file
  expect(html).toContain('class="refresh-fleet"');
  expect(html).toContain('data-refresh-url="/api/fleet/refresh"');
  expect(html).toContain("Refresh fleet state");
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `pnpm exec vitest run tests/dashboard/fleet-render.test.ts`
Expected: FAIL — `expected '…' to contain 'class="refresh-fleet"'`

- [ ] **Step 3: Add the button to `summaryBar`**

In `src/dashboard/fleet-render.ts`, change the `summaryBar` return so the filters line is followed by a fleet-actions row:

```ts
return `<div class="summary">
      <span class="tier">🔴 ${s.attention} needs attention</span>
      <span class="tier">🟡 ${s.watch} watch</span>
      <span class="tier">🟢 ${s.healthy} healthy</span>
    </div>
    <div class="summary heads">${escapeHtml(heads)}</div>
    <div class="filters">${chips}</div>
    <div class="fleet-actions">
      <button type="button" class="refresh-fleet" data-refresh-url="/api/fleet/refresh">↻ Refresh fleet state</button>
    </div>`;
```

- [ ] **Step 4: Add the click handler to `FILTER_SCRIPT`**

Insert this block immediately before the closing `})();` of `FILTER_SCRIPT`:

```js
// refresh-fleet button: confirm (heavy fleet-wide run) then dispatch both sweeps.
var rf = document.querySelector("button.refresh-fleet");
if (rf)
  rf.addEventListener("click", async function () {
    if (
      !confirm(
        "Kick off the security + Lighthouse sweeps for the whole fleet? They take a few minutes.",
      )
    )
      return;
    rf.disabled = true;
    rf.textContent = "Refreshing…";
    try {
      var res = await fetch(rf.dataset.refreshUrl, { method: "POST" });
      rf.textContent = res.ok ? "↻ Refresh started — updates in a few min" : "Failed to start";
      if (!res.ok) rf.disabled = false;
    } catch (e) {
      rf.textContent = "Failed to start";
      rf.disabled = false;
    }
  });
```

- [ ] **Step 5: Add a minimal style**

After line 122 (the `.filters button` rules) add:

```ts
.fleet-actions { margin-bottom:1.25rem; }
.refresh-fleet { font:inherit; font-size:0.85rem; padding:0.3rem 0.8rem; border:1px solid #1a1a1a; border-radius:999px; background:#1a1a1a; color:#fff; cursor:pointer; }
.refresh-fleet:disabled { opacity:0.6; cursor:default; }
@media (prefers-color-scheme: dark) { .refresh-fleet { background:#e8e8e8; color:#111; border-color:#e8e8e8; } }
```

- [ ] **Step 6: Run the render test — verify it passes**

Run: `pnpm exec vitest run tests/dashboard/fleet-render.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): Refresh fleet state button on the cockpit header"
```

---

### Task 5: Changeset + full gate

**Files:**

- Create: `.changeset/refresh-fleet-state.md`

- [ ] **Step 1: Write the changeset**

```markdown
---
"@reddoorla/maintenance": minor
---

feat(dashboard): add a "Refresh fleet state" button to the cockpit

A fleet-level action (`POST /api/fleet/refresh`) that dispatches the `fleet-security` and `fleet-lighthouse` GitHub Actions workflows on demand, so vulnerabilities, auto-check signals, Lighthouse scores, and GitHub signals refresh immediately instead of waiting for the nightly cron. Reuses the authed-write gate chain and the `fetch`-based `makeGitHubRest` client. Confirms before firing (the sweeps are heavy fleet-wide runs); needs `RENOVATE_TOKEN` in the dashboard Netlify env (already set).
```

- [ ] **Step 2: Format, then run the full gate**

```bash
pnpm exec prettier --write src/dashboard/refresh-fleet.ts tests/dashboard/refresh-fleet.test.ts netlify/functions/refresh-fleet.mts src/dashboard/fleet-render.ts src/dashboard/index.ts .changeset/refresh-fleet-state.md
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:dist
```

Expected: lint clean; typecheck clean (both configs); all tests pass; build succeeds; `test:dist` green including `Netlify handler 'refresh-fleet.mts' resolves all its src/ imports`.

- [ ] **Step 3: Commit**

```bash
git add .changeset/refresh-fleet-state.md
git commit -m "chore: changeset for refresh fleet state"
```

---

## Self-Review

**1. Spec coverage:**

- Pure core `refresh-fleet.ts` + independent dispatch + partial result → Task 1. ✓
- Barrel export → Task 2. ✓
- Endpoint `POST /api/fleet/refresh` + gate chain + central-repo constant/env + 502-on-all-failed → Task 3. ✓
- Cockpit-only button + confirm + transient status + no run link → Task 4. ✓
- Testing (core + render + `.mts` via typecheck/test:dist) → Tasks 1, 4, 5. ✓
- Changeset (minor) → Task 5. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. The render test reuses the file's existing `makeCockpitModel`/`renderCockpitHtml` helper — confirm its real name when editing (Task 4 Step 1 notes this).

**3. Type consistency:** `RefreshFleetDeps.dispatch(workflow: string)`, `FLEET_REFRESH_WORKFLOWS`, `RefreshFleetResult {dispatched, failed:{workflow,error}[]}` are used identically across Tasks 1/2/3. Endpoint passes `dispatch: (workflow) => gh.dispatchWorkflow(CENTRAL_REPO, workflow, ref)` — matches `makeGitHubRest.dispatchWorkflow(repo, workflow, ref)`. ✓
