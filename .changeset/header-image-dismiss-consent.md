---
"@reddoorla/maintenance": patch
---

header-image: dismiss cookie/consent UI before the shutter, so a banner and its scrim never ship over the hero (#654)

Sonder's report header showed the homepage behind the site's own consent panel,
with the scrim greying the teal hero to flat bands. Settle time was irrelevant —
the banner never leaves on its own — and clicking Accept restored the real
hero. `refreshHeaderImage` regenerates with no options, so the handling has to
live in the capture itself.

`defaultShooter` now, after load / idle / fonts and before the settle wait:

- best-effort clicks a button whose accessible name is an accept / reject /
  decline / got-it variant, on a 1.5s timeout that is swallowed — the site's own
  dismissal is what unwinds a scrim living outside the banner element;
- injects a style tag hiding `[class*="cookie" i],[id*="cookie" i],[class*="consent" i],[id*="consent" i]`,
  for a banner with no matching button or one that fades slower than the
  settle.

The click goes first because once the rule hides the button it is no longer
actionable. Both are pure additions: a site with nothing to dismiss pays the
click timeout and captures exactly as before.

`consentSelector` is a new optional shoot / capture / generate option, and
`header-image --consent-selector <css>`, for a site whose consent or
interstitial UI the heuristic misses; it is joined onto the heuristic, never a
replacement. The rule builder `consentHideRule()` is exported and tested
without a browser.

Not done here: the issue's second half (make `assertNotBlank` reject a capture
whose visible text still carries consent copy). Sonder's scrim is dark, so the
near-white check passes on precisely the case it names; that is a separate
change to the backstop.
