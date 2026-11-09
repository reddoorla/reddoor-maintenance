---
"@reddoorla/maintenance": patch
---

dashboard: the Newsletter Webhook and Form Webhook fields refuse, at save, any URL the forwarders would refuse (anything but public https), so an `http://` hook shows "failed" in the editor instead of saving and failing every forward as `webhook:0` (#1971).
