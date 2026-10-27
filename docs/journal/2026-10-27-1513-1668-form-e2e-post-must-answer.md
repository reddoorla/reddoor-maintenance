# 2026-10-27 — #1668: the form test passes only when its POST answered

Landed in reddoorla/reddoor-maintenance as this entry's PR (branch `claude/1668-form-e2e-post-2xx`). The operator's answer: workspace `decisions/2026-10-27-1352-1668-form-e2e-late-failure-and-no-post.md`, (a) fix both.

**Why.** Once the `role="status"` region showed, the runner raced the marker POST against a 2 s settle and passed if the timer won. That let two broken forms read green. In the first, the region shows first ("Sending…") and the POST answers 500 at 2.5 s. In the second, a client-side error is written into the region and nothing is posted, which is what a Turnstile that issues no token looks like. Both now fail. A pass needs the marker POST (same-site, carrying `testMode`) to answer below 400 with no SvelteKit failure body, however late, up to the existing 30 s submit cap. A native form's 303 stays a pass, as a test already pinned, so the rule is "below 400", not the brief's literal "2xx".

**Verified first.** At `origin/main` (`333d556a`), new fixtures for both inputs reported `success: true`, as the brief predicted. The control, the region first and a 200 at 2.5 s, passed. After the fix, the failure lines name the cause:

- "…the submission failed — POST 500 …; it answered after the status showed"
- "…but no POST was sent — …"
- "…but its POST never answered — the POST was sent but got no answer"

**The fleet, before the verdict changed.** The run log cannot show a pass's POST: a pass prints only "synthetic submission succeeded". So the proof is two dry runs of this branch's runner, with no write-back, against the 13 sites the 10-27 12:04am PT nightly probed. A Playwright hook logged every POST.

- First run, 7:09 to 7:22am PT: 13 of 13 passed, each with its same-site marker POST answering 200. The paths were `/contact`, `/contact-us`, `/api/forms`, `/api/contact`, and `/` on 1836dig.
- Second run, 7:39 to 7:47am PT, on the review-narrowed matcher: 13 of 13 passed again, with the same POSTs.
- No site posts anywhere the probe does not watch, so the stop condition did not fire.
- Revogen took 287 s in the first run because its first load found no form and #1737's retry ran. That predates this change, and the second run took 36 s.

**Review.** The 3-lens review (Opus) took two rounds; round 1 was dirty with three majors.

- **Lens 1: a bodyless POST counted as the action.** `carriesProbeMarker(null)` was true for any POST, so a same-site keepalive with no body could stand in for the action while the captcha error showed. An unreadable body now counts only when the request is multipart, which keeps the file-upload forms.
- **Lens 3: a false detail line.** A marked POST to another host was reported as "no POST was sent". The detail now names the host it went to, counting only POSTs after the click.
- **Lens 2: the #1669 sidecar broke.** Its mutation sidecar no longer passed `--check`: `1669-A9-settle-4500` mutated a constant that is gone (its guard is now M1), and two marker mutants' find strings had moved. A9 was removed and the two were re-pointed.
- **Round 2 was clean on all three lenses.** Minors that needed no new test were folded in; the rest are #1817 to #1820 (a 307/308 judged by the redirect, the "after" wording, three test gaps, the remaining multipart hole).

**Test changes.**

- "a POST still pending when the settle ends passes, without waiting for it" pinned the 2 s settle. It now asserts the 10 s POST is waited for and passes, taking between 10 and 20 s.
- The timing test "arms the post-settle window at 2000 ms" now asserts no 2000 ms timer.
- The unit test `carriesProbeMarker(null)` is now false unless the request is multipart (the round-1 finding above).

**Mutations.** Six named; all six red at the final commit, and the #1669 sidecar's nine are all red at the final commit too.

**Corrected on contact.** The brief expected the nightly log to show each site's POST. It shows only a pass or the failure detail. The dry run was the only instrument, and it took a hook on `chromium.launch` to see the POSTs at all.

**Cost.** Each probe can now wait up to about 28 s longer after the region shows, but only on a site whose POST is slow or never answers. On today's 13 sites, nothing waited.

Usage: $10.53, 312/107544 tokens, 24409004/556803 cache, rate limit allowed_warning (seven_day)
