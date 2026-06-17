---
"@reddoorla/maintenance": patch
---

Lower the form timing-gate threshold (`MIN_FILL_MS`) from 2000ms to 800ms. A
too-fast fill is dropped silently (the visitor still sees success), so the old
2s bar risked silently losing a real lead from a quick-but-genuine human
(autofill, a short form, a returning visitor). At 800ms a submit is effectively
instant — which a script does and a human realistically never beats — so the
gate still blocks instant bots while erring toward letting borderline-fast
humans through. The honeypot remains the primary bot signal; this only affects
the server form-action path (`createIngestAction`), as the modal/JSON path
already screens honeypot-only.
