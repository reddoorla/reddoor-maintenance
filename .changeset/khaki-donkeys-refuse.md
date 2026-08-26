---
"@reddoorla/maintenance": minor
---

Add `db usage` — a nightly alarm on Turso plan-quota headroom (#539 HIGH-10).

The org runs on the starter plan with `"overages": false`, which means crossing
a quota BLOCKS reads and writes rather than billing for them. Once the Airtable
cutover lands, Turso is the only store the fleet has, so quota exhaustion is a
total outage with no warning shot.

`db usage` reads the Turso platform API and emits one greppable line:

```
FLEET_DB_USAGE plan=starter elapsed=82.78% rows_read=0.04% rows_read_proj=0.04% … worst=rows_written_proj:0.36% verdict=ok
```

Three properties are load-bearing:

- **Quotas come from the API's own `/plans` response**, matched to the
  subscribed plan — never hardcoded. A plan upgrade must not leave the alarm
  measuring against a ceiling that stopped being true.
- **Cumulative metrics are projected to the end of the billing cycle.** Rows
  read/written reset monthly, so a raw percentage is not comparable across the
  month: 30% on day 3 is a fire, 30% on day 28 is fine. Storage is a level and
  is deliberately not projected.
- **An unconfigured alarm fails.** No token yields `verdict=no-token` and a
  non-zero exit, and the workflow gates on the marker line rather than the exit
  code alone — an absent success marker is not a passing check.

Capacity metrics (databases/locations/groups) are reported but never alarm: the
fleet sits at its group ceiling by design on the starter plan, so alarming there
would fire nightly about a standing constraint. Those ceilings also fail loudly
at creation time, unlike quota exhaustion.

Wired into `fleet-db-backup` as a separate job, so a quota alarm can never stop
the backup being taken, and it files its own tracking issue. Requires a new
`TURSO_FLEET_USAGE` secret — a platform API token, distinct from the
database-level `TURSO_AUTH_TOKEN`.

Baseline at the time of writing: the worst metric is 0.36% of its ceiling.
