---
"@reddoorla/maintenance": minor
---

Announcement + report email polish:

- The score-preview accessibility label is now **"Readability (A11y)"** (was
  "Readability") in both the announcement and the monthly report, so the parenthetical
  makes the meaning explicit.
- The announcement's WHAT TO EXPECT checks now use the report's own green check image
  (`cid:rd-check-png`, attached inline at send) placed **after** each label, so the
  announcement's checks match the monthly report exactly (replacing the inline `✓` glyph;
  `alt="✓"` is the fallback shown in the attachment-less review preview).
- New optional `announceScoreNote` copy field renders a thin-italic gloss under the
  Lighthouse scores ("These are independent Google Lighthouse scores, each out of 100 —
  higher is better."); a blank value omits it.
- The Testing checklist item "Verified After Updates" is relabeled **"Tested After
  Updates"** (display-only — the Airtable checkbox column key is unchanged, so no
  live-base migration).
