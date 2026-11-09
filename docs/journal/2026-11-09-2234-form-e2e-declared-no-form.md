# 2026-11-09 — A site with no form declares `forms.none` and earns n/a, not UNCOVERED (reddoorla/reddoor-maintenance#1983)

**Why.** Every nightly from 10-26 to 11-09 printed `FLEET_FORM_E2E_UNCOVERED sites=29-navy,caltex`. Neither site has a form. 29 Navy deleted `/contact` in reddoorla/29-navy#32, and on 11-09 that URL answered 404 while `/` had no `<form>`. CalTex has no `<form>` anywhere in `src/`, and its live `/` and `/contact` render none. The runner refuses on `forms.testMode` before it looks for a form, so the n/a branch could not be reached from either site. 29 Navy said `testMode: false` on purpose, and CalTex had no key at all. The Williamson sites reach n/a only because they declare `testMode: true`. So UNCOVERED could not tell "nothing to cover" from "should be covered and is not".

**What.** `/health` can declare `forms.none: true`, and only a strict `true` counts. The runner then opens `/contact` and `/` without the marker guard, a fill or a click:

- no contact form on either page → n/a, with `turnstileWidget: null`;
- a contact form found → the undeclared summary, with the URL appended;
- a look that could not complete (a launch failure, a non-2xx page, a 404 on `/`, a timeout) → the undeclared summary, with `unverified` and the reason.

Both outcomes that are not n/a start with the counted phrase, so the workflow's counters stay unchanged and the site stays on UNCOVERED. A `/contact` at 404 or 410 counts as gone. A 404 on `/` does not, because every site has a home page, so that 404 means the probe is looking at the wrong deploy. Site PRs: reddoorla/29-navy#119 (merged to `staging` at 2:31pm PT) and reddoorla/caltex-landing#124.

**Measured.** Run against the two site PRs' deploy previews, the branch's probe returned `skip | no contact form (n/a) | {"ok":null,"formPresent":false,"turnstileWidget":null}` for both. Against the live sites, still undeclared, it printed exactly last night's refusal. Twelve named mutations each turned at least one test red, with the unmutated control green:

- ignoring `none`;
- believing the claim without looking;
- a truthy parse;
- dropping the counted prefix;
- a thrown look read as no form;
- a leaked browser;
- skipping `/`;
- a failed load read as a miss;
- the Turnstile verdict on n/a;
- any rendered page counted as a form;
- `/` down skipped;
- a 404 on `/` read as gone.

The positive control's count rises from 66 to 70.

**Defects caught in review**, three rounds with Opus:

- **Round 1.** The first look reused `findFormPath`, which treats a 503 or a timeout as a miss, so a formless site that was down would have earned n/a with a fresh stamp. The n/a branch also scored `turnstile:false` as a fresh Turnstile `fail` for a site that has no form.
- **Round 2.** No test reached the real n/a shape, a 200 home page with no form, and none reached `/contact` 404 with `/` 503. A mutation that counted every rendered page as a form survived the whole suite.
- **Round 3.** Minors only. The two that need a test are in reddoorla/reddoor-maintenance#1991.

CI's `build` failed twice on `tests/docs/runbook-anchors.test.ts`. The cause was the same both times: `docs/runbooks/turnstile-widgets.md` cites `form-e2e.ts` by line number, and this change moved those lines. I re-numbered the citations to the same expressions, and the last commit keeps `form-e2e.ts` at 1822 lines so the citations hold.

**Belief corrected.** A new instrument went red on its first known-bad input (a 503 site) only because a reviewer fed it one. My own tests had covered only the inputs the code already handled: a launch throw and a `newPage` throw.

**Not covered here.** Williamson Construction's live `/join-the-team` form (one `<form>` with an email field) is recorded n/a every night, because the probe looks only at `/contact` and `/`. It is queued as a separate task.

Usage: $13.73, 1413/110974 tokens, 36908577/670122 cache, rate limit allowed (session to this point)
