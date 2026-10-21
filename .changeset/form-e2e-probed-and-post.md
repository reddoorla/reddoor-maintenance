---
"@reddoorla/maintenance": patch
---

form-e2e reads the action POST, not only the banner, and the nightly reds when it probed no site (#1610). Once the `role="status"` region shows, the runner gives the action's own POST (the one carrying the probe's `testMode` marker) up to 2 s to answer; a 4xx/5xx, or a 200 whose SvelteKit body says `"type":"failure"`, is a failure ("the status region showed, but the submission failed — POST 500 …"), so a site that renders its error in the same region as its thanks no longer passes. fleet-form-e2e reds when the probe drove no site at all (`FLEET_FORM_E2E probed=0`), for example every site self-skipping because `/health` dropped `forms.testMode`; partial self-skips stay a warning during the rollout.
