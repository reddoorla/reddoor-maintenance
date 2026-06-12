---
"@reddoorla/maintenance": minor
---

feat(launch): first-class site launch (M6b — completes M1–M6). `launch <site>` bootstraps CI+Renovate, runs a first audit, and drafts a **purpose-built launch email** (a new `Launch` report type) into the dashboard approve queue. Approving it sends the go-live email and flips the site **Status → maintenance** with a **`Launched at`** stamp — no client email leaves without the one-click approval. The launch email reuses the M6a copy layer (per-site contact/footer overrides honored).
