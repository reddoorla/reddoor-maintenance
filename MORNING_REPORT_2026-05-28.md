# Morning report — 2026-05-28

> Written evening of 2026-05-27 after the second deep-review pass. Companion to [MORNING_REPORT_2026-05-27.md](MORNING_REPORT_2026-05-27.md) and [MORNING_REPORT_2026-05-27-bug-hunt.md](MORNING_REPORT_2026-05-27-bug-hunt.md). Road-to-1.0 arc tracked in the [road-to-1.0 memory](.claude/projects/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/memory/road-to-1.0.md).

## Executive summary

The 0.9.x arc closed. Today shipped 6 feature/fix PRs plus 4 release PRs, taking the package from **0.8.0 → 0.10.3** on npm, with end-to-end validation on both the report flow (ERP webhook delivery) and the init flow (caltex re-onboard). Two real bugs surfaced during dogfooding (`dollar-restprops` codemod corrupted Accordian.svelte, a11y audit hit the same 30s spawn timeout we already fixed for lighthouse) and were both fixed + released within the same session.

Tonight's deep-review pass surfaced **two new risks neither today's PRs nor the existing test suite caught**:

1. **`legacy-reactive.ts` brace-counter ignores comments** — silent source corruption risk, same class as the dollar-restprops bug but worse (corrupted output compiles, so the bug ships without a parser to scream).
2. **`import.meta.url`-based path resolution exists in 2 more places** — `self-version.ts` + `bin.ts`'s `resolvePackageVersion`. Same bug shape as the bundled-assets ENOENT we hotfixed today, just hasn't bitten yet.

Both are worth a focused spike tomorrow. After that, the road-to-1.0 work is mostly dogfooding + waiting (GA Workspace perms, caltex dev-server, monthly cycle).

---

## What shipped today (2026-05-27)

| Version | PR    | What                                                                                                  |
| ------- | ----- | ----------------------------------------------------------------------------------------------------- |
| 0.9.0   | #43   | feat(audit): per-site lighthouse URL via `package.json#reddoor.lighthouseUrl` (+ 5-min lhci timeout)  |
| —       | #42   | docs: archive 0.7/0.8 paper trail + 0.9.0 scope sketch                                                |
| —       | #45   | chore: gitignore `secrets/` + record GA Data API spike outcome (DEFERRED)                             |
| 0.10.0  | #46   | feat(recipes): `reddoor-maint init` — one-shot guided onboarding + `a11y-fixtures-page` recipe        |
| 0.10.1  | #48   | feat(webhook): GET health-check + Netlify deploy procedure in README                                  |
| 0.10.2  | #50   | fix(reports): bundled-assets loader walks up to find dir (0.10.0–0.10.1 ENOENT hotfix)                |
| 0.10.3  | #52   | fix(codemod, audit): dollar-restprops trailing-comma + a11y spawn timeout                             |

391 → 393 tests across the day. No open PRs, no open issues. Release pipeline is healthy — every merge auto-opens a version-packages PR and OIDC publishes when that merges.

---

## End-to-end validations performed

- **Report flow:** Real Maintenance email sent for ERP Industrials via `npx @reddoorla/maintenance@0.10.2 report --send-ready`. Resend POSTed `email.delivered` to the deployed Netlify webhook (https://reddoor-webhooks.netlify.app/.netlify/functions/resend-webhook). Airtable Reports row's `Delivery status` flipped `pending → delivered`. Closes the original 0.7.0 design loop.

- **Init flow:** `npx @reddoorla/maintenance@latest init` against caltex. Surfaced the dollar-restprops `,,` bug + a11y 30s timeout. Both fixed in 0.10.3. Re-run against caltex on 0.10.3 confirmed:
  - Accordian.svelte committed with valid syntax (single comma + rest)
  - a11y audit error shape changed from `spawn timeout after 30000ms: npx` to `no results written (exit 1)` — proves the timeout fix lets playwright actually run; the remaining failure is caltex's dev-server (Tucker's separate work).

