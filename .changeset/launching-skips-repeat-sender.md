---
"@reddoorla/maintenance": patch
---

forms: a `launching` site no longer runs the cross-site repeat-sender scan, and its submissions no longer retro-bucket other sites' rows. The operator's own test from an address used on other sites is now stored `new` and notified (to the operator only, under the pre-launch guard). The classifier, Turnstile and duplicate-body scans still run on a `launching` site, since it is reachable and the autoresponder goes to whatever address is typed.
