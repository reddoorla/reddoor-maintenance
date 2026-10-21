---
"@reddoorla/maintenance": patch
---

The fleet write gate counts a Lighthouse category missing from scores that otherwise landed (#1609). NO_LCP nulls the performance category; the other three scores are still written and the stored performance cell still clears, but each missing category now counts as `lighthouse.<category>` against the sites where lighthouse scored, so performance null fleet-wide reds the nightly instead of reading `wrote=10 failed=0`. One site's NO_LCP is a warning.
