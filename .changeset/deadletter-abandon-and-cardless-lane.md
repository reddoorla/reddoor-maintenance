---
"@reddoorla/maintenance": patch
---

Dead letters can be abandoned by decision, and card-less items get a cockpit lane (#786)

Two follow-ups to #645/#785.

**A terminal `abandoned` outcome.** #785 made `unknown-site` non-terminal on
replay so that both recovery orders are safe — `ensure-site` then replay, or
replay then `ensure-site` — because replay-before-heal would otherwise burn every
queued lead, and that is the order a person reaches for first. The cost was named
at the time: a slug that is genuinely dead but still deployed and posting grows
the queue without bound, holds `db replay-deadletters` at exit 1, and leaves a
standing CRITICAL cockpit item with no escape short of deleting rows by hand.

`db replay-deadletters --abandon <slug-or-id> --reason "…"` is that escape.
Migrations 0022–0024 add `abandoned_at`/`abandoned_by`/`abandoned_reason` to
`submission_deadletter`; abandoned rows leave both the replay queue and the alarm
count, and the row and its payload are kept — unlike deleting them, which
destroys the leads the decision was made about. It is deliberately not
`replayed_at`: that means the pipeline gave the lead an answer, and a row marked
replayed reads as a lead that was placed. The reason is required, one slug or one
row id only (a mistyped invocation must never mean "abandon everything"), and the
first decision stands on a repeat call.

**A cockpit lane for card-less items.** The card grid is built from the visible
sites and attention items are grouped onto it by `siteName`, so an item naming a
site the fleet does not have matched no card and was dropped — silently, on the
surface the operator actually watches. The one collector that produces such an
item is the one whose whole point is the missing site: a dead letter for a slug
resolving to no fleet row means leads are being dropped right now. Those items
now reach `CockpitModel.cardless` and render in their own lane. It is general
rather than dead-letter-specific, so a future card-less item lands there instead
of vanishing the same way.
