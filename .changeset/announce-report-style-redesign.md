---
"@reddoorla/maintenance": minor
---

The announcement email is rebuilt from the monthly report's own components so it reads as a
testing report with extra explanation, not a lighter one-off. A new shared `email-sections`
module (`checklistRowsSection`, `lighthouseScoresSection`, `analyticsSection`) is used by BOTH
the report and the announcement, so they can't drift in design:

- The announcement now renders MAINTENANCE CHECKS (first) then TESTING as real checklist rows,
  the full LIGHTHOUSE SCORES block, and the big ANALYTICS number + Google-position line.
- Each pace's cadence is baked into its section's intro copy ("…We do this every month.") —
  the separate WHAT TO EXPECT block is gone.
- The open-door invitation is reworded ("…just let us know.") and folded into the end of
  RECENT IMPROVEMENTS (no duplicate "reply" CTA right before the contact block).
- Every alternating-background band carries equal top/bottom padding.

Also: **Lighthouse "Ideal" bands now all top out at 100** (Best Practices was 80–92 → 80–100),
in both the report and the announcement, since they share the component. Dead announcement copy
keys removed (`announceScoreNote`, `announcePreviewLabel`, `announceCadenceHeading`,
`announceTestingLabel`, `announceMaintenanceLabel`).
