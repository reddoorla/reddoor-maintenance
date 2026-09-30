---
"@reddoorla/maintenance": patch
---

The a11y gate's blend-mode exemption no longer widens when a page changes while it re-runs a rule. axe names a crashed element by the shortest selector unique at that moment (such as `h2`), and the spec reused it on every re-run, so an element that appeared or was swapped in later (hydration, a carousel) could be excluded too and go unmeasured under a warning. After each re-run, the spec now checks that every excluded selector still names exactly the element that crashed; if one does not, the rule is not re-run around and its crash fails as `rule-errored`.
