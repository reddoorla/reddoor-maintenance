---
"@reddoorla/maintenance": patch
---

feat(forms): bounced lead notifications become visible — webhook mapping + cockpit alarm

The Espada failure mode: apm@espada-pm.com bounced 4 of the last 8 lead
notifications and NOTHING alarmed, because notifyStatus "sent" only means
Resend accepted the email.

- **Webhook mapping.** The resend-webhook now checks a bounce/complaint
  event's email id against submissions' `resend_message_id` FIRST (the id
  spaces are disjoint from report emails): a match flips that submission's
  `notify_status` to the new `'bounced'` terminal value and stops there —
  the report-email path is untouched, idempotent on svix replays, and a
  Turso blip fails open to the report path.
- **Cockpit + digest alarm.** New `collectNotifyBounceAlerts` collector
  (kind `notify-bounce`, CRITICAL): one attention item per site with >= 2
  bounced notifications in the last 14 days — "lead notifications bouncing
  — check the point-of-contact address". Wired into both the cockpit
  rawItems and the digest collector list with the shared
  `notify-bounce:<siteId>` diff key.
- **Row marker.** A bounced submission shows a visible red "notify bounced"
  chip on its summary line in the per-site strip and /submissions (plus
  `bounced` in the Notify detail row) — not just a tooltip.
