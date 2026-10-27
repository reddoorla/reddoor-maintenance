## 2026-10-08 — Roalson Properties: the map and its panel sit on the site grid (roalson-interests#278, `ee96b2c`)

Erik, in `#roalson-interests` at 15:39Z: "On the big maps (properties page)
the map+listing width breaks the grid for the rest of the site". His
screenshot had blue guides on the logo's left edge and the menu button's
right edge, with the map running past the left guide and the panel past the
right one.

The cause took one file read. #270 gave the map section its own container,
`mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-0`, while every other section, the
nav and the footer use `GUTTERS` (`… xl:px-20`). So from `lg` the pair was a
centred 1440 box with no gutters. It was full bleed only at exactly 1440, and
off-grid at every width. Measured on production with Playwright (CSS px,
viewport including the 15px stable scrollbar gutter), map left → panel right
against the grid:

- 1024: 0 → 1009, against 32 → 977
- 1280: 0 → 1265, against 80 → 1185
- 1440: 0 → 1425, against 80 → 1345
- 1920: 232.5 → 1672.5, against 312.5 → 1592.5

That is an 80px overhang each side from `xl` up, and 32 at `lg`. After the
change, all four match the grid exactly. 390 and 768 measure identically
before and after, because below `lg` the old container and `GUTTERS` were
already the same classes. So "phone and tablet unchanged" holds by
construction, not by luck.

**The fork the brief flagged did come up, and I took it without stopping.**
Nicole's Option 1 frame (`7153:969`) drew the map full bleed at 1440. Erik's
ask and the operator's "general guidelines" put it on the grid, and every
other section on the site answers to the grid. Two people had already given
the reading, so I judged the fix obvious rather than a design question. The
cost is a narrower map: 813 of 1440 at 1440, down from 915, with the panel at
452 (was 510). The height formula `min(57.43vw, 827px, …)` was derived from
the full-bleed width, and I left it alone. So the map is squarer than the
comp: at 1920 it is about 822 wide by 827 tall. The adversarial review
flagged this as a design call, not a regression, and the reply drafted for
Erik in the PR body asks Nicole to look.

The scaffold spec that pinned `map.left ≈ 0` at 1440 was replaced, under the
site's "a human's design change wins" rule, by one case each at 1024, 1280,
1440 and 1920. Each case asserts the map's left equals the section rule's and
the footer's left, and the panel's right equals the rule's right. With
`PropertyListing.svelte` reverted to `main` all four cases went red
(`Expected: 32 / 80, Received: 0`), so the instrument was proven before its
pass was trusted. The review's one actionable minor was the panel photo's
`sizes`: it still said `515px` / `36vw`, which overstated the gridded panel
by about 12%. That was fixed in the same PR.

Production for this site is `roalson-interests.netlify.app`, found through
the Netlify connector. The `roalson.netlify.app` named in older maintenance
docs 404s, and so do `roalson.com/properties` and `www.roalson.com/properties`.

Live at 16:28Z, a minute after the merge. Re-measured on production, the map
and panel edges equal the footer's and the section rule's at 1024 (32 → 977),
1440 (80 → 1345) and 1920 (312.5 → 1592.5), and 390 is unchanged. I did not
post the drafted reply to Discord. It is in the PR body for the operator.
