# Morning report — 2026-05-22

Deep review of `@reddoorla/maintenance` after yesterday's `0.3.0 → 0.6.1` arc + two-site pilot. Findings prioritized for triage.

---

## Where we are

- Package published at `0.6.1` on npm.
- Caltex and espada PRs merged — both fleet sites building clean, aligned on `vite ^6` + `vite-plugin-svelte ^5`.
- Six recipes shipped (sync-configs, bump-deps, svelte-4-to-5, svelte-codemods, convert-to-pnpm, onboard) plus five gotcha codemods.
- 200+ tests across 39 files. Typecheck/lint/build all clean.

The package works. It also has a number of issues that became visible only in the deep read — most are quick fixes.

---

## CRITICAL — ship 0.6.2 first thing

These three are tightly coupled. One PR.

### 1. `legacyReactiveToRunes` codemod never made it into published 0.6.1

Yesterday's PR #20 was merged at commit `421a757` (dollar-props-class only). My follow-up commit `ee904d1` (the `$:` codemod) was pushed afterwards and never got included in the merge — it lives only on the orphan remote branch `fix/0.6.1-dollar-props-class`.

**Impact:** anyone running `npm install @reddoorla/maintenance@0.6.1 && reddoor-maint svelte-codemods` against a fresh site that has `$:` reactive statements will get the same espada-style build failure we fixed. The fleet sites are patched because I used local dist, but the npm package isn't.

Files to restore (cherry-pick from `origin/fix/0.6.1-dollar-props-class`):

- `src/recipes/svelte-5/codemods/legacy-reactive.ts`
- `tests/recipes/svelte-5/codemods/legacy-reactive.test.ts`
- Add `legacyReactiveToRunes` import + entry to `src/recipes/svelte-5/step-gotchas.ts` CODEMODS array

**Root cause** of the lost commit: GitHub auto-merge / PR #20 was merged with the commit graph at the time, not the latest. Likely race condition where the merge fired before the second push registered. Process fix below.

### 2. `svelte-codemods` recipe not exported from package entry

[src/index.ts](src/index.ts) exports `syncConfigs`, `bumpDeps`, `upgradeSvelte4to5`, `convertToPnpm`, `onboard` — but not `svelteCodemods`. Library consumers (anyone importing the package programmatically) can't reach it. CLI works because it imports directly.

Fix: add `svelteCodemods` to the export list in [src/recipes/index.ts](src/recipes/index.ts) and re-export it from [src/index.ts](src/index.ts).

### 3. `ALL_RECIPE_NAMES` is missing `"svelte-codemods"`

