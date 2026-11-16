# 2026-11-16 — P1-87 PR 1, How this works: review rounds 5 and 6

Landed on: `claude/p1-87-how-this-works` (reddoorla/reddoor-maintenance#2053), as `4a9de752` (round 5) and `84744dab`/`fb62e9c1` (round 6).

Round 5 was the PR's fifth dirty round, and its fix changed what the page says, so the narrow unasked sixth round did not apply: it went to the operator (workspace `decisions/2026-11-16-2030-p1-87-pr1-round-5-dirty.md`), who answered at about 12:37pm PT, "6th round, land if clean". Round 5's real defect was one false sentence: "a fix for a known critical or high vulnerability opens the same night" is untrue for a package one deeper in the tree, which waits for the weekly lock-file run. Its tests lens found the model was compared only with its own output; the pins now read literals from the fixture ("11:07pm PT", "10 over the last night"). The chapter headings asked for Besley at 700, which the cockpit never loads, so the browser faked the bold; they are 400 now.

Round 6, on the round-5 fix alone, was dirty too, and it came back to the operator as his answer said (`decisions/2026-11-16-2131-p1-87-pr1-round-6-dirty.md`). The defect is worth remembering: round 5 hid the " · " separators from screen readers with `aria-hidden`, and the hidden span held the only space, so a screen reader heard "1Backup". Svelte also trims leading and trailing spaces inside an element's text, so the fix writes the space as an expression, `{" "}`, outside the hidden span. A test now drops every `aria-hidden` node and reads "1 Backup". Three CSS rules from round 5 had no test that a deletion turned red; each is pinned in the browser test now. Broken's bar went from 6px to 8px because in dark mode its red (3.28:1) still read weaker than Attention's ink (15.2:1), and 2px of thickness did not outweigh that; its padding gives back the 4px so its word sits level.

The fixes ran on Haiku from written briefs; both signed their commits with a Haiku trailer despite the brief's exact line, and the trailers were rewritten before the push. The three deferred minors from rounds 1 to 4 are filed as reddoorla/reddoor-maintenance#2056, #2057 and #2058.

Mutants: 56 of 56 red at `fb62e9c1` (`node scripts/mutate.mjs cockpit/tests/how/how.mutations.json`).

## Round 7 (added 11-16 about 2:15pm PT)

The operator asked for a seventh round on the round-6 fix alone. Correctness and accessibility were clean; a real-browser probe in light, dark and forced colours found the screen reader now hears "1 Backup". The tests lens found gaps only (Broken's bar checked in light mode alone, each breakpoint at one width, the hairline's colour unchecked), pinned at `6468ab18` with mutants 57 to 61 (61 of 61 red) and no page change. He answered "land on CI green" (workspace `decisions/2026-11-16-2211-p1-87-pr1-round-7-dirty.md`).
