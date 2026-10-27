## 2026-10-27 (about 6:50am PT) — P1-33 next-4(1): the anti-tampering sentence joins the worker rules

Landed in this PR. Decision: `decisions/2026-10-27-1342-p1-33-sentence-and-monday-ledger.md` in the workspace, answered (A1), approve as written.

**Why.** `land-prs` already lists a PR's changed test assertions (#1629's half (2), landed 10-21), but only after the fact. The sentence tells a worker before it touches one: say so with AskUserQuestion when a test looks wrong, never hard-code cases or edit, skip or weaken an assertion to go green, and name any assertion the brief's Done-when legitimately moves under Test changes. It sits at the end of the "mutations are named before the code" bullet, because both rules are about tests being evidence rather than decoration. The same sentence is in the workspace `worker-brief.md` Stop conditions since `2c9ff79`.

**What was checked.** `grep -n 'hard-code test cases' CLAUDE.md` printed nothing on `origin/main` (`333d556`) before the edit. The sentence went in word for word; the only change of shape is that its full stop now follows the citation `(the operator, 2026-10-27)`, as the file's other citations do, which made my first verbatim check (searching for the sentence with its stop) fail on the instrument, not the text. The six `tests/docs` files pass (47 tests); none caps the bullet's length. Prettier is clean.

**Mutations:** none named; it is a docs line.

Usage: not readable (get_session at 6:52am PT returned no `external_metadata.usage`), rate limit allowed_warning (seven_day).
