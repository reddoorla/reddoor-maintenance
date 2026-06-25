# Refresh Spinner Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the fleet-refresh spinner informative for the ~48-min `fleet-lighthouse` run: each active workflow row shows the current build **phase**, **elapsed** time, an **ETA**, and a **view-run** link.

**Architecture:** `fleet-lighthouse` is one opaque job (no matrix), so per-site progress isn't cheaply available — but the run's *current step* is. A new `currentRunStep(repo, runId)` reads `GET /runs/{id}/jobs` and returns the in-progress step name. The status endpoint enriches each in-progress workflow's summary with that step (best-effort — a jobs hiccup must not sink the poll). The client renders phase + a client-computed elapsed (from the stored `startedAt`) + a per-workflow ETA + a run link while running.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, GitHub REST, Netlify Functions (`.mts`), vanilla inline JS in a server-rendered template string (NO backticks / `${}`).

---

## File Structure

- **Modify** `src/github/gh-rest.ts` — add `currentRunStep` to the `GitHubRest` type + `makeGitHubRest` impl.
- **Modify** `src/dashboard/refresh-fleet.ts` — add `step: string | null` to `FleetRunStatus.perWorkflow` (pure `summarizeFleetRunStatus` sets it `null`).
- **Modify** `netlify/functions/refresh-fleet.mts` — status branch enriches in-progress entries with `currentRunStep` (best-effort).
- **Modify** `src/dashboard/fleet-render.ts` — richer `rfRender` (phase/elapsed/ETA/run-link) + `rfPhase`/`rfEta` helpers + `.rf-sub` CSS.
- **Modify** `tests/github/gh-rest.test.ts`, `tests/dashboard/refresh-fleet.test.ts`, `tests/dashboard/fleet-render.test.ts`.
- **Create** `.changeset/refresh-spinner-detail.md` — patch changeset.

---

## Task 1: `currentRunStep` on the REST client

**Files:** Modify `src/github/gh-rest.ts`; Test `tests/github/gh-rest.test.ts`.

- [ ] **Step 1: Write the failing tests** — append to `tests/github/gh-rest.test.ts`:

```ts
describe("makeGitHubRest.currentRunStep", () => {
  it("returns the in-progress step name of the in-progress job", async () => {
    const { fn, calls } = fakeFetch([
      {
        status: 200,
        body: {
          total_count: 1,
          jobs: [
            {
              id: 7,
              status: "in_progress",
              steps: [
                { name: "Set up job", status: "completed", number: 1 },
                { name: "pnpm build", status: "completed", number: 2 },
                { name: "Fleet Lighthouse + domain + browser audit", status: "in_progress", number: 3 },
              ],
            },
          ],
        },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBe(
      "Fleet Lighthouse + domain + browser audit",
    );
    expect(calls[0]!.url).toBe("https://api.github.com/repos/reddoorla/acme/actions/runs/42/jobs");
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers["authorization"]).toBe("Bearer tok");
  });

  it("returns null when no step is in progress", async () => {
    const { fn } = fakeFetch([
      {
        status: 200,
        body: { jobs: [{ id: 1, status: "completed", steps: [{ name: "x", status: "completed", number: 1 }] }] },
      },
    ]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBeNull();
  });

  it("returns null when there are no jobs", async () => {
    const { fn } = fakeFetch([{ status: 200, body: { jobs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    expect(await gh.currentRunStep("reddoorla/acme", 42)).toBeNull();
  });

  it("throws (with status) when the jobs call is non-2xx", async () => {
    const { fn } = fakeFetch([{ status: 500, body: { message: "boom" } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.currentRunStep("reddoorla/acme", 42)).rejects.toThrow(/500/);
  });

  it("rejects a non-integer runId before any fetch", async () => {
    const { fn, calls } = fakeFetch([{ status: 200, body: { jobs: [] } }]);
    const gh = makeGitHubRest({ token: "tok", fetch: fn });
    await expect(gh.currentRunStep("reddoorla/acme", 1.5 as number)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, verify FAIL:** `pnpm vitest run tests/github/gh-rest.test.ts` → `currentRunStep is not a function`.

- [ ] **Step 3: Add the type + impl.** In `src/github/gh-rest.ts`, add to the `GitHubRest` type (after `listWorkflowRuns`):

```ts
  /** The name of the in-progress step of a run's in-progress job, or null if none
   *  is currently running (between steps / completed). Used to show a coarse "phase"
   *  in the refresh spinner. Non-2xx throws (callers treat it best-effort). */
  currentRunStep: (repo: string, runId: number) => Promise<string | null>;
