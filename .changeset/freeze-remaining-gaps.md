---
"@reddoorla/maintenance": patch
---

Three more freeze pre-flight gaps, all gated off the same switch (#612).

**The fleet sweep's mirror outcomes now reach the exit code.**
`writeFleetAuditsToAirtable` catches a per-site mirror failure and counts it —
right, since one bad site must not abort a 44-site sweep — but the counts only
reached the `FLEET_WRITE_SUMMARY` line and no workflow gated on them. Post-freeze
a sweep that wrote the fleet's health into nothing would have finished green on a
line reading `wrote=44 failed=0`. New `fleetWriteFailed` makes a mirror failure,
a missed row, and an absent mirror each fatal once frozen. It gates the run, not
the loop: per-site isolation is unchanged.

**Form ingest stops consulting Airtable.** `makeSiteLookup`'s fallback existed
for a site created in the Airtable UI before the next hourly import. Nothing
hand-creates rows after the freeze and `ensure-site` inserts straight into Turso,
so the window is gone — and consulting a frozen base would resolve a lead against
a row the system no longer believes in.

**The console can clear a secret.** It could replace one but never erase one:
empty means "leave unchanged", deliberately, so an unrelated save cannot destroy
a key that is blank on every page load. Airtable was the escape hatch and the
freeze removes it. Typing `__clear__` now erases the cell and reports `cleared`.

A sentinel rather than a new control, deliberately: the secret input is the one
field whose save listener already fires on any keystroke, so this needs no change
to the inline dashboard script — the part of the page no test executes, and the
part that shipped broken once already.

All three ship inert. Flipping the constant and running the whole suite still
fails exactly one test: the one that asserts its value.
