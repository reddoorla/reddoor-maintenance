## 2026-10-11 — Hedloc's Executive Team row is 4 wide at lg; Shankar's entry is the operator's (hedloc#55, `2641a0e`)

> Superseded in part by 2026-10-11 — Shankar Annamalai is staged in a hedloc Prismic release, not entered by hand.

P1-40, from Erik in #hedloc-web on 10-09: "build a 4th slot into this Executive Team line up … slide these three to the left, and have 4-wide". Shankar Annamalai is fourth, and the ask was dated for the week of 12–16 Oct. The layout landed in hedloc#55 after three review rounds and two operator answers (Operator decisions 104). The content did not land. The Prismic MCP still answered "not activated for repository hedloc" at 14:20Z, so Shankar's entry went to the operator as a download card (name, title "Advisor" from the .docx, the 1125×1500 headshot, five plain paragraphs), and Erik's reply waits in the PR body.

**The design.** The row was already four columns wide. Its first column was an empty `lg:w-1/4` that existed only to hold the selected member's headshot while a bio was open, so three members filled columns two to four.

- That column is now an absolutely placed slot over column one, exactly one column wide: `calc((100% - 7.5rem) / 4)`, the width the old spacer reached by flex-shrinking.
- The brief expected the `lg:w-2/3` bio panel to need reworking. It did not: the open view is unchanged.
- Measured on the deploy preview, today's three members keep their 301px (1440) and 206px (1024) columns and slide one column left: x 399/740/1081 → 58/399/740 at 1440.

**What only the real content showed.** Shankar's name, headshot and bio were staged in a throwaway worktree and never committed: hedloc is a public repo and he is not published. That found two defects the fixture-only tests would not have.

- **His bio overflowed the section.** It is 1,867 characters in five paragraphs, against Jack Harper's 1,111. At 21px/35px type the fixed `lg:h-[640px]` box would have painted it 231px (1440) and 511px (1024) past the section's padding, onto the footer.
- **Jack's bio already overran on live.** On the live site at 1024 it ends at 1325 against a box bottom of 1268, hidden only because the 96px bottom padding is the same gold.
- **The fix for both:** the row and the bio overlay now share one grid cell with `lg:min-h-[640px]`, so an open bio grows the section.
- **His name centred when it wrapped.** It is the first to wrap in a 206px column, and buttons centre text by default, so "ANNAMALAI" sat 34px in under a left-aligned title.

**The overlap cost three rounds.** Putting the selected card over column one means the card and member one take turns on the same pixels, and each review round found a click bug on that seam:

- Round 1 found two:
  - A double-click on member one opened its bio, and the second click closed it on the fading-in card.
  - For the 150ms fade after Close, the card's empty container swallowed clicks on member one.
- Round 2 found that round 1's fix (the container stops taking pointer events) let a double-click on the open card fall through and open Jack's bio.
- The final shape: an `event.detail > 1` guard on the card and on the member buttons, so no double-click chains into a second action. Keyboard activation has detail 0 and is unaffected.

Round 3 found no behaviour defect, and checked mouse, keyboard and touch at lg, 768 and 390.

**The tests were wrong in instructive ways.**

- **Opacity and covering.** `toBeVisible` and `boundingBox` ignore opacity and anything painted on top, so for two rounds an overlay stuck at opacity 0 or 1, a panel moved out of the shared cell, and a panel with no background all passed.
- **Background alpha.** Round 3 then found the background check parsed alpha only from `rgba()`, while Tailwind v4's `bg-x/0` computes to `oklab(… / 0)`. It now paints the computed colour into a 1px canvas and reads the alpha back.
- **The 150ms dead zone.** Playwright's actionability wait hides it, so that test hit-tests inside one `page.evaluate` during the fade. The first version only caught its mutant 26 times in 30 at 8 workers.
- **Scrolling on phone.** `scrollIntoView({ behavior: "smooth" })` ignores `reducedMotion`, so two separate box reads on phone disagree mid-scroll.

Nineteen mutations are tabled in hedloc#55. One, `lg:h-full` on the slot, became equivalent once the slot stopped taking pointer events.

**Beliefs corrected on contact.**

- **The brief's verify line.** It listed "Ben Friedman, Dan Hord, Jack Harper", but that was `sort -u` output. The page's order is Jack, Dan, Ben, which Erik's screenshot shows.
- **Prerendering.** `/executive-team` is prerendered (Netlify lists `executive-team.html` as a generated page), so a Prismic publish shows nothing until a Netlify build. No Prismic → Netlify build hook could be confirmed. Round 1's production lens caught this, and the handoff now says to trigger a deploy and check the live page before replying to Erik.
- **The fixture's member name.** The fixture's 4th member was first called "Member Four Annamalai". Fixture code ships in the public `_app/immutable` bundle (behind the `/dev` 404), so it is now a placeholder.

**Process notes.**

- The PR screenshots sat in one commit on the hedloc branch, `8320dce`, and were removed before the squash. The body links them by SHA. Only placeholder fixture members and the three already-public members are in them; the screenshots with Shankar went to the operator only.
- #1283, the Operator decisions line, first failed CI. Another session's #1282 took items 102 and 103 while it was open, and the merged list's duplicate 102 failed prettier. That was confirmed by running prettier on the merge, and fixed by renumbering to 104. A line opened as "next number" can collide in the minutes before it lands.
- Stopping a stuck `land-prs` with `pkill -f "land-prs.mjs 1283"` also matched the shell running the pkill and killed it; `land-prs` itself stopped too. Use a process ID next time.

**Live at 17:23:10Z.** The merge deployed and was measured on https://hedloc.netlify.app/executive-team:

- The three members sit at x 58/399/740 (1440) and 41/286/532 (1024), at widths 301 and 206.
- Every bio opens and closes, and Jack's at 1024 grows the section by 57px.
- `/dev/executive-team` returns 404.

**Still open, all the operator's:**

1. Enter Shankar on the `about` document.
2. Run a Netlify build.
3. Check https://hedloc.netlify.app/executive-team.
4. Post Erik's reply from hedloc#55.

Until then the live row shows three members, left-aligned, with the fourth slot empty: the layout Erik asked for, short of Shankar.
