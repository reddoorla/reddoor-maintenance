---
"@reddoorla/maintenance": patch
---

Give the smoke audit a budget that fits the suites it runs, and make a timed-out
site impossible to mistake for a healthy one.

`reddoor` and `beachfront-dentistry` had been failing the nightly fleet smoke for
four consecutive nights while the workflow reported success every morning and
Airtable kept showing both green.

Three separate things had to line up for that:

1. The budget was 5m00s. reddoor-website's own `Smoke test` step takes **4m57s** on
   a 2-core GitHub runner with chromium already installed and `node_modules` warm
   (run 32413378638). The fleet path is strictly heavier — the site's `test:smoke`
   is `playwright install chromium && playwright test`, so the browser install lands
   _inside_ that budget, on a fresh clone. Three seconds of headroom in the best
   case; the medtech release pushed both sites over. They were killed at 5m03s and
   5m04s — the wall, not their suites. The budget is now 15 minutes, ~3x the
   measured cost and still far inside the workflow's 90-minute step backstop.

2. A timeout rethrew into `runOneAudit`'s catch-all and became
   `smoke: unexpected error — Error: spawn timeout…`: nominally a `fail`, carrying
   no `details`. The Airtable writer keys on `details.checkedAt`, so it correctly
   preserved the prior verdict rather than record a false fail — which is right, and
   is also exactly why the row kept serving a stale green tick. Timeouts are now a
   distinct outcome, `smoke: NOT MEASURED`, still detail-free so write-back behavior
   is unchanged. `SpawnTimeoutError` makes the case identifiable instead of matched
   by message text.

3. `fleet-smoke.yml` gated only on `FLEET_WRITE_SUMMARY`, which counts rows
   **written**, not rows passing — and an unmeasured site still writes, because it
   writes nothing new. The gate was structurally incapable of firing. The CLI now
   emits `FLEET_SMOKE_UNMEASURED count=N sites=…` on every fleet smoke sweep,
   count=0 included, and the workflow reds the run when N > 0 or the line is absent.

A suite that RAN and failed is still data, not an outage, and still exits 0 — only a
measurement that never happened reds the nightly.

The gate is executed, not asserted: `tests/build/fleet-smoke-workflow.test.ts`
extracts the step's shell out of the YAML and runs it under `bash -e` against a
stubbed CLI, with the clean-sweep case first so the alarm is proven to pass before
any failure it reports is believed.