```

Add the method to the returned object (after `listWorkflowRuns`):

```ts
    async currentRunStep(repo, runId) {
      const { owner, name } = splitRepo(repo);
      assertUrlSegment("path", owner);
      assertUrlSegment("path", name);
      if (!Number.isInteger(runId) || runId < 0) {
        throw new Error(`currentRunStep: expected a non-negative integer runId, got ${runId}`);
      }
      const res = await doFetch(
        `${GITHUB_API}/repos/${owner}/${name}/actions/runs/${runId}/jobs`,
        { headers: baseHeaders },
      );
      if (!res.ok) {
        throw new Error(
          `GitHub GET run ${owner}/${name}/${runId} jobs failed (${res.status}): ${await bodyText(res)}`,
        );
      }
      let body: { jobs?: Array<{ status?: string; steps?: Array<{ name?: string; status?: string }> }> };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new Error(`GitHub run ${owner}/${name}/${runId} jobs: 200 with a non-JSON body`);
      }
      const jobs = body.jobs ?? [];
      // Prefer the in-progress job; fall back to the first job (single-job workflows).
      const job = jobs.find((j) => j.status === "in_progress") ?? jobs[0];
      const step = (job?.steps ?? []).find((s) => s.status === "in_progress");
      return step?.name ?? null;
    },
```

- [ ] **Step 4: Run, verify PASS:** `pnpm vitest run tests/github/gh-rest.test.ts`.

- [ ] **Step 5: Commit:**
```bash
git add src/github/gh-rest.ts tests/github/gh-rest.test.ts
git commit -m "feat(gh-rest): currentRunStep — the in-progress step of a run's job"
```

---

## Task 2: `step` on the run-status summary

**Files:** Modify `src/dashboard/refresh-fleet.ts`; Test `tests/dashboard/refresh-fleet.test.ts`.

- [ ] **Step 1: Update the existing summarize test for the new field.** In `tests/dashboard/refresh-fleet.test.ts`, the "reports 'starting'…" test asserts `perWorkflow` with `toEqual`. Update its expectation to include `step: null` on each entry:

```ts
    expect(s.perWorkflow).toEqual([
      { workflow: "fleet-security.yml", state: "starting", url: null, step: null },
      { workflow: "fleet-lighthouse.yml", state: "starting", url: null, step: null },
    ]);
```

Add one new assertion to the "uses the newest (first) run" test (or a new `it`) confirming the field exists:

```ts
  it("includes a step field (null) on every perWorkflow entry — endpoint fills it for in-progress runs", () => {
    const s = summarizeFleetRunStatus([
      { workflow: "fleet-security.yml", runs: [run({})] },
      { workflow: "fleet-lighthouse.yml", runs: [] },
    ]);
    expect(s.perWorkflow.every((w) => w.step === null)).toBe(true);
  });
```

- [ ] **Step 2: Run, verify the updated `toEqual` test FAILS** (missing `step`): `pnpm vitest run tests/dashboard/refresh-fleet.test.ts`.

- [ ] **Step 3: Add the field.** In `src/dashboard/refresh-fleet.ts`, change the `FleetRunStatus` type:

```ts
export type FleetRunStatus = {
  perWorkflow: { workflow: string; state: WorkflowRunState; url: string | null; step: string | null }[];
  allDone: boolean; // every workflow's newest run has completed
  anySuccess: boolean; // ≥1 completed with conclusion "success"
  anyFailure: boolean; // ≥1 completed with a non-success conclusion
};
```

and the `summarizeFleetRunStatus` map return (pure — endpoint overrides `step` for in-progress runs):

```ts
  const perWorkflow = runsByWorkflow.map(({ workflow, runs }) => {
    const newest = runs[0];
    return { workflow, state: runState(newest), url: newest?.htmlUrl ?? null, step: null };
  });
