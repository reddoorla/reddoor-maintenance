# 2026-10-29 — Roalson's Prismic token mapped in both fleet Prismic workflows (P1-92, #1879)

Landed in this PR, workflows only.

fleet-prismic-sync run 40827617690 failed on `roalson-interests — no write token for Prismic repository "roalson-interests" — set PRISMIC_TOKEN_ROALSON_INTERESTS`. Fleet mode refuses the generic token, so a site whose `PRISMIC_TOKEN_<NAME>` is not mapped into the step's env fails even once the secret exists. Neither `fleet-prismic-sync.yml` nor `fleet-prismic-drift.yml` carried the line; both do now, in the same alphabetical slot, and the drift file's comment counts 20 names instead of 19.

The name was checked against the repo's own authority, not the error alone: `prismic-models --fleet turso --tokens` (read-only, names only) lists `roalson-interests → PRISMIC_TOKEN_ROALSON_INTERESTS`, and `prismicTokenEnvName("roalson-interests")` gives the same. Diffing that checklist against the workflow list found no other site missing; the six names the list carries beyond the checklist are pre-launch sites, inert by design.

Both brief mutations turned `fleet-prismic-sync — wiring > carries exactly the drift sweep's per-repository Prismic tokens` red (the line in one workflow only; `PRISMIC_TOKEN_ROALSON_INTEREST` in one). Neither would catch the name missing from both files: the identity test pins sameness, not coverage, and the `--tokens` checklist is what covers that.

The secret itself is the operator's (AUTONOMY.md RED). Until it is set, the nightly stays red on this one site. `docs/runbooks/site-launch.md` does not mention Prismic tokens at all, so a launch has no step that adds a site's `PRISMIC_TOKEN_*` line or mints its secret; that gap is noted on the PR, not fixed here.

Usage: not readable (get_session returned no usage block).
