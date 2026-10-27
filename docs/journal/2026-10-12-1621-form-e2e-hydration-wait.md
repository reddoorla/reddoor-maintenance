## 2026-10-12 — form-e2e waits for hydration before it fills, so `refilled` stops blaming sites for the probe's own wipe (#1148, #1316)

The probe's `fillAll` filled the contact form and then ran `injectExpr`, which appends hidden `testMode` and `cf-turnstile-response` inputs. `findFormPath` hands over the page at `domcontentloaded`, so all of that could land before SvelteKit hydrated. Svelte 5 reads a node it did not render as a hydration mismatch, clears the tree and mounts it again. The fills and the injected inputs go with it. The probe's wipe check then saw the empty fields, refilled once, and printed "fields were wiped by a client re-render and re-filled once", which its own comment called production proof of a site defect. On Mantis (2026-10-04) that was 5 re-mounts in 5 runs with the injection, against 0 in 19 with the fills alone. The probe was measuring itself.

**What changed.** A new helper, `waitForHydration` (`src/audits/util/hydration-wait.ts`), waits for `load` and then for `html[data-hydrated]`, the marker the starter's root layout writes in `onMount` (reddoor-starter#184). Both waits share one 5 s budget. The runner calls it once, before the first `fillAll`. A site that writes the marker is waited for exactly as long as it takes. A site without it cannot be told apart from one that has not hydrated yet, so for it the cap is a settle, and most of the fleet has no marker until the per-repo rollout. That residue is now visible. When a run refills without having seen the marker, the outcome carries `hydrationUnconfirmed`, and the summary line says "(hydration unconfirmed: html[data-hydrated] not seen before filling, so the probe may have caused it)". The persisted verdict is unchanged.

**Why the wait and not "inject only from the submit listener".** The issue offered both. Injecting only at submit would remove the pre-hydration node, but `testMode` is also the canary the wipe check reads, because it only exists if the probe put it there. It is also what the "marker must be on the form before the click" safety gate checks. Moving the injection to the submit listener would have removed both the canary and the gate, the one that refuses to send an unmarked submission as a real lead. The wait keeps both, and it is a helper the a11y audit can reuse.

**The proof.** The existing fixture server in `tests/audits/form-e2e-live-runner.test.ts` gained a hydrating page. Its script compares the form's children against the server-rendered set when it "hydrates" and re-mounts on any foreign node, logging Svelte's `hydration_mismatch` URL. Four fixture runs:

- **Control.** The old probe (`hydrationTimeoutMs: 0`) on the hydrating page reports `refilled` and `hydrationUnconfirmed`. The instrument can still see a wipe.
- **No marker.** The fixed probe on the same page does not report `refilled`.
- **Slow marker.** A marked page that hydrates at 2.5 s: the run passes in under 20 s against a 30 s cap, so the marker path, not the settle, released it.
- **Real re-render.** A marked page that re-renders 400 ms after hydration still reports `refilled`, without `hydrationUnconfirmed`.

Ten mutations, each run against the three form-e2e test files, all went red (table in the PR).

**Beliefs corrected on contact.**

- **M1, "remove the wait", first went "red" without a test failing.** Replacing the call with the literal `"settled"` made `hydration !== "marker"` a TS2367 error in the build step vitest runs first. The mutation script read exit 1 and reported red with no test named. Re-run as a type-valid mutation, it turned three named tests red. A mutation whose "red" names no test is the same hollow green as a gate that has never passed.
- **M7, "the load wait takes the whole budget", survived the first table.** The fake page's `waitForLoadState` resolved instantly, so the budget assertion `≤ 5000` could not tell 5000 from 4700. The fake now spends 300 ms, and the assertion is `≤ 4750`.
- **The control was itself racy (review round 1).** With a fixed 700 ms hydration delay, a starved runner that took longer than that to reach the injection would hydrate first and see no foreign node. The control would then go red, and because `fleet-form-e2e.yml` runs this file as its positive control, it would skip the whole nightly sweep. The fixture now defers hydration to 400 ms after the last pre-hydration `input` event. That is a deliberate worst case, not a model of Svelte's timing.

**Cost.** Every unmarked fixture run now pays the 5 s settle, about 70 s across the file, inside the control step's 10-minute limit. Each audited site pays about 5 s a night.

**Review.** Two rounds. Round 1 found three minors (above, plus the slow-marker test passing on the settle), all fixed. Round 2 found no blockers or majors, and its two nits were fixed. One minor that was already there before this change stays as it is: the "testMode marker missing at submit" warn line shows neither `refilled` nor the new flag. It always omitted `refilled`.

**Next, unranked:** the a11y audit has the same race (`src/audits/a11y.ts` scans after `page.goto(path)` without waiting for `html[data-hydrated]`), recorded under #948/#947 in the backlog's Watching entry. Its spec is generated text, so it shares `HYDRATED_EXPR` and `HYDRATION_TIMEOUT_MS` by emitting them, not by importing the helper.

Also renumbered five `form-e2e.ts` citations in `docs/runbooks/turnstile-widgets.md` that the inserted lines had shifted. `tests/docs/runbook-anchors.test.ts` caught all four that had drifted off their anchors.
