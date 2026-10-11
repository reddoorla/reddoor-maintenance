## 2026-10-08 — Roalson Properties: the Land view keeps its 100px above the footer band (roalson-interests#279, `456296e`)

The operator, right after #278 landed: "for the just land tab, we lose the
margin to the footer". Measured on production, the space between the last
listing and the Bill Miller photo band was 0px under `#land`, against 100
under the default view, `#improved` and `#list`, at both 1440 and 390.

#278 did not cause it. `PropertyListing` gives `pb-[100px]` to the last
section in the DOM, which is Improved. #277 (10-07) made Land a view of its
own, and with Improved hidden nothing after Land carried the pad. The dev
fixture hid the defect: it has three Past Projects, and that section always
shows and comes last, so the fixture's Land view never ended on Land. Only
the live portfolio, which has no past project, ends there. So the new spec
reads the live `/properties` route rather than `/dev/properties`. It
compares each view's gap with Improved's instead of pinning 100. It was red
before the fix (`Expected: 100, Received: 0`).

The fix is one `app.css` rule beside the view filters, in both their
`data-view` and no-script `:target` forms: under the Land view, when no
`section[data-past]` follows Land, Land's last block takes the same pad.
Measured on a preview build, `#land` is 100 at 1440, at 390 and with script
off, and the default view is unchanged.

Live at 17:25Z: production `#land` measures 100 at 1440 and 390.
