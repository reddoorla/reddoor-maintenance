---
"@reddoorla/maintenance": minor
---

`report --rerender` (the dashboard's "refresh preview") now re-checks an unsent, unapproved report's health evidence against the site's latest audits before it renders, and stores the result. A draft made before its site was ever measured used to read "Not yet measured" on every gating item forever, so it could never be approved without deleting it or overriding the gate (#890). Approved and sent reports keep the evidence they were approved against, the draft-time Google Indexed result is kept as it was, and a box is only ever ticked, never unticked. The machine line gains `evidence=reticked|unchanged|locked|not-written`.
