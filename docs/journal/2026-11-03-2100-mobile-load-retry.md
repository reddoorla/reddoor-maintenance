# 2026-11-03 — A mobile load that throws gets one fresh try

Landed as reddoorla/reddoor-maintenance#1904. Part of the operator's 11-03 ask, "get the overview clean in the dashboard".

**Why.** Reddoor read Broken on 11-03 for "pages fail to render on mobile". The nightly's own line (fleet-lighthouse run 41589065526) names one route and one device: `https://reddoorla.com/brand-friction-audit [Pixel 7] (load failed)`, meaning the navigation threw. In the same run, iPhone 14 (also Chromium), the three desktop engines and the plain-fetch re-check all loaded that route. `reddoor-website` `main` had not changed since 11-01.

**Measured.** `probeMobile` itself, run live at 390 (iPhone 14) and 412 (Pixel 7) at about 11:30am PT: Reddoor passed 30 of 30 checks over its 15 routes. As a control for the probe I ran CalTex the same way: its live `main` failed 7 of 10 checks on real overflow (the `/community` h1 "Grants & Community" is 422px wide), and its `staging` passed 10 of 10. The probe can tell a fitting page from an overflowing one. Its fault was turning one network hiccup into a critical Broken. The container hit the same kind of hiccup itself: one `curl` of that route died after 30 s with a TLS error, and the next three answered in 0.2 to 0.6 s.

**The fix,** and what review changed in it. A thrown navigation now gets one retry in a fresh context. Every fail on a page that loaded still stands. That rule matters because CalTex's overflow on `/` is intermittent: it overflowed on one of my two runs, so retrying an overflow would hide it. The first mutation table had that mutant (m3) expected to "survive", on my own wrong belief that the retry was harmless. It survived, and a `/wide-once` test now pins it.

Round 1 caught the cost. A retry at the full 30 s added up to 15 minutes for a site whose routes all hang. fleet-lighthouse's step has 75 minutes and already takes about 48, and if it is killed it writes nothing back. The retry is capped at 10 s, which bounds that to 5 minutes. Round 1 also had me put context creation inside the try, so that a crash would not throw. Round 2 showed that was the wrong way round: it turned a crashed browser into "load failed" on every route, the very false Broken this PR removes. It was reverted, and a test now pins that a crash throws. Round 3 was minors only. Its fold-in pinned the 30 s first try, because a swap of the two caps kept the total and passed.

**Not done here.** Desktop engines can throw the same way (no retry), a retried pass leaves no trace in the result, and "load failed" does not record the error class. All three are noted on the PR and left for a later change.

**Mutations.** 8 of 8 red (`tests/audits/mobile-load-retry.mutations.json`).