[src/recipes/index.ts:18-24](src/recipes/index.ts#L18-L24) lists 5 recipes; the `RecipeName` type union includes 6. `isRecipeName("svelte-codemods")` returns `false`, silently. This is the same kind of registration-drift bug I should add a type-test for.

Fix: one line — add `"svelte-codemods"` to the array.

---

## HIGH — real bugs, fix this week

### 4. `DEFAULT_PACKAGE_VERSION` is hardcoded at `^0.2.0`

[src/recipes/onboard.ts:22](src/recipes/onboard.ts#L22). Three majors stale. Any new site onboarded today gets `@reddoorla/maintenance@^0.2.0` (which would resolve to 0.2.0 at best — `^0.x` doesn't cross minors). They miss everything from 0.3 onwards.

Fix: use `resolvePackageVersion(...)` (already exists in [src/cli/version.ts](src/cli/version.ts)) at runtime, or read the package's own `package.json` version. Test: onboard a fresh fixture, assert the pinned version matches the current package version.

### 5. `writePackageJson` clobbers source indent style

[src/util/pkg.ts:16-19](src/util/pkg.ts#L16-L19) hardcodes `JSON.stringify(pkg, null, 2)`. Sites using tabs (espada had this) or 4-space indent get rewritten to 2-space — a noisy, irrelevant diff in every recipe that touches `package.json`. We've seen this on `convert-to-pnpm` + `onboard` already.

Fix: detect source indent before write (peek at first non-blank line's leading whitespace) and round-trip with that style. Could use a `detect-indent`-style helper or roll a tiny one.

### 6. `bump-deps` runs `pnpm install` before checking working tree clean

[src/recipes/bump-deps.ts:35](src/recipes/bump-deps.ts#L35). If the site's lockfile is out of sync with package.json, the install will update it. The recipe then checks "is the tree clean?" and either:

- Bails because tree is dirty (leaves user with stray lockfile changes they didn't ask for), or
- Proceeds and silently includes the lockfile changes in the bump commit.

Fix: check working tree clean BEFORE running install, or use `pnpm install --frozen-lockfile` for the "what's outdated?" check.

### 7. `bump-deps` doesn't support npm/yarn sites

Hardcoded `pnpm outdated --json` and `pnpm up` ([src/recipes/bump-deps.ts:37,67](src/recipes/bump-deps.ts#L37)). Workflow is "run convert-to-pnpm first" — fair, but not documented and not enforced (no pre-flight check). User gets a confusing npm error.

Fix: detect package manager (same logic as elsewhere — look for lockfile) and either dispatch to the right command or return a "failed" with a clear "run convert-to-pnpm first" note (matching the pattern `onboard` already uses).

### 8. `--only` flag accepts arbitrary strings

[src/cli/commands/sync-configs.ts:17-19](src/cli/commands/sync-configs.ts#L17-L19) (and audit/upgrade commands have the same pattern):

```ts
function parseOnly(value?: string): ConfigName[] | undefined {
  return value ? (value.split(",").map((s) => s.trim()) as ConfigName[]) : undefined;
}
```

`as ConfigName[]` is a lie. `--only typo-here` is silently passed through. The recipe quietly does nothing because `templatesByName(["typo"])` returns `[]`. User sees "noop" and has no idea their flag was wrong.

Fix: validate against `ALL_CONFIG_NAMES` (which should also exist as a runtime export). Same for `AuditName` and `RecipeName` lookups elsewhere.

### 9. `sync-configs --dry --only gitignore` lies

[src/cli/commands/sync-configs.ts:21-33](src/cli/commands/sync-configs.ts#L21-L33). `dryPlan` only inspects the 5 template configs. If you `--dry --only gitignore` against a site missing `.gitignore`, you get "no changes needed" — but the actual `--only gitignore` run would create the file and possibly untrack artifacts.

Fix: extend `dryPlan` to call `planGitignore` when `gitignore` is in the target set.

### 10. `AUDIT_DEPS` versions hardcoded in onboard.ts

[src/recipes/onboard.ts:24-30](src/recipes/onboard.ts#L24-L30). `@lhci/cli@^0.15.1`, `@playwright/test@^1.59.1`, `@axe-core/playwright@^4.11.3`. These will go stale exactly like `DEFAULT_PACKAGE_VERSION` did.

Fix: source them from `src/configs/baseline-versions.ts` instead — single source of truth.

### 11. `legacyReactiveToRunes` block→`$effect` may compile but breaks reactivity

The block pattern `$: { justify = float; if (...) justify = "..." }` becomes `$effect(() => { ... })`. But if `justify` was declared as plain `let` (not `$state`), mutations inside `$effect` don't trigger UI updates. Code compiles, UI silently doesn't react.

Caltex's TestimonialBox / ContentBox / GallerySliders use this pattern. Worth manually verifying those still render correctly when their `float` prop changes (does it ever? Probably not in practice — these are static configs from Prismic). Real impact may be zero, but the codemod's documentation should be honest about the limitation.

Fix options:

- Document: codemod is "make it compile" — manual refinement to `$state` + `$effect` (or per-variable `$derived`) may be needed for actual reactivity. Add to the codemod's docstring + the `MIGRATION_SVELTE_5.md` it writes.
- OR teach the codemod to also wrap mutated locals in `$state(...)` (significantly more complex — requires identifying the targeted locals and their declaration sites).

### 12. `removeDollarRestProps` does global string-replace including inside string literals

[src/recipes/svelte-5/codemods/dollar-restprops.ts:34](src/recipes/svelte-5/codemods/dollar-restprops.ts#L34): `next.replace(/\$\$restProps/g, "rest")` applies to the whole source, including string literals like `"$$restProps was..."`. Unlikely in practice but a real correctness gap.

Fix: mask string literals before replace (we already have this primitive in `legacy-reactive.ts`'s `findStringClose` — extract to shared util).

---

## MEDIUM — debt worth addressing

### 13. README is ~empty

[README.md](README.md) is 19 lines: install + `--help`. No recipe descriptions, no usage examples, no onboarding flow, no architecture. References `docs/specs/...` paths that may or may not be useful.

A new engineer who'd need to use this on a new reddoor site would have to read source. Worth investing 1–2 hours to write a real README covering:

- The intended fleet onboarding flow (`convert-to-pnpm` → `onboard` → `sync-configs` → `svelte-codemods` → audit)
- Each recipe's one-paragraph description
- The inventory file format
- The "I ran `--only` and nothing happened" troubleshooting line

### 14. CLI bin.ts has 7 copies of the same try/catch wrapper

[src/cli/bin.ts](src/cli/bin.ts) — every command's `.action(...)` body is identical:

```ts
try {
  const { output, code } = await runXCommand(...);
  console.log(output);
  process.exit(code);
} catch (err) {
  const e = err as { exitCode?: number; message?: string; stack?: string };
  console.error(opts.verbose ? (e.stack ?? e.message) : (e.message ?? String(err)));
  process.exit(e.exitCode ?? 1);
}
```

237 lines of file, of which ~60 are this boilerplate. A `wrap(handler)` helper would shrink the file by ~25%. Not urgent, but adding the 7th, 8th command makes it worse.

### 15. Recipe-level boilerplate

Every recipe re-implements: `siteLabel`, `isWorkingTreeClean` check + throw, `branchName(...)` + `createBranch(...)`, commit-with-message pattern. These could live in a shared `withRecipe(...)` helper that wraps an inner function. Would tighten ~100 lines across recipes and make adding a new recipe much shorter. Not urgent — current pattern is readable.

### 16. Test coverage gaps

- **No CLI tests except `sync-configs`** — `audit`, `bump-deps`, `upgrade`, `onboard`, `svelte-codemods`, `convert-to-pnpm` CLI commands have no integration test. The `--only` invalid-flag bug above would be caught by these.
- **No end-to-end test for `svelte-4-to-5`** — the 7-step recipe is the most complex. Only its codemod sub-units are tested. Would benefit from a fixture-based "Svelte 4 site → Svelte 5 site" integration test.
- **No tests for codemod composition** — when multiple codemods touch the same file in one pipeline run. Yesterday surfaced that `exportLetToProps` must run before `dollarPropsClass`; that ordering is only enforced by the array's order, not tested.
- **No type-registration test** — would catch issues like `ALL_RECIPE_NAMES` drift from the `RecipeName` union.

### 17. Codemod approach scaling

All five codemods are regex-based. We've already needed:

- Lazy backtracking instead of `[^}]*` (dollar-props-class regression).
- Manual brace counting (`findMatchingClose` in legacy-reactive, `removeInterfaceBlock` in dollar-restprops).
- String-literal masking (legacy-reactive only — not the others).

This works for the patterns we've encountered. The next pattern that doesn't fit (anything involving JSX-like nested structures, template literals with embedded expressions, or transformations that need semantic information about scope) will probably be where we hit the wall.

When that happens: switch to the [Svelte compiler's parser](https://svelte.dev/docs/svelte-compiler#parse) (it's already a transitive dep) or [magicast](https://github.com/unjs/magicast) for the JS side. Worth tracking how often regex limitations bite us before pulling the trigger.

### 18. Some duplicated utilities

`readMaybe`, `siteLabel`, string-literal masking, brace matching — each appears in 2–3 places. Extracting to `src/util/string.ts` or similar would be a small win.

---

## LOW — polish

- **Inconsistent codemod file naming.** `dollar-props.ts` (exports `exportLetToProps`), `dollar-restprops.ts`, `dollar-props-class.ts`. The "dollar" prefix is a remnant — files should be named for what they do (`export-let-to-props.ts`, `dollar-restprops.ts` could stay, `dollar-props-class.ts` is fine).
- **`security` audit normalizes "info" severity to "low"** (line 60-61). Conservative call but worth documenting. Currently buried in a comment.
- **A11y audit writes a temp Playwright spec.** Clever but requires the site to have Playwright installed. Documented in onboard's `AUDIT_DEPS` but not gracefully handled if missing — would be nice to give a clear "install @playwright/test first" message rather than a Playwright runner error.

---

## What's working — keep

- **Recipe pattern** (refuse on dirty tree → create branch → atomic commits → return RecipeResult). Clean, reviewable. Same pattern across all 6 recipes is a feature.
- **Plan/apply split in `step-gotchas`.** The dry-run side enables `svelte-codemods` to short-circuit cleanly on noop. Worth replicating for sync-configs and bump-deps when they get dry-mode work.
- **Security audit pnpm→npm fall-through.** Earlier silent-false-pass bug is properly fixed with the error-envelope detection.
- **Conservative codemod philosophy.** Every codemod has "only transforms when expressions match" guards. Yesterday's brace-default bug would have been a quiet silent corruption with a less conservative approach.
- **The `--fleet inventory.json` shape.** Validation in [inventory/json.ts](src/inventory/json.ts) rejects relative paths — small thing, prevents foot-gun.
- **OIDC + provenance publishing.** The release workflow is clean.

---

## Recommended morning sequence

1. **Ship 0.6.2** (criticals #1–#3): one PR, cherry-pick the lost codemod + fix the two registration drifts. ~30 min.
2. **0.6.3** with HIGH bugs #4, #5, #7, #8, #10 — these are all small mechanical fixes. ~2 hrs.
3. **Branch protection on `main`**: require status checks + linear history to prevent another merge race. ~10 min in repo settings.
4. **Inventory the rest of the fleet.** What sites haven't been onboarded? Build an `inventory.json` for them; aim to run the full onboarding flow against the next 2–3 sites this week.
5. **README** (debt #13). 1–2 hrs but a real morale + onboarding win.
6. **Then** tackle the `vite 6 → 7 → 8` + `vite-plugin-svelte 5 → 7` baseline alignment (the original "later" task). Probably one site at a time; each will surface real issues that warrant either a codemod or a doc note.

## Riskiest unknown

`legacyReactiveToRunes` block patterns potentially compile but don't react. Should manually verify caltex's `float` prop never changes at runtime for the affected components (`TestimonialBox`, `ContentBox`, `GallerySliderLarge`, `GallerySliderSmall`). If `float` does change (e.g., from Prismic content updates), some UI elements may not repaint without manual refinement.

---

## Addendum — adversarial second pass

Ran a second code-review agent against this report. Findings that change the picture:

### Severity re-prios

- **#4 (`DEFAULT_PACKAGE_VERSION`) should be CRITICAL, not HIGH.** A fresh `onboard` today pins to `^0.2.0` — three majors stale, missing every codemod and every recipe added in 0.3+. Bundle into 0.6.2 alongside #1–#3.
- **#11 (block→`$effect` reactivity) is moot for 0.6.1 users** because the codemod isn't actually published (see #1). Once #1 lands, the underlying concern is real but I was underestimating it — most reddoor components use `let`, not `$state`, for locals. The codemod produces silently-broken reactivity whenever the effect body mutates a non-`$state` local. Worth emitting `@migration-task` markers per converted block so users can audit.

### New bugs I missed

**A. `removeDollarRestProps` produces references to undeclared `rest`.** [src/recipes/svelte-5/codemods/dollar-restprops.ts:34](src/recipes/svelte-5/codemods/dollar-restprops.ts#L34) globally swaps `$$restProps` → `rest` in the template but never destructures `...rest` from `$props()`. Output: `<div {...rest}>` referencing an undefined identifier. None of the 5 existing tests would catch this. **Severity: HIGH** — silent runtime breakage on any component using `$$restProps`.

**B. `git clone` argv-injection via `repoUrl`.** [src/cli/fleet/clone-if-needed.ts:57](src/cli/fleet/clone-if-needed.ts#L57). `repoUrl` from inventory is passed positionally; git treats argv starting with `-` as a flag (CVE-2017-1000117 family). A malicious inventory entry `{"repoUrl": "--upload-pack=evil"}` becomes RCE. Inventory is usually trusted but the `.mjs/.js` flavor runs unsandboxed code. **Fix: `["clone", "--", repoUrl, target]` + URL scheme validation.** Severity: HIGH for a fleet tool — easy one-line fix.

**C. `convert-to-pnpm` doesn't `rm -rf node_modules` before `pnpm install`.** [src/recipes/convert-to-pnpm.ts:103](src/recipes/convert-to-pnpm.ts#L103). pnpm against a flat npm `node_modules` produces phantom-dep issues. One-liner fix.

**D. `branchName` is second-precision.** [src/util/git.ts:10-15](src/util/git.ts#L10-L15). Two invocations within the same second collide. Serial fleet runs hit this rarely; parallel invocations from two terminals would. Worth adding ms or a random suffix.

**E. `onEventToHandler` silently leaves modifier syntax alone.** [src/recipes/svelte-5/codemods/on-event-to-handler.ts:2](src/recipes/svelte-5/codemods/on-event-to-handler.ts#L2). `on:click|preventDefault={fn}` doesn't match the regex (no `=` immediately after the event name). Svelte 5 removed modifier syntax entirely — users hit build errors with no migration hint. The test file at line 22-26 codifies this as desired behavior; should emit `@migration-task` instead.

**F. `git add -A` in every commit.** [src/util/git.ts:53](src/util/git.ts#L53). The recipe contract is "atomic commits, each touching what the recipe intended" but `commit()` stages everything. Pre-check `isWorkingTreeClean` mitigates this at recipe start but not between steps. Better: each recipe step explicitly stages its touched paths.

**G. `/g`-stateful `.test()` in `dollar-props-class`.** [src/recipes/svelte-5/codemods/dollar-props-class.ts:60-61](src/recipes/svelte-5/codemods/dollar-props-class.ts#L60-L61). Resets `lastIndex` manually — fragile. Switch to `.includes("$$props.class")` or non-`/g` regex for the existence check.

**H. `sync-configs --dry` (default, not just `--only gitignore`) doesn't include gitignore changes either.** Expansion of my #9 — the bug is broader than I flagged.

**I. Audit `security` could still false-pass on `metadata.vulnerabilities = {}`.** [src/audits/security.ts:175](src/audits/security.ts#L175). `!{}` is `false`, so the empty-object case passes the existing check; counts all default to 0; result is "pass" without ever seeing real data. Tighten with `Object.keys(...).length === 0` or require at least one expected count key present.

**J. TOCTOU in `cloneIfNeeded(target)`.** Between `isNonEmptyDir(target)` and the `git clone` call, another process could populate the target. Benign (clone errors loudly) but worth knowing for any future fleet-mode parallelism.

**K. No fixture-based test for the full pipeline composition** (`convert-to-pnpm` → `onboard` → `sync-configs` → `svelte-codemods`). Yesterday's lockfile resync bug + the `node_modules` staleness bug would both have been caught by such a test. Highest-leverage test-coverage debt.

**L. Verify README scope.** I called it "~empty, 19 lines" — there's also a `docs/` directory I didn't inspect. If `docs/` is substantive the rewrite estimate may be wrong.

### Architectural fragility worth surfacing

- **Codemod ordering enforced only by array position in `step-gotchas.ts`.** Comment says order matters; no test guards it. If someone refactors `CODEMODS` into a `Map<string, Codemod>`, ordering breaks silently. Add a composition test.
- **`step-gotchas` reads all files sequentially.** Fine for ~50 components; a 500-file site would feel slow. Use `Promise.all` with a concurrency limit.
- **`planGotchaCodemods` keeps every changed file's full `after` content in memory.** OK now; could matter on a 5000-file repo. Stream-then-write is safer.

### Updated 0.6.2 scope (vs. original morning plan)

Bundle these into the 0.6.2 PR instead of waiting:

1. (original CRITICAL #1) Restore `legacyReactiveToRunes` codemod.
2. (original CRITICAL #2) Export `svelteCodemods` from `src/index.ts`.
3. (original CRITICAL #3) Add `"svelte-codemods"` to `ALL_RECIPE_NAMES`.
4. (re-prioritized from HIGH #4) Dynamic `DEFAULT_PACKAGE_VERSION` from this package's own `package.json` at runtime.
5. (new from agent — #B) `git clone` argv-injection + `--` separator + URL scheme validation.

Items #A, #C–#K go into a 0.6.3 PR.
