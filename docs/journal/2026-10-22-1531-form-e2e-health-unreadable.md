# 2026-10-22 — an unreadable /health is no longer called "undeclared" in form-e2e (P1-68)

Landed in this PR. One worker session, queued by the PM cockpit on the operator's word, started about 8:10am PT.

**The finding.** fleet-form-e2e run 39738007559 (07:04Z) printed `FLEET_FORM_E2E_UNCOVERED sites=29-navy,caltex,vineyard-custom-homes`; the 10-21 run (39559173265, the control) printed `29-navy,caltex` and `pass vineyard-custom-homes`. The brief's two candidates were a change in Vineyard's declaration (SvelteKit 3 landed there 10-20) and #1670. Neither was the cause. #1670 did not touch `readFormsHealth`. Vineyard's `src/routes/health/+server.ts` hardcodes `testMode: true`, and the last commit before the run, `b3e0af5` (02:12Z), is still the head; its `/health` served `testMode:true` at 15:13Z. So any `/health` that answered at all would have declared. The evidence for a failed read is the timing: the site's audit ran from 07:13:44.4905Z to 07:13:54.4900Z, 9.9995 s, against the 10 s `HEALTH_TIMEOUT_MS`. The other two skipped sites took 1 s and 2 s. Five timed reads at 15:13Z took 0.34 to 1.23 s, so the slow answer was transient, most likely a cold function plus its 5 s Prismic probe.

**Why it hid.** `readFormsHealth` is fail-closed, which is right: no read, no submit. But it returned the same `{testMode:false}` for a timeout, a non-2xx, a body that is not JSON, and a body that declares nothing. The audit then printed "does not declare forms.testMode … not yet rolled out here", and the workflow counted it among the undeclared. One slow answer cost a night of coverage under a reason that sent the reader to the site repo.

**The fix.** An unreadable `/health` is read once more, and if it is still unreadable the refusal names the reason (`timed out after 10s`, `HTTP 503`, `body is not JSON`, the network error). The submit is refused exactly as before. A readable body that declares nothing is final on the first read. The workflow prints `unreadable=N`, warns with `site (reason)`, and still lists the site as uncovered. Against live hosts at 15:31Z the new reader gave Vineyard `testMode:true` on both apex and www, and gave an unrelated parked domain `unreadable: "HTTP 503"`: the negative control.

**Mutations, as the brief named them.** Run against the final tests: reverting the reader's reasons turned 9 tests red; removing only the retry turned 4 red; dropping `testMode` from the Vineyard-shaped fixture turned 2 red; leaving unreadable sites off the `UNCOVERED` line turned 2 red.

**Review.** One round on the session model. It found nothing above minor and confirmed the safety property: a submit still needs a read that parsed `testMode === true`. Five minors were folded in:

- undici reports every network error as "fetch failed", so the reason now takes `cause.code` (e.g. `ECONNREFUSED`);
- a reason is collapsed to one line, because the workflow's awk reads it back out of the printed summary;
- two comments that still said "undeclared" now cover the unreadable case;
- three test gaps are closed: a JSON body that is not an object, an unreadable read followed by an undeclared one, and the live runner reading `/health` twice.

The reviewer asked whether some site has no `/health` and would move from "undeclared" to "unreadable". It does not happen today. Through the new reader, Turso's URLs for 29-navy (`https://29navy.com`) and caltex (`https://www.caltexmedical.com`) both read as readable but undeclared, so their classification is unchanged. Filed #1698: on the unreadable path, the skip still clears a declared site's Turnstile widget verdict to null. That behaviour predates this PR.

The full suite caught three stale `form-e2e.ts` citations in `docs/runbooks/turnstile-widgets.md`, through `tests/docs/runbook-anchors.test.ts`. They are renumbered, along with a fourth (the preflight) that was already off by one on `main`.

**Not done here.** Vineyard being probed again is for tonight's dispatch to show. The fix does not make a slow `/health` fast; if Vineyard keeps timing out, the run now says so by name.
