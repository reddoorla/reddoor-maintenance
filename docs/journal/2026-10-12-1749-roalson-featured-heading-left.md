## 2026-10-12 — Roalson: Featured Properties heads the left column under a full-width photo (roalson-interests#291, `5f04df0`)

Erik asked in #roalson-interests, 15:47–15:59Z, for the right-hand option of his side-by-side. The photo spans the band with no label, "Featured Properties" sits at the top of the site's left column in the style of About Us's "Representing…" heading, and the controls drop to the foot of that column, level with LEARN MORE. The only condition was "unless we have strong push-back from Nicole". Her last message in the channel was from 10-09, about losing the map, so there was nothing to stop on. It was live at https://roalson-interests.netlify.app/ at 17:48Z, about a minute after the merge.

**The brief described "today" wrongly, and the images settled it.** The brief said the left option of Erik's 15:51 side-by-side, a garnet label box over the photo, matched live. It did not. Live (#283, `46c1799`) had the heading in white in a #3d0707 column beside a 928 × 542 card, which is the left option of Erik's earlier 15:47 mockup. Both options of the 15:51 image draw a full-bleed photo, so the change grew from moving a heading to removing the dark column and widening the photo to the whole band. That was found by reading the live HTML (`featured-band … bg-dark`, `t-h2 text-light`) before writing anything. The target itself was unambiguous, so it was not a stop.

**"Same style as Representing…" is the utility, and the colour is the mockup's.** Partners' heading is `t-h2 text-primary` (#652323). Sampling Erik's close-up gives #370c0a for his "Featured Properties" and #5d2825 for "Representing…": the same render shift applied to #3d0707 and #652323. So the heading is `t-h2 text-dark`. The scaffold test compares every computed type property against the Partners h2, and the colour against the palette's DARK. The first draft spelled the colour as `rgb(61, 7, 7)`, which `scripts/spec-palette.test.ts` refused in the gate: specs import the palette and never spell it. Measured photo ratios in both of Erik's images are 1.936 and 1.93, so `lg` uses 1440 / 744; phones keep 928 / 542.

**The instrument caught one real defect before review did.** The first "controls level with LEARN MORE" test measured only slide 1 at 1440, and it passed. Turning through all three slides at 1280 put the controls 20px below LEARN MORE. The slides stack in one subgrid area, the tallest listing sets the row, and a shorter listing's button floats. The fix is `lg:mt-auto` on LEARN MORE's wrapper, which pins it to the column's foot.

**Review, two rounds; the second found comments only.**

- **Round 1, no blocker.**
  - At 1920 the listing column ran 300px past the centred content edge, because the last track was `1fr` with no mirror of the first track's centring. Fixed with a fifth track, `max(0px, (100% - 1440px)/2)`. A seventh mutation proves the right-edge assertion that guards it.
  - The full-bleed photo needs 1440 × 1.06 × 2 = 3052.8px at DPR 2, but srcset stopped at 2560. Fixed by adding a 3072 candidate.
  - The hydration case compared a heading measured against the band, and the card's 24px reveal now moves it. It is measured against the card now.
- **Round 2** confirmed every fix: it worked out the tracks at 1024, 1440 and 1920 and compiled the classes with the repo's Tailwind. It found four stale comments, fixed in a comment-only commit.

**Seven mutations, all red.** The label back over the photo; `t-h3`; `text-primary`; the controls at the top of the column; LEARN MORE unpinned; the heading back outside the card; no fifth track. Each went red in at least one browser test, and the last-but-one also went red in the unit test. Every new test passed on the unmutated branch first.

**What the design change cost the scaffold tier.** The old "where the comp draws it" block measured a 928:542 card, the arrows 43px above its foot and the heading beside it, and it was replaced. Two hover/axe motion cases needed a 1200-tall viewport, because the band is now about 1,040 tall at 1440 and Pause sat below a 900px fold. Two axe node counts went up by one (the heading is in the card). The a11y-fixtures widths changed to 1440 on `/` and 704 in the `max-w-3xl` fixture. The fixture's comment claimed a container query on the card that has not existed since SEE ALL moved to the controls row on 10-01, and it was corrected.

**One behaviour change, accepted and stated in the PR.** The heading is now inside the card's `data-reveal`, so with script on and the bundle missing it stays hidden with the card (#43/#105). Before, it stood above the hidden card.

**Phone order is a judgement call, shown in the PR, not asked.** Below `lg` the band stacks as photo, bar, heading, controls, listing. That is the old phone order with the heading moved from above the photo to the top of the panel.

**Left behind.** The head branch `claude/ri-featured-heading-left` and the screenshots branch `claude/pr-shots-featured-1012` are still on GitHub. roalson-interests does not auto-delete head branches, and the cloud proxy refuses the delete with a 403.
