---
"@reddoorla/maintenance": patch
---

Cap the cockpit's "New submissions" strip at the 10 newest rows so it can't grow into a
fleet-wide wall as submissions accumulate. The heading still shows the true total and a
`+N more — triage on each site page` line links onward; per-site NEW-submission counts and
badges are unaffected (the cap is at render only, not the fetch). The per-site form-submissions
section (already capped at 25) now says `showing 25 of N` when it lists a slice, so the heading
no longer implies every submission is on the page.
