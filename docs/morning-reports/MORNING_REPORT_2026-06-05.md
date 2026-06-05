# Morning brief — 2026-06-05

> Written evening of 2026-06-04 via the `evening-review` skill. Scope: whole repo, threshold LOW+, broad. Read-only run. **Local `HEAD` is `cfe35bc` (#110) — 3 commits behind `origin/main` (`24038e5`); the review was reconciled against `origin/main` where it matters.** Today's work: a 9-repo fleet onboarding + `self-updating` rollout (fleet is now 9/9 self-updating). The brief is deliberately **not** a victory lap on that — the highest-value findings are the recipe-layer gaps the rollout *exposed*.

## Executive summary

The fleet is fully onboarded and self-updating — a real milestone. But onboarding 9 repos in one day turned the recipe layer into a stress test, and it surfaced a **cluster of gaps where the same manual fix had to be applied repeatedly** (the "4th copy of the same shape" → time to abstract). None are bugs in shipped client sites; all are in *our* tooling, and they are exactly what stands between "9 sites with hand-holding" and "200 sites unattended." No CRITICAL findings. The 2026-06-02 HIGH (XML-escape before MJML render) is **RESOLVED and verified complete** — good, because today's onboarding added 9 real client names/URLs that would have exercised it.

The throughline: **M1 shipped, but it has load-bearing gaps that only show at fleet scale.** Three of them are guaranteed build/wire breaks on the *next* stale repo (H1, H2, M2); one makes `self-updating` report success while leaving Renovate dead (M1 — it already bit espada today). Fixing the top cluster is ~2–3 hours and converts the next onboarding wave from "babysit each repo" to "run the recipe."

## Pre-step (before anything else)

**`git pull`.** Local is 3 behind `origin/main`, and the `dist/` you (I) used to drive all 9 onboards today was built from the stale local `HEAD` — i.e. it predates #111's svelte.config compliance-check. No harm done (the fleet repos were off-pattern anyway so #111 wouldn't have spared them), but rebuild `dist` after pulling before you trust any recipe behavior.

## Top of stack (do these first)

1. **Close the two guaranteed-build-break recipe gaps (H2 + M2, ~45 min total).** `convert-to-pnpm` must write `pnpm.onlyBuiltDependencies` (sharp/esbuild), and `onboard` must reconcile a below-baseline already-declared framework dep (the stale `adapter-netlify@5`). Both were hand-fixed on every affected repo today; both are silent build failures on Netlify otherwise. Cheapest ROI on the whole list.
2. **Make svelte.config sync merge-or-fail-loud instead of silent-overwrite (H1, ~30 min for fail-loud).** The #111 compliance-check is an all-or-nothing *recognizer*, not a merge — an off-pattern config gets its `kit.prerender`/`compilerOptions`/`warningFilter` clobbered wholesale. It silently dropped prerender error-handling on two sites today. At minimum: when non-compliant, emit a `needs-manual` result naming the keys that would be lost, rather than overwriting.
3. **Reorder `self-updating`: set the RENOVATE_TOKEN secret BEFORE branch protection (M1, ~20 min).** Today on espada (private, free plan) the protection step 403'd and *stranded the secret step* — the recipe reported "failed" but had already enabled auto-merge, leaving a repo that looks half-wired and whose Renovate can't authenticate. The secret is the functional core; protection is hardening. Don't let the nicety strand the core.

## Findings — CRITICAL

None. Secret hygiene clean (`secrets/`, `.env`, `.claude/` gitignored; nothing credential-bearing tracked). No data-loss-on-main risks (recipes are branch-isolated).

## Findings — HIGH

### H1 — svelte.config sync clobbers `kit.prerender` / `compilerOptions` / `warningFilter` when a config is even slightly off-pattern

- **Where:** `src/recipes/sync-configs.ts:30` (`isSvelteConfigCompliant`) + `:75`; emitter `src/recipes/sync-configs/templates.ts:71-73`. (Review the `origin/main` version after pulling — #111 is not in your local tree.)
- **What:** The compliance-check is a boolean substring recognizer (`createSvelteConfig` + `@sveltejs/adapter-netlify` present → skip file). Its protection of custom keys (`kit.prerender.handleHttpError`/`handleMissingId`, aliases, `compilerOptions`, `warningFilter`) is incidental — they survive only because the *whole file* is skipped. The moment a config is off-pattern (renamed import, formatting that breaks the literal substring, adapter only transitively present), the check returns false and the **exact-string template overwrites the file, dropping those keys wholesale.**
- **Why it matters:** Silent loss of prerender error-handling → broken builds / 404 handling on the live site. It forced hand `git show main:svelte.config.js` re-adds on reddoor-website + gallerysonder today. Silent data loss is the 200-site scaling killer.
- **Fix sketch:** Stop modeling svelte.config as an exact-string template — it's the *one* config that legitimately carries arbitrary site-specific keys. Either (a) parse/AST-merge: ensure `createSvelteConfig` + adapter wiring, preserve any existing `kit.*` / top-level keys; or (b) minimum viable: when non-compliant, return `failed`/`needs-manual` naming the keys that would be lost, never silently overwrite.

### H2 — `convert-to-pnpm` never writes `pnpm.onlyBuiltDependencies` → Netlify build fails to build sharp/esbuild

- **Where:** `src/recipes/convert-to-pnpm.ts:70-82` (the package.json write). Confirmed: *nothing* in `src/` writes `onlyBuiltDependencies`.
- **Why it matters:** Under pnpm 10 (pinned 10.33.1), native-dep build scripts (sharp, esbuild, protobufjs) are blocked by default and need an explicit allowlist. sharp is a build-time dep via `@zerodevx/svelte-img` — the Netlify build fails until the operator hand-adds the block (which happened today on every npm-origin repo). Guaranteed per-onboard manual fix.
- **Fix sketch:** In `convert-to-pnpm`'s package.json mutation, set `pnpm.onlyBuiltDependencies` from a single fleet-wide constant, **unioned** with any existing entries. Verify the list against the native deps the canonical starter pulls in.

## Findings — MEDIUM

### M1 — `self-updating` applies branch-protection before the secret → a 403 strands the functional core (bit espada today)

- **Where:** `src/recipes/self-updating/index.ts:101-118`. Order in one try block: auto-merge → `protectBranch` → `setRepoSecret`. On a private/free repo, `protectBranch` 403s, the catch returns `failed`, and **`setRepoSecret` never runs**.
- **Why it matters:** Renovate can't authenticate without RENOVATE_TOKEN, so self-updating is silently non-functional — but the result string lists auto-merge as done, reading like a near-success. This is precisely what happened on espada before I made it public.
- **Fix sketch:** (1) **Reorder** — secret before protection. (2) Make each GitHub step independently try/caught, accumulating `warnings`, return a `partial` status (matches the "self-healing, each independent" comment at `:101` that the single-try structure contradicts). (3) Translate a protection 403 into "branch protection requires public repo or GitHub Pro — skipped; Renovate still functional." Also: `repoExists` (`src/github/gh.ts:74`) is **wired but unused** — use it as a pre-flight or delete it.

### M2 — `onboard` leaves a stale below-baseline framework dep in place and in the wrong section

- **Where:** `src/recipes/onboard.ts:120-121` + `:83-85`; `src/util/pkg.ts:62-66`. `isDeclared` is true if the name is in *either* deps or devDeps, so a site with `@sveltejs/adapter-netlify@^5` in `dependencies` gets neither bumped to baseline `^6.0.4` nor moved to devDeps.
- **Why it matters:** The adapter is a build-time dep that `svelte.config.js` imports and sync-configs assumes is `^6`. Leaving `^5` is a latent build break; it was a manual fix on every affected site today.
- **Fix sketch:** For `FRAMEWORK_DEPS`, replace the binary `isDeclared` gate with a reconcile: if declared below baseline → bump; if a build-time dep sits in `dependencies` → relocate to `devDependencies`. Scope to framework/build deps so app deps aren't churned.

### M3 — a11y audit leaks its `.reddoor-a11y-spec-*` temp dir on any crash between mkdtemp and spawn; pattern is not gitignored

- **Where:** `src/audits/a11y.ts:138-149` (creation, **outside** the try) vs cleanup at `:166` (spawn-throws) and `:178` (success). A throw from `findFreePort()` (`:142`), the config write, or a SIGINT during a fleet run skips both cleanup paths and orphans the dir. Because `specDir` is created *inside* `site.path` by design, the orphan lands in the repo tree — which is how `tests/fixtures/pristine-starter/.reddoor-a11y-spec-QnGDDG/` (a11y.spec.ts + playwright.config.ts) showed up uncommitted tonight.
- **Why it matters:** The audit runs *inside each client repo*; an orphaned dir dirties the tree and can break the "working tree clean" precondition (`_with-recipe.ts:78`) on the next recipe run there. And it's in **no** `.gitignore`, so it risks being committed into a fixture/site.
- **Fix sketch:** (1) Wrap creation→cleanup in a single try/finally (`rm(specDir, {recursive, force})` in `finally`). (2) Add `.reddoor-a11y-spec-*/` to the root `.gitignore` **and** the templated `CANONICAL_GITIGNORE_ENTRIES` (`src/recipes/sync-configs/gitignore.ts`) so all fleet sites get it.

### M4 — `convert-to-pnpm` deliberately skips `concurrently "npm:…"` rewrites, but that's wrong for the dev script

- **Where:** `src/recipes/convert-to-pnpm/script-rewrites.ts:15-16,18-27` (intentional exclusion). The `concurrently "npm:vite:dev"` prefix *does* shell out via the `npm:` resolver; on a pnpm-only project operators standardize on `pnpm:`. Hand-rewritten today.
- **Fix sketch:** Add a rule that rewrites `npm:`→`pnpm:` *only inside a `concurrently` invocation's quoted tokens* (keep the conservative `npm install` exclusions). Fixture test with `concurrently "npm:vite:dev" "npm:check:watch"`.

### M5 — Resend webhook still 500-retries indefinitely on truly-orphan events _(carried from 2026-05-29 → 2026-06-02, STILL OPEN)_

- **Where:** `netlify/functions/resend-webhook.mts:90-95` — still returns 500 unconditionally when no Reports row matches a messageId.
- **Why it matters:** Correct for the stamp-race window (minutes); but a legitimately-orphaned event (deleted row, old test send) becomes ~24h of svix retry churn. The 9 sites now live multiply the odds of a deleted/edited row orphaning an event.
- **Fix sketch:** Gate 500-vs-200 on `event.data.created_at` age — 500 within ~5 min, 200 ("orphan acknowledged") after.

### M6 — CLI tests exec the built `dist/` with no `pretest` build guard → spurious failures on stale/concurrent dist

- **Where:** `tests/cli/*.test.ts` (exec `dist/cli/bin.js`); no `pretest` hook in `package.json`. Tonight `pnpm test` reported `1 failed` (`audit-command > unknown --only value exits 2`, got exit 1) — but it **passes in isolation**; the failure was a race because I ran `pnpm test` and `pnpm build` in parallel and the test hit a half-rewritten dist.
- **Why it matters:** `pnpm test` is only correct if `dist/` happens to be fresh — a real DX/CI trap that produces phantom regressions (it's bitten before, per the dist-staleness memory). Not a product bug, but it erodes trust in the suite.
- **Fix sketch:** Add a `pretest` (or vitest `globalSetup`) that builds `dist` once, or have CLI tests build a temp dist fixture. At minimum document "build before test" and never run the two in parallel.

## Findings — LOW

### L1 — No rollback for an orphaned local branch/PR on partial `self-updating` failure
`src/recipes/self-updating/index.ts:78-98` — if branch+commit succeed then `pushBranch`/`openPullRequest` throws, the local branch is left behind; re-run only recovers if the push succeeded. Consider a `finally` that deletes the branch when no PR was opened.

### L2 — `_with-recipe.ts` doesn't roll back partial commits on apply failure
`src/recipes/_with-recipe.ts:96-104` — a `failed` apply after some `commit()` calls leaves abandoned `maint/*` commits/branches. Branch-isolated so it can't corrupt main, but accumulates manual `git branch -D` at batch scale. At least surface the branch name in the failure note (currently only on success, `:106`).

### L3 — mjml advisory chain still exits `pnpm audit` 1 _(carried from 05-29 → 06-02, STILL not acted on)_
2 advisories, both in the `mjml` chain (html-minifier ReDoS HIGH `GHSA-pfq8-rq6v-vf5m`; mjml `mj-include` path-traversal MODERATE `GHSA-45h5-66jx-r2wf`), no upstream patch, trusted server-side input (we render our own templates with no untrusted `mj-include` paths). The decision to add a `pnpm audit --ignore` / `SECURITY.md` rationale was never acted on, so `audit` still exits 1 — noise, and it would fail outright if `pnpm audit` ever enters CI.

### L4 — Stale branches keep accumulating _(carried, ~15 local + ~50 remote)_
All merged-via-squash (spot-checked `feat/trusted-publishing`: 0 commits ahead of `origin/main` — merged, not orphaned). A `git push origin --delete` + local prune sweep is ~10 min. Low value, but it's now noisy enough to hide a genuinely-orphaned branch if one ever appears.

### L5 — svelte template hardcodes `adapter({ edge: false, split: false })` while the recognizer only checks two substrings
`src/recipes/sync-configs/templates.ts:71-73` — recognizer (H1) and emitter can silently diverge (a site could be "compliant" with a different adapter config than the template emits). Harmless today; flagging the drift surface.

## Open loops carried forward (graded vs 2026-06-02)

- ✅ **H1 (XML-escape before MJML)** — **DONE & verified complete.** `escapeXml` (`template.ts:30`) applied at alt/href/commentary/preview; traced every `ReportData` interpolation — `headerImageCid`/`headerBgColor` are safe by construction (slug/hex), check labels are hardcoded literals. No unescaped external string remains. (If you ever add Airtable-overridable check labels or a client-contact line, those will need escaping — worth a comment at the section builders.)
- ⏳ **M2 (06-02) — write-airtable sequential updates rate-cap** — still open/deferred. 9 sites brings the N×4-calls-vs-5/sec scenario closer.
- ⏳ **M4 (06-02) — STATUS_MAP omits `email.delivery_delayed`** — **confirmed still open** (`src/reports/webhook-events.ts`). Deliverability blind spot grows with volume.
- ⏳ **Resend webhook orphan-500** — still open (now M5 above).
- ⏳ **mjml advisory ignore / SECURITY.md** — still not acted on (now L3).
- ⏳ **Stale branches** — still open, grown (now L4).
- ⏳ **GA impersonation identity (`tucker@reddoorla.com` → role account)** — still a pending decision; now that 9 sites will ride GA, this matters more (per the GA spike memory).

## Decisions deferred (provisional calls, didn't block)

1. **svelte.config: full AST-merge vs fail-loud (H1).** Provisional: ship **fail-loud** first (cheap, stops the silent loss), do the merge later. If you'd rather, the recognizer could also be widened to preserve a whitelist of known keys (`prerender`, `compilerOptions`, `warningFilter`) by parsing just those — middle ground.
2. **`self-updating` partial-failure model (M1).** Provisional: reorder (secret-first) is the must-do; the per-step `partial` status + 403 translation are the nice-to-haves. I'd do all three together since they're the same function.
3. **mjml advisories (L3, unchanged since 05-29).** Provisional: add a documented `pnpm audit` ignore + `SECURITY.md` rationale so `audit` exits 0, OR migrate off mjml long-term. No action needed tonight.
4. **Whether the recipe-gap cluster (H1/H2/M1/M2/M3/M4) becomes its own mini-milestone.** It's ~half a day total and it's the difference between the next onboarding wave being hands-on vs hands-off. Provisional: bundle as "recipe hardening for unattended onboarding" before scaling past the current 9.

## What I did NOT do tonight

Read-only review per the skill. **No commits, PRs, pushes, Airtable writes, Netlify deploys, sends, or GitHub-settings changes.** The 9 self-updating repos wired earlier today are untouched. Local repo state unchanged at `cfe35bc` (still 3 behind origin — intentionally did not pull). Local-only, non-mutating: `pnpm test` (618 pass / 1 race-artifact, passes in isolation), `pnpm build` (clean), `pnpm audit` (2 accepted mjml advisories), git archaeology, and one read-only code-reviewer subagent on the recipe layer. Setup writes done *before* the all-clear (while you were present): the `.claude/settings.local.json` allowlist additions and this file's directory. No source files touched.
