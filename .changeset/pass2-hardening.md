---
"@reddoorla/maintenance": patch
---

fix(forms/dashboard): genuine-resubmit exemption, retro re-bucket for classifier-caught sprays, full-bucket facets

Second adversarial pass over the 2026-07-15/16 spam work confirmed three defects (and
refuted three more claims); all fixed here:

- **Genuine same-sender resubmission was silently bucketed AND retro-flipped the
  delivered original.** A real visitor resending an identical message (double-click, or
  no reply after days) exact-matched their own prior row → the resend went to
  `spam_auto` with notify skipped and the original still-`new` row was retro-flipped —
  an active lead vanished with no signal. The duplicate scan now exempts matches from
  the SAME sender on the SAME site (live corpus showed 7 genuine leads one resend away
  from this). Cross-site or different-sender copies still count as spray evidence.

- **Retro re-bucket never fired for classifier-caught sprays.** Both structural scans
  were guarded by "not already spam", so once the tuned classifier began catching whole
  spray families (all live families now score ≥ 60), the retro cleanup #420 shipped
  could never run — 18 known spray copies sit permanently in the unread queue. The
  scans now always run; escalation/reason still only applies when not already spam,
  and prior still-`new` copies get retro-cleaned regardless of which layer caught the
  incoming copy.

- **The /submissions facet line tallied only the current page** (≤50 rows) while
  sitting under the full-bucket total — and the rollout runbook directs the operator to
  judge the requireTurnstile canary from it. A new `listSpamReasonsFiltered` helper
  feeds the facet line every matching row's reasons (fetched only on spam views).

Also fixed outside this repo: the Airtable `Require Turnstile` checkbox description
still claimed absent tokens stay neutral (pre-#412 semantics — the opposite of the
shipped hard gate); rewritten to point at the rollout runbook.