- **Caltex merge state (synced to GitHub):** Two new maint/* branches merged into caltex `main` via `--no-ff`. svelte-codemods commit produces valid Accordian.svelte. a11y-fixtures-page route now exists at `/dev/a11y-fixtures`. The old morning-run duplicate branch was deleted.

---

## Risks surfaced tonight (NOT in any of today's PRs)

### 🔴 HIGH: `legacy-reactive.ts` brace counter ignores comments — silent corruption risk

[src/recipes/svelte-5/codemods/legacy-reactive.ts:26-46](src/recipes/svelte-5/codemods/legacy-reactive.ts#L26-L46)'s `findMatchingClose` walks `$: { ... }` blocks counting braces. It correctly skips string literals but does NOT skip `// line comments` or `/* block comments */`. Input shape that exposes it:

```svelte
<script>
  $: {
    // closing brace: }
    console.log("test");
  }
</script>
```

The `}` inside the comment increments the brace depth incorrectly. Result: codemod will either consume code AFTER the reactive block (because depth reaches 0 too early) OR drop code FROM the block (because the closing brace is mis-counted). Output still compiles — Svelte is lenient — so the corruption ships silently.

Same bug class as the dollar-restprops trailing-comma issue but worse, because there's no parser error to surface it.

**Spike scope:** Extend `findMatchingClose` to skip `//` (to end-of-line) and `/* */` segments. Same string-skip pattern already there, just additional cases. Add regression tests with both comment shapes. Probably 1 hour.

### 🟡 MEDIUM: `import.meta.url`-based path resolution exists in 2 other places

The 0.10.0–0.10.1 bundled-assets ENOENT we hotfixed today was a single instance of a class. Two more candidates:

