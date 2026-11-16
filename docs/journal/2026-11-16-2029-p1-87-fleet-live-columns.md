# 2026-11-16 — P1-87 PR 2: the overview's live columns move to Sites

Landed in: reddoorla/reddoor-maintenance PR "the overview's live columns move to Sites (P1-87, PR 2)".

The signed-off list (home base `plans/2026-11-16-p1-87-overview-reorg/plan.md`, item 2) takes "Is every site live?" off the overview and puts its columns in the Sites table. This PR does the second half: `/fleet` gains Live, Certificate, Deploy and Forms after Status, in the overview's order, then Level. PR 3 removes the overview's table, so for one PR both pages show the same cells. They come from one function (`siteFacts`, factored out of the overview's `liveRows`), so they cannot disagree.

Level sorts by severity, worst first (Broken, Attention, Watch, OK, Launching, then a site with no level). The rank lives in `fleet-table.ts` as `LEVEL_RANK`; the route's load passes each site's tier in. The pill left the Health cell for the Level column, so a row names its level once.

Measured on a render of the live snapshot (read 11-16 about 12:16pm PT) at 1280px: the table was 1,386px wide in its 1,100px column before and is 2,014px after; rows stay 128 to 159px tall. The height comes from the Health cell. Its metrics cluster (`inline-flex`, wrapping inside a 16rem cell) is 92px of each row. The new cells wrap at 11rem, so they add width but no height.

P1-112, `/fleet` density, is not cleared here. With sixteen columns, one-line rows at 1280px need choices that are the operator's: which columns merge or leave, whether the URL shortens to its host, whether Health's detail folds away. The brief allowed this: "if the density work is not small, land the columns alone".

Belief corrected: the brief's mutant "sort Level alphabetically" needed a fixture where the alphabetical order of the level words differs from severity. It does by default: attention sorts before broken.

Usage: recorded in the session's closing workspace entry.
