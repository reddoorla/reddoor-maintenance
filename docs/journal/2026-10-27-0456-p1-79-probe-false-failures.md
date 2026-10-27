# 2026-10-26 — P1-79: the form test and smoke check stop false-failing

Landed in reddoorla/reddoor-maintenance as #1788 (#1736), #1789 (#1777) and #1804 (#1737, replacing #1794); this entry is its own docs PR. Brief: workspace `briefs/2026-10-26-p1-79-probe-false-failures.md`.

**Why.** P1-78c cannot wire alarms on `form_e2e_ok` or `smoke_ok` while a fail can mean a working site. Three instrument faults made it so: Sonder's form test failed 14 nights running, Vida's 3 nights in 14, and 7 sites failed smoke every night.

**#1777, smoke.** gallerysonder's `slice-simulator.spec` skips its "the built client" block only when `!built && !process.env.CI`. Actions sets `CI`, and fleet-smoke never built, so both tests in that block failed: the issue's "2 failed". Measured on gallerysonder in the container:

- the spec alone with `CI=true` failed 2;
- after `pnpm build` (12 s, 4 cores, exit 0) it passed 8 of 8;
- `smokeAudit` end to end on a clean tree passed (`smoke: suite green`) in 153 s, against unfixed `main`'s nightly line in 138 s.

The audit now builds before the suite, only under `CI`. A build that fails reads NOT MEASURED, never fail.

**#1736, Sonder's form.** A full-screen `role="dialog"` "Cookie consent" mounts 3 s after load and intercepts the submit click. A Playwright locator handler now answers it, Reject first. Live against gallerysonder.com, unfixed `main` gave the nightly `locator.click: Timeout 30000ms exceeded`, and the branch gave `pass — answered a cookie-consent dialog with "REJECT"` (12 s, then 14 s after round 1).

**#1737, Vida's form.** The 2-minute stall is four `page.fill` calls with no timeout of their own, each waiting out Playwright's 30 s default. The rest is still open. The probe now retries once when it refused to click and the page made no same-site POST, and its detail names what it saw. Live against vidalegacy.org: pass, 9 s, no retry needed.

**Defects found on contact, which the fixtures had not shown.**

- **The handler fired twice on the real site.** Svelte keeps an outroing gate in the DOM, `inert`, for its fade, so the gate still matched. The second click hit a `<path>` in `<main>`. Found by instrumenting the handler against the live page, after two read-only probes (no handler, then a scroll to the form) showed the button clickable.
- **A handler's throw is not the action's error.** It escaped as an unhandled rejection and crashed the whole run.
- **The consent answer can land after the marker check.** Sonder's gate does arrive during the submit click (round-1 review). A gate that reloads the page on its answer would then submit a fresh, unmarked form, which is a real lead. The fix is structural, not timing: the marker's capturing `submit` listener is now an init script, so every document the page loads carries it.

**Tried and abandoned.**

- **For #1737's cause.** I aborted `BrandIcon….css`, the issue's one bad load, and then a JS node, live and read-only. The server-rendered form stayed both times. `/` has no form, so the fallback route would read n/a, not this warn.
- **A trial-click design for #1736.** It answered any gate before the marker check and then removed the handler. I dropped it, because gallerysonder's gate arrives after the settle, so removing the handler would have re-broken Sonder.

**Beliefs corrected on contact.**

- **"Form gone" does not explain Vida.** A form simply gone would make the wipe check refill and double the stall to 4 minutes. A 2-minute "marker missing" fits the two marker `page.evaluate` checks throwing, and both swallowed their errors. That is inference; the new detail will say on the next bad night.
- **A `rm -rf` and a `git stash` are both denied here.** I moved build output aside with `mv`, and ran controls from the untouched main checkout instead.
- **A symlinked `node_modules` makes `pnpm` abort before typecheck or prettier runs, and the output can read as clean.** I caught it only because lint then disagreed.

**Honest accounting.**

- **The first CI run of #1788 went red on `tests/docs/runbook-anchors.test.ts`.** `docs/runbooks/turnstile-widgets.md` cites `form-e2e.ts` by line number. I had run only the changed tests before pushing; from then on, the full suite ran before every push.
- **#1794 was closed unmerged.** Its loop re-indented every line #1736 touched, so the change was re-applied after #1788 as #1804.
- **Unmeasured here.** Only Sonder was run of the seven smoke sites. The per-attempt Turnstile resets in #1804 have no test that a mutation turns red.

**Review.** #1788, #1789 and #1804 were each dirty in round 1 and clean, minors only, in round 2. The minors are filed as #1800, #1801 and #1803.

**Tonight's nightly** (on `35f5707c`, with all three fixes):

- **fleet-smoke run 40462524681 (11:41pm PT): all 17 sites `pass`.** That includes the seven that failed every night: CalTex, Data Dynamiq, ERP Industrials, MSOT, Revogen, Sonder and Vineyard. `FLEET_SMOKE_UNMEASURED count=0`, `FLEET_WRITE_SUMMARY wrote=17 failed=0`.
- **The build's cost is measured.** The smoke step took 23m08s, against 21m24s the night before (run 40281379353): 1m44s for 17 builds.
- **fleet-form-e2e run 40464944042 (12:07am PT): 13 probed, all `pass`.** 29-navy, caltex and the two Williamson sites skip as before.
- **Sonder:** "answered a cookie-consent dialog with "REJECT"", its first pass since 2026-10-12.
- **Vida:** passed in 4 s with no retry. So the night says nothing yet about the retry, or about the cause of #1737's stalls. Its summary also carries the old "fields were wiped by a client re-render and re-filled once (hydration unconfirmed …)" note, which this work did not touch.
