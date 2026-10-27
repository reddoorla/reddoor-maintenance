---
"@reddoorla/maintenance": patch
---

form-e2e passes a submit only when its marker POST answered (#1668). The 2 s settle after the `role="status"` region shows is gone: the runner now waits for the action's own POST (same-site, carrying `testMode`) up to the 30 s submit cap, and a pass needs it to answer below 400 with no SvelteKit failure body. Before, a region shown first ("Sending…") with a 500 at 2.5 s passed, and so did a client-side error written into the region with no POST at all (a Turnstile that issued no token). The failure line names the cause: "it answered after the status showed", "no POST was sent", "its POST never answered", or the other host a marked POST went to. A POST with no body is no longer taken for the action (only an unreadable multipart one is), and the `postSettleMs` runner option is removed.