```

- [ ] **Step 4: Run, verify PASS:** `pnpm vitest run tests/dashboard/refresh-fleet.test.ts` and `pnpm typecheck`.

- [ ] **Step 5: Commit:**
```bash
git add src/dashboard/refresh-fleet.ts tests/dashboard/refresh-fleet.test.ts
git commit -m "feat(dashboard): step field on the fleet run-status summary"
```

---

## Task 3: endpoint enriches in-progress entries with the step

**Files:** Modify `netlify/functions/refresh-fleet.mts`. (No unit test — covered by typecheck + test:dist, like the other handler logic.)

- [ ] **Step 1: Replace the status-branch summarize/return.** In the `GET … STATUS_PATH` branch, replace:

```ts
      return json({ ok: true, status: summarizeFleetRunStatus(runsByWorkflow) }, 200);
```

with:

```ts
      const summary = summarizeFleetRunStatus(runsByWorkflow);
      // Enrich in-progress workflows with the current build step (one extra jobs call
      // each, only while running). Best-effort: a jobs hiccup must NOT sink the poll,
      // so any failure → step stays null.
      const perWorkflow = await Promise.all(
        summary.perWorkflow.map(async (w) => {
          if (w.state !== "in_progress") return w;
          const run = runsByWorkflow.find((r) => r.workflow === w.workflow)?.runs[0];
          if (!run) return w;
          try {
            return { ...w, step: await gh.currentRunStep(CENTRAL_REPO, run.id) };
          } catch {
            return w;
          }
        }),
      );
      return json({ ok: true, status: { ...summary, perWorkflow } }, 200);
```

- [ ] **Step 2: Verify.** Run in order:
  - `pnpm typecheck` (includes the `.mts` via tsconfig.netlify.json)
  - `pnpm build`
  - `pnpm test:dist` (confirms `refresh-fleet.mts` resolves all its src imports)

  All must PASS.

- [ ] **Step 3: Commit:**
```bash
git add netlify/functions/refresh-fleet.mts
git commit -m "feat(dashboard): status poll enriches in-progress workflows with the current step"
```

---

## Task 4: richer spinner client (phase + elapsed + ETA + run link)

**Files:** Modify `src/dashboard/fleet-render.ts`; Test `tests/dashboard/fleet-render.test.ts`.

- [ ] **Step 1: Write the failing render tests.** In `tests/dashboard/fleet-render.test.ts`, add to the existing `describe("renderCockpitHtml — Refresh fleet state button + live status", …)` block:

```ts
  it("the spinner client carries the phase/eta/run-link detail wiring", () => {
    const html = renderCockpitHtml(model([siteRow()]));
    expect(html).toContain("view run"); // run link shown while running
    expect(html).toContain("rf-sub"); // the detail sub-line class
    expect(html).toContain("auditing the fleet"); // phase humanization
    expect(html).toContain("~48m"); // lighthouse ETA
    expect(html).toContain("~2m"); // security ETA
  });
