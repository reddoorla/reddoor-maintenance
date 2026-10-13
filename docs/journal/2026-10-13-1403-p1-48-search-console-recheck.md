## 2026-10-13 — P1-48: a nightly re-check retires a stale Search Console `no-property` watch (issue #1336)

The cockpit has shown "LA Homelessness Initiative · Search Console: no property matched www.lahomelessnessawareness.org (lookup 2026-10-05)" under Watch every day since 10-05. I ran `pm-cockpit.mts` at 13:48Z and it still listed that line, as the only Watch item. The line is false: as `tucker@` the property is `siteOwner`, and as `reports@` it is `siteFullUser`. Espada, the control, shows the same pair. Through the production code, `fetchSearchPresence` resolved `https://www.lahomelessnessawareness.org/` at position 69, and a host that cannot have a property read `propertyFound: false` [M, 2026-10-13 ~13:50Z, GA service account under domain-wide delegation].

**Why it stayed stale.** Only two things wrote the #943 lookup: a report draft, and an operator pressing "refresh preview" (`report --rerender`, P1-36, 10-08). The brief said a draft was the only writer, and it missed the second. The second needs a human, though, so the gap the brief described was real. Nothing ran on a schedule, and LAHI has no report due before 11-30.

**What landed.** A new command, `search-console-recheck --fleet --write-back`, run as a step in `fleet-lighthouse`. It selects `maintained` sites whose stored outcome is `no-property`, which is the same pair the cockpit's watch condition uses. For each, it re-runs `fetchSearch`, the draft's own lookup, and writes the cells through `searchConsoleLookupFields`, the draft's own builder. A pinned `searchConsoleProperty` is honoured exactly as a draft honours it.

**Why `fleet-lighthouse`.** It is a no-checkout sweep that already writes per-site evidence to `site_health` in sibling steps (`github-signals`, `roster-urls`). It is also dispatched before `daily-reports mode=draft` in the conductor, so the digest reads the night's answer. `fleet-security` needs a clone per site, and this needs none. The step needed the GA secrets, which until now only `daily-reports` carried. They are existing repository secrets with the same `webmasters.readonly` scope, so neither the secret nor the scope is new. A build test pins that this is the only `fleet-lighthouse` step that sees the key.

**One deliberate departure from the brief.** The brief said the re-check writes the same three cells a draft writes, and that a soft-fail stays `soft-fail`. A draft writes `soft-fail` when the API errors. Done nightly, that is a trap. One transient error on a site that truly has no property would replace `no-property` with `soft-fail`, and a stored soft-fail raises no watch. The site would also leave the re-check's own target set, so nothing would raise the watch again until its next draft. The re-check therefore writes nothing on a soft-fail, and the stored `no-property` stands until a later night answers. The operator is asked whether to keep this as Operator decisions 121.

**Proving the instrument.** A no-property control runs through the same `fetchSearch` path before any target, against `https://no-such-property-zz9q.invalid/`. If it reads anything but `no-property`, the run writes nothing and exits 1. Before landing, I ran the whole command on the live Turso roster with the real lookup and a mirror that only recorded. The control read `no-property`, LAHI was the only target, and it read `resolved` against `https://www.lahomelessnessawareness.org/`. Nothing was written, deliberately: the brief makes the next scheduled nightly the proof.

**Mutations.** Each one was run against `tests/cli/search-console-recheck-command.test.ts`, and each turned it red:

| Mutation                                         | Red tests |
| ------------------------------------------------ | --------- |
| 1. A soft-fail writes `resolved`                 | 1         |
| 2. The target filter skips `no-property` sites   | 12        |
| 3. Checked At keeps the old stamp                | 3         |
| 4. A site with no property is written `resolved` | 2         |
| 5. The control's verdict is ignored              | 2         |

**Review.** One round with two lenses, correctness and ops/security, returned minors and nits only, so it counts as clean. The minors are filed as #1339 (no alarm if the nightly step quietly stops writing), #1340 (the control prints a "verify the domain property exists" warning every night) and #1341 (no test runs the control through the real `fetchSearch`).

**Still open.** The next nightly should clear LAHI's Watch line. That result goes in a later entry.
