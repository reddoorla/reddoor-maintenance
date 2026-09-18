---
"@reddoorla/maintenance": patch
---

The prospect accuracy check stops treating a sentence-initial capital as a proper noun: `The` no longer hands a free shared token to every claim/quote pair, a shared name is now matched as a name rather than as two words, and a capitalised search term is judged the same as its lowercase spelling unless the claim itself writes it as a name.