- [src/util/self-version.ts](src/util/self-version.ts) walks up from `import.meta.url` to find `package.json` for the version string. Used by `onboard.ts` (line 73) and `bin.ts` (line 18). Defensively returns `"0.0.0"` on failure, so a bug would silently emit the wrong version into onboarded sites' deps — no error, just wrong pinning.
- [src/cli/bin.ts:17-18](src/cli/bin.ts#L17-L18) calls `resolvePackageVersion(here)` with `here = dirname(fileURLToPath(import.meta.url))`. Assumes `dist/cli/` is 2 levels from package root. Tsup's current layout makes this true, but if tsup ever inlines bin.js differently, breaks silently.

The regression test we added today ([tests/reports/bundled-assets.test.ts](tests/reports/bundled-assets.test.ts)) only covers the email-assets loader. The pattern that catches THIS bug class — "spawn Node, import from built dist/, assert no throw" — should be applied to every `import.meta.url`-using module.

**Spike scope:** Extend the bundled-assets test pattern into a generic "imports from dist work correctly" suite. Audit any other `import.meta.url` usage in src/ as part of it. Probably 1-2 hours.

### 🟢 LOW: recipes spawn `pnpm install`/`pnpm up` with no timeout at all

`bump-deps`, `convert-to-pnpm`, and `onboard` all run `pnpm install` or `pnpm up` via `defaultSpawn` directly (NOT through `runAudits`), so they get `timeoutMs: undefined` — no upper bound. Streaming is on so the user sees progress, but a wedged subprocess (network drop, pnpm bug) could hang forever rather than die at 30 s. Mitigation today: operator can ctrl-C. Real fix: add a generous per-recipe timeout (10 min?) so an actually-wedged install eventually surfaces.

Not urgent — no one's hit this — but worth pinning if we have a quiet day.

### 🟢 LOW: `security` audit `pnpm audit`/`npm audit` inherit the 30s default

Usually fast (<10s) but can spike on cold caches. Borderline — bump if it ever fires.

---

## Road to 1.0 status

Updated [road-to-1.0 memory](.claude/projects/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/memory/road-to-1.0.md) reflects:

- ✅ 0.9.0 lighthouse URL — shipped
- ✅ 0.10.0 init recipe — shipped + validated against caltex
- ✅ 0.10.1 webhook deploy procedure — shipped + Netlify site live + Resend webhook registered + verified end-to-end via ERP
- 🟥 GA Data API — DEFERRED, gated on Tucker getting Workspace admin perms to lift the service-account block (see [ga-data-api-spike-2026-05-27 memory](.claude/projects/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/memory/ga-data-api-spike-2026-05-27.md)). Stopgap (operator fills `gaUsersCurrent`/`Previous` in Airtable) works architecturally.

**Per the road-to-1.0 freeze criteria — three things stand between us and cutting 1.0.0:**

1. **Full monthly cycle without critical bugs.** We've validated single ERP send + single caltex init. We have NOT yet run an actual scheduled monthly cycle (multiple sites, `--due` flag, full week of webhook events). The 0.10.x patch cycle today validated that we'd find bugs in dogfooding — counted: 4 fixed in one session. Expect more from a full month.

2. **README polish.** The README has grown organically across 0.7→0.10. Tonight a fresh read would surface stale paragraphs, inconsistent voice, and probably a few spots where the order doesn't match the actual recommended flow (e.g. `init` is in the right place but the `Reports` section reads as bolted-on rather than integrated).

3. **No breaking changes for 1.x without a 2.0 bump.** Today's API additions (init, a11y-fixtures-page, exported loadBundledImages, etc.) are all additive. Nothing in 0.10.3 ships a breaking change, so 1.0 can be cut from current main when the above two are done. Library exports are stable.

**Decision rules from memory still hold:**

- If GA discovery in 0.9 burns >4h: ship 1.0 with manual GA entry. (We're at ~45 min of spike time; ample runway when perms are sorted.)
- If webhook deploy is annoying: ship without it. (Already shipped + live.)
- Don't add multi-tenancy abstractions.

---

## Plan for tomorrow (priority order)

### Tier 1 — fix what tonight's review surfaced

1. **`legacy-reactive.ts` comment-aware brace counter.** 1-hour spike. Same shape as today's dollar-restprops fix (TDD: regression test with `// }` and `/* } */` inputs, fail before, pass after; tighten `findMatchingClose` to mask comments same way it masks strings). Patch bump → 0.10.4.
2. **Generic `import.meta.url` drift regression test.** 1-2 hours. Extend `bundled-assets.test.ts` into a suite that imports every entry from dist/ and exercises any `import.meta.url`-anchored code path. Audit `self-version.ts` + `resolvePackageVersion` while there. Patch bump folded into the same release.

### Tier 2 — close out the 0.9.x cleanup

3. **Stale local branch cleanup.** `chore/bump-node24-actions` (31h old, never finished?), plus 7 feature branches from 0.1.x-0.6.x days that should be reaped. Mostly a `git branch -d` cycle for already-merged ones; investigate the chore/bump-node24-actions one before deleting.
4. **Pre-publish smoke gate (optional).** Add a `pnpm test:dist` script that spawns the built `dist/cli/bin.js` end-to-end (--help + a couple of obviously-correct commands). Catches the bundled-assets bug class at CI time rather than at consumer time. Optional because today's regression test already covers the specific instance we hit.

### Tier 3 — the road-to-1.0 longer game (your timeline, not bounded to tomorrow)

5. **README polish pass.** Read fresh, fix order, tighten voice, ensure `init` reads as the actual entry path.
6. **Start an actual monthly dogfooding cycle.** Schedule the first real `report --due` run, watch for failure modes the test suite doesn't simulate.

### Background — external dependencies, not "tomorrow" work

7. **Workspace admin perms for GA.** When sorted, retry the spike (5-min rerun per the [memory](.claude/projects/-Users-tuckerlemos-Documents-GitHub-reddoor-maintenance/memory/ga-data-api-spike-2026-05-27.md)). Either real GA integration follows OR pivot to OAuth user flow.
8. **Caltex dev-server fix** (your separate work). Once routes respond, lighthouse + a11y audits can complete cleanly on caltex.

---

## Notes for next session

- Today's session showed dogfooding catches bugs unit tests don't — codify it: any codemod change should be smoke-tested against an unrelated site before declaring done.
- The `chore(release): version packages` PRs are noisy in `git log` (4 of them today alongside 4 substantive PRs). Worth considering whether to batch changesets into single weekly releases vs per-PR releases. Not urgent.
- We have **two empty `.changeset/*` files** (`README.md` and `config.json` are just changeset's templates). No pending changesets to release. Clean state.
