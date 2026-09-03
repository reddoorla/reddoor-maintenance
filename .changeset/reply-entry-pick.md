---
"@reddoorla/maintenance": patch
---

Pick the reply entry that has copy, not merely the first one matching the form
type.

A repeatable group hands an editor a new row with its Select unset or defaulted,
so a settings document part-way through being filled genuinely contains several
blank rows all claiming the same form type — that is the state a real client
document was found in. Taking the first match outright meant one stray blank row
above the real copy silently discarded it: the reply fell back to the built-in
default and looked, from the client's side, exactly like the feature not
working.
