# Prospect Audit from the Cockpit — Design

**Date:** 2026-08-25 · **Status:** built, awaiting review · **Repo:** reddoor-maintenance

## What and why

Tucker, Tim or Erik types a prospect's URL into the maintenance cockpit, presses a
button, and a few minutes later the three of them get an emailed audit sheet with
a link to the full report. Requested by Tucker 2026-08-25 while the Anthropic and
Perplexity keys were still outstanding.

This does NOT contradict the v1 non-goal "self-serve public lead-magnet page".
That non-goal is about strangers self-serving; this page sits behind the
cockpit's existing operator Basic auth. It widens the trigger from "a terminal"
to "any of the three of us, from a phone", which is the same audience the CLI
already serves.

## The constraint that shapes everything

**The audit cannot execute in a Netlify function.** It drives Playwright for the
rendered-DOM capture and shells out to `lhci` for three Lighthouse passes; a
serverless function has no browser binary and times out in seconds, while a real
audit takes minutes. So the cockpit **triggers** the run; it does not perform it.

The repo already has both halves of that pattern:

- `netlify/functions/trigger-renovate.mts` — a dashboard endpoint behind Basic
  auth + CSRF that dispatches a GitHub Actions `workflow_dispatch`.
- `.github/workflows/fleet-lighthouse.yml` — a workflow that installs Chromium,
  runs `dist/cli/bin.js` with the Turso secrets, and is already the fleet's
  Lighthouse host.

So: **cockpit page → POST endpoint → workflow_dispatch → runner runs the existing
CLI → Turso row → email**. No new execution environment, no new auth model.

## Pieces

### 1. `GET /audits` — the page (`prospect-audits-page.mts`)

Behind the same Basic auth as every other cockpit page. Renders:

- a form: URL (required), business name (optional), and a Run button;
- the recent audits list read from `prospect_audits` — when it ran, the URL, the
  business, complete-vs-partial, and the `/r/{token}` link.

Reuses the cockpit's existing stylesheet and CSRF token conventions. No polling
and no live progress: a run takes minutes, the answer arrives by email, and the
list is the durable record. Refreshing the page is the "did it finish" check.

### 2. `POST /api/prospect-audit/run` — the trigger (`prospect-audit-run.mts`)

Mirrors `trigger-renovate.mts` exactly: CSRF check before auth, Basic auth,
then validate. Validation is the important part, because this endpoint turns a
typed string into a job that spends money:

- must be an http(s) URL (`isHttpUrl`);
- must not resolve to a private/loopback/link-local literal
  (`isPrivateOrLoopbackHost`, added during the prospect-audit review);
- rate-limited at the function config level, as its siblings are.

On success it dispatches the workflow with `url`, `business` and `requested_by`
inputs and returns `202` with a message naming who will get the email. It never
waits for the run.

### 3. `.github/workflows/prospect-audit.yml` — the worker

`workflow_dispatch` with the three inputs. Installs chromium only (the audit
needs one engine, unlike the fleet browser sweep), runs:

```
node dist/cli/bin.js prospect-audit "$URL" --business "$BUSINESS" --email
```

with `TURSO_*`, `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `RESEND_API_KEY` and
`PROSPECT_AUDIT_RECIPIENTS` from secrets. `concurrency` is keyed on the URL so a
double-press cannot run the same audit twice at once, and a `timeout-minutes`
backstop keeps a wedged Chrome from pinning a runner.

The workflow does not fail when a stage degrades — a partial audit is a real
result and the email says which parts are missing. It fails only when no report
was produced at all.

### 4. `--email` on the CLI + `src/prospect/email.ts`

One new flag rather than a second workflow step, so the runner's happy path is a
single command and the same flag works from a terminal.

The sheet is deliberately BOTH: a readable summary in the body (the four scores,
what was not measured, the top fixes, and the `/r/{token}` link) **and** the full
rendered report attached as an HTML file, so it survives independently of the
link and of Turso.

Recipients come from `PROSPECT_AUDIT_RECIPIENTS` (comma-separated) rather than
being hardcoded, so adding Erik or a client-services address later is an env
change. With the var unset the audit still runs and persists — it just reports
that it could not email, rather than failing the run.

Sending reuses `src/reports/send/resend.ts` and its `FROM_ADDRESS`; no new
provider, no new domain to verify.

### 5. `listRecentProspectAudits(db, limit)`

Added beside the existing accessors in `src/db/prospect-audits.ts`. Selects the
columns the page shows — deliberately NOT `result_json`, which is large and
irrelevant to a listing, and not `token`… except that the listing needs the token
to build the link, so it is selected and rendered only into the href.

## Testing

Same posture as the rest of the module: the page and the endpoint are unit-tested
against an in-memory database with an injected dispatcher, so no test reaches
GitHub, Resend or the network. The email builder is tested as a pure function
over a `ProspectAuditResult`. The workflow YAML is covered by the repo's existing
workflow-lint conventions only — CI cannot dispatch itself.

## What this deliberately does not do

- No live progress or polling. The email is the notification.
- No queue table. `workflow_dispatch` is the queue, and GitHub's Actions tab is
  the run log.
- No re-run or cancel buttons in v1.
- No public access. Same Basic auth as every other cockpit page.

## Deploy-time

- GitHub secrets: `ANTHROPIC_API_KEY`, `PERPLEXITY_API_KEY`, `RESEND_API_KEY`,
  `PROSPECT_AUDIT_RECIPIENTS` (the Turso pair already exists).
- Netlify env: `GH_TOKEN`/`RENOVATE_TOKEN` already present for the Renovate
  trigger is reused for the dispatch — confirm its scope covers this repo's
  Actions.
- Until `ANTHROPIC_API_KEY` exists, runs still work and still email; the
  answerability and probe sections read "not measured", which is the honest
  behaviour the audit was built around.
