# 2026-11-03 — Transitive-only vulns are Watch, not Attention

Landed as reddoorla/reddoor-maintenance#1899. Part of the operator's 11-03 ask, "can we try and get the overview clean in the dashboard?".

**Why.** On 10-29 the operator ruled "transitives should be watch not attention" (workspace `decisions/2026-10-29-1518-pm-cockpit-operator-answers.md`, item 4). The decision file recorded that `pm-cockpit.mts` still tiered them at Attention and that the PM pass was moving them to Watch by hand. Five days later the code still did it: `levelOf` returned `attention` for every `vuln` item. One branch in the ladder now reads `transitiveOnly`. Because every reader takes its level from `levelOf` or `withLevels` (the cockpit, the Needs-you feed, `pm-cockpit.mts`, the digest), nothing else needed a rule of its own.

**Measured.** `pm-cockpit.mts` live, before (cockpit, 10:47am PT): `broken=2 attention=7 watch=9`. After, on the branch (11:24am PT): `broken=2 attention=2 watch=14`. 29 Navy, Espada, LA Homelessness Initiative, LA Homelessness Youth and Vida Legacy moved to Watch, each still named with its "still present after the … lockfile window" line. Data Dynamiq stayed at Attention for its TLS and Renovate items.

**Moved, not hidden.** The wait in `markWaiting` is unchanged. A transitive vuln leaves the email because Watch never reaches it (P1-78d), but the digest snapshot keeps its key and first sighting, and a test now asserts that. Mutation t3 (past its window it keeps waiting, so it disappears) goes red.

**Review.** Round 1 found one major: the overview's upkeep line still told the operator a transitive vuln past its window was "ours to fix this week", the words of Attention, beside a card that said Watch. Nothing caught it, because the SSR tests pinned only the direct-vuln copy. Round 2 was minors only, so it was clean. Its three wording minors were folded in: the past-window line no longer promises that a refresh will clear it, and the Reports "Security Updates" proof now matches the glossary. Filed: reddoorla/reddoor-maintenance#1906 (pm-cockpit prints "escalated" for an item that never rose above Watch) and reddoorla/reddoor-maintenance#1907 (n=1 copy not pinned).

**Open for the operator.** A transitive vuln now has no road back to Attention. It is never "exhausted", and it has no age ceiling like Renovate's 7 days. One that no lockfile refresh can fix (an upstream pin) would sit at Watch indefinitely. Whether 10-29's rule wants a ceiling is his call, and it is asked in the session's final message.

**Mutations.** 5 of 5 red (`tests/dashboard/transitive-watch.mutations.json`): transitive back at Attention, a direct vuln at Watch, the transitive item hidden, the collector dropping the flag, and a mixed advisory read as transitive-only.
