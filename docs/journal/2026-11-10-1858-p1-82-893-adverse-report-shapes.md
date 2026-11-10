# 2026-11-10 — Two adverse report fixtures, and a report that now says when a check ran and failed (#893; reddoorla/reddoor-maintenance#2022, reddoorla/reddoor-website#340)

**Why.** `gen-report-shapes.mts` derived its five fixtures by deleting keys from one run of the producer. So the five covered every _key_ reddoor-website's `toReportView` reads, but never the _values_ that pick a branch: no stage failed, robots.txt was always read and blocked nothing, there was never a sitemap, and every category probe answered. Four branches had never run on a producer-shaped input. One of them guards the "named in 1 of 2" denominator defect, which has shipped once already.

**What.** The generator now writes `adverse-unmeasured.json` and `adverse-blocked.json`. Both are runs of today's producer over stubbed dependencies, and every stubbed failure is one the real code produces:

- **robots.txt:** times out with `AbortSignal.timeout`'s own `TimeoutError` on both tries, or turns GPTBot away;
- **sitemap:** lists 12 URLs, against the 3 pages the crawl reads;
- **category probe:** one of three throws the Anthropic SDK's `"Request timed out."`, which is not a 429/529, so it is dropped without a retry and still counts as attempted;
- **accuracy:** the model call throws accuracy.ts's own `"accuracy: the model returned no parsed output"`.

There are two files because one run cannot hold both robots cases: `checks.ts` fills `blockedAi` only after a successful fetch. Accuracy fails only in `unmeasured`, because the website prints the sitemap count inside the source-check section, which renders only when that check succeeded. The five existing outputs are byte-identical before and after (`cmp`, all five).

**Defect found, and the call it needed.** Rendered through reddoor-website's real `SourceCheck.svelte`, the failed-accuracy fixture printed "no assistant answer about Acme Roofing was captured to check against". Two answers had been captured. `stage()` mapped `{ok:false}` to the same `null` as a stage that never existed, so no surface could tell "ran and failed" from "never ran". The brief's first mutation, "make `stage()`'s failure branch read as 'not run'", therefore described the code as it already stood. That contradicted the brief, and changing it meant new copy on a prospect-facing report, so I asked rather than fixed past it. The operator answered at 10:30am PT: add the distinction everywhere (workspace `decisions/2026-11-10-1809-p1-82-893-failed-vs-not-run.md`). The website half is in reddoorla/reddoor-website#340, together with a second defect it surfaced: the print sheet printed "came back clean" when no health check had run.

**Beliefs corrected on contact:**

- `pnpm typecheck` never sees `scripts/`, because it is outside `tsconfig.json`'s `include`. I proved it with a planted `const bad: number = "s"`: the repo's `tsc` passed, and a standalone `tsc --ignoreConfig` on the file caught it, along with a real missing `error: null` in the `http` stub, now fixed with output unchanged.
- The generator's output for the five no longer matches reddoor-website's committed copies: the producer has since added `pagesWithTruncatedAnchors: []`. That drift predates this work and is left for its own regeneration commit.
- An existing website assertion required a non-empty `addresses` on every fix. The producer's type is `string | null`, and `adverse-blocked` carries a measured fix with `null`. The operator approved matching the type at 10:37am PT (`decisions/2026-11-10-1835-p1-82-893-fix-addresses-null.md`).
- My own mutation harness first reported all eight website mutants surviving. vitest prints failures on stderr, and the harness read stdout. Rerun with a no-op control, all eight were red. Had I trusted the first verdict, I would have reported eight dead tests.

**Review.** Round 1 on #2022 was minors only. Its minor was that the adverse guard checked only _which_ stages failed. Folded in: the guard now also requires the model's own error and each branch value, and two negative controls fire (a robots body naming another bot; a different accuracy error).

Usage: not readable (`get_session` carries no usage figures in this session).