```

- [ ] **Step 2: Run, verify FAIL:** `pnpm vitest run tests/dashboard/fleet-render.test.ts`.

- [ ] **Step 3: Add the `.rf-sub` CSS.** In the STYLES block, right after the `.rf-row a` rule (added in the prior feature), add:

```css
.rf-sub { color:#999; font-size:0.8rem; margin-left:1.1rem; }
```

- [ ] **Step 4: Add the helpers + rewrite `rfRender` to take `startedAt`.** Replace the existing `rfRender` function (the one with the "Safe to build raw HTML" comment, currently `function rfRender(status){ … }`) with:

```js
  // Per-workflow ETA hint (the lighthouse fleet sweep runs ~48 min; security ~1-2 min).
  function rfEta(label){ return label === 'lighthouse' ? '~48m' : label === 'security' ? '~2m' : ''; }
  // Map a raw GitHub step name to a coarse human phase. Order matters (the audit step
  // name also contains 'browser'; 'playwright install' also contains 'install').
  function rfPhase(step){
    if (!step) return '';
    var s = step.toLowerCase();
    if (s.indexOf('audit') !== -1 || s.indexOf('lighthouse') !== -1) return 'auditing the fleet…';
    if (s.indexOf('build') !== -1) return 'building…';
    if (s.indexOf('playwright') !== -1 || s.indexOf('browser') !== -1) return 'installing browsers…';
    if (s.indexOf('install') !== -1 || s.indexOf('depend') !== -1) return 'installing dependencies…';
    if (s.indexOf('set up') !== -1 || s.indexOf('checkout') !== -1) return 'setting up…';
    return step;
  }
  // Safe to build raw HTML: workflow/state/step are server-fixed (enums + GitHub step
  // names) and url is GitHub's own html_url for our central repo — none are
  // user-supplied. Don't interpolate untrusted fields here without escaping.
  function rfRender(status, startedAt){
    var failed = function(s){ return s === 'failure' || s === 'cancelled' || s === 'timed_out'; };
    var mins = Math.floor((Date.now() - startedAt) / 60000);
    var elapsed = mins < 1 ? '<1m' : mins + 'm';
    return status.perWorkflow.map(function(w){
      var label = w.workflow.replace('.yml','').replace('fleet-','');
      var done = w.state === 'success';
      var isFailed = failed(w.state);
      var icon = done ? '✓' : isFailed ? '✗' : '<span class="rf-spin"></span>';
      var line = icon + ' ' + label + ' — ' + w.state.replace('_',' ');
      if (!done && !isFailed){
        var phase = rfPhase(w.step);
        var eta = rfEta(label);
        var detail = [];
        if (phase) detail.push(phase);
        detail.push(elapsed + (eta ? ' / ' + eta : ''));
        var link = w.url ? ' · <a href="'+w.url+'" target="_blank" rel="noopener">view run ↗</a>' : '';
        line += '<div class="rf-sub">' + detail.join(' · ') + link + '</div>';
      } else if (isFailed && w.url){
        line += ' <a href="'+w.url+'" target="_blank" rel="noopener">run</a>';
      }
      return '<div class="rf-row">' + line + '</div>';
    }).join('');
  }
```

- [ ] **Step 5: Pass `startedAt` into `rfRender`.** In `rfPoll`, change the one render call:

```js
        if (p) p.innerHTML = rfRender(data.status, startedAt);
```

(`rfPoll(since, startedAt)` already has `startedAt` in scope.)

- [ ] **Step 6: Run, verify PASS:** `pnpm vitest run tests/dashboard/fleet-render.test.ts` and `pnpm typecheck`.

- [ ] **Step 7: Commit:**
```bash
git add src/dashboard/fleet-render.ts tests/dashboard/fleet-render.test.ts
git commit -m "feat(dashboard): spinner shows phase + elapsed + ETA + run link"
```

---

## Task 5: changeset + full gate

**Files:** Create `.changeset/refresh-spinner-detail.md`.

- [ ] **Step 1: Write the changeset:**

```md
---
"@reddoorla/maintenance": patch
---

Dashboard: the fleet-refresh spinner now shows live detail for the long
Lighthouse sweep — the current build phase (setting up → building → installing
browsers → auditing the fleet…), elapsed time, a per-workflow ETA, and a
view-run link while running. Adds `currentRunStep` to the GitHub REST client.
```

- [ ] **Step 2: Run the FULL gate (lint formats our files too):**

```
pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:dist
```

If `pnpm lint` flags any of OUR changed files (it formats markdown + TS), run the project's prettier-write on them and re-run. Pre-existing untracked files unrelated to this work (e.g. `docs/morning-reports/*`) are not our concern. All five steps must end green.

- [ ] **Step 3: Commit:**
```bash
git add .changeset/refresh-spinner-detail.md
git commit -m "chore(changeset): refresh spinner detail"
```

---

## Self-Review

**Spec coverage:** phase (Tasks 1+3+4) · elapsed (Task 4, client-computed from stored `startedAt`) · ETA (Task 4 `rfEta`) · run-link-while-running (Task 4) · best-effort step enrichment that can't sink the poll (Task 3 try/catch) — all covered. No matrix/per-site work (correctly out of scope).

**Placeholder scan:** none — every step carries full code.

**Type consistency:** `currentRunStep(repo, runId): Promise<string|null>` (Task 1) called in Task 3; `FleetRunStatus.perWorkflow[].step: string|null` (Task 2) set null by `summarizeFleetRunStatus`, overridden by the endpoint (Task 3), read by `rfRender` as `w.step` (Task 4). `rfRender(status, startedAt)` signature (Task 4) matches its one call site in `rfPoll`. Consistent.
