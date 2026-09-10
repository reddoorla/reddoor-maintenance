---
"@reddoorla/maintenance": patch
---

The nightly Prismic drift sweep now carries `PRISMIC_TOKEN_29_NAVY`, and the
runbook says that minting a central secret is only half the job.

`PRISMIC_TOKEN_29_NAVY` exists as an Actions secret on this repo and nothing
read it. Measured as a set difference, not by eye: 13 `PRISMIC_TOKEN_*` secrets
against the 15 env lines in `.github/workflows/fleet-prismic-drift.yml`, and
`comm -23` returned exactly one member — this one. `grep -n PRISMIC_TOKEN_29_NAVY`
on the workflow printed nothing. The name is right: `29-navy`'s Prismic
`repositoryName` is also `29-navy` (read from `origin/main`'s
`slicemachine.config.json`), and `prismicTokenEnvName` maps it to
`PRISMIC_TOKEN_29_NAVY` exactly. The leading digit survives only because the
literal prefix comes first — a suffix rule would yield `29_NAVY_PRISMIC_TOKEN`,
which is neither a legal shell identifier nor a legal GitHub secret name.

**This does not put 29 Navy in the sweep, and anyone reading it that way has
been misled.** The env line was never why the site is dark. `--fleet airtable`
resolves only sites whose Airtable Status is `maintained`, and 29 Navy's is
`building`. The proof is a controlled experiment already running in production:
alamo-anatomy, hedloc and the-pointe-burbank all have both the minted secret and
the env line, and none of the three is swept — last night's real run
(34334202327) reported "9 checked, 0 failed, 4 skipped (no Prismic config), of
13 site(s)" and none of those 13 was any of them. What this change removes is a
latent go-live defect: the night a Status flips to `maintained`, the sweep has
the credential instead of reporting the site token-missing and writing
`unknown`. Two operator actions still stand between 29 Navy and coverage — the
Status flip, which is a launch decision, and its Airtable `Git repo` cell, which
is NULL and would make the clone throw outright.

Nothing here contacts Prismic, so the secret is `PRESENT (not verified)` in the
doctor's own words; whether that token can read that repository is
unestablished.

The defect class is "a central `PRISMIC_TOKEN_*` secret is minted but no env
line consumes it". **CI cannot close it** — no test can enumerate GitHub
secrets — so the guard is a runbook step next to the mint command, not a test.
The two new tests guard the instance and the shape only.
