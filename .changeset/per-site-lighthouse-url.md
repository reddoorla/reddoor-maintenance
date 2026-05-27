---
"@reddoorla/maintenance": minor
---

feat(audit): per-site lighthouse URL via `package.json#reddoor.lighthouseUrl`

The lighthouse audit hardcoded `http://localhost:5173/dev/a11y-fixtures` — a hand-crafted Reddoor-fleet dev route. Newly-onboarded sites (e.g. CalTex) don't have that route and the audit failed with "no manifest written" before any scores could be collected. Sites can now override the URL in their own `package.json`:

```jsonc
{
  "reddoor": {
    "lighthouseUrl": "http://localhost:5173/",
  },
}
```

Fallback unchanged when the field is missing, malformed, empty-string, or wrong type — existing Reddoor sites keep working without edits.

Also bundled here: the lighthouse audit now gets a 5-minute spawn timeout (was 30 s, the shared default starved lhci on cold trees). This fix was originally pushed to PR #40 after the squash-merge so it never landed; folding it in alongside the related URL work.
