---
"@reddoorla/maintenance": patch
---

Treat `reddoor-wireframer` as a placeholder repository name, like the starter's
`your-prismic-repo-name`, so the Prismic model sweep skips the one repo that
names it instead of demanding a credential for it forever.

`data-dynamiq` points at Reddoor's shared wireframe repository rather than a
content model of its own (operator ruling). It needs encoding rather than
discovering, because it differs from the starter sentinel in the way that
matters: **it resolves.** The Prismic repository genuinely exists — HTTP 200,
two starter documents last published 2024-03-12 — so no failed lookup will ever
reveal it as a placeholder the way a 404 would. Left unlisted it is a permanent
`unknown` verdict on the site's row and a nightly `prismic-unknown:` cockpit
warning that no credential can clear, because the correct number of tokens to
mint for it is zero. The fleet token doctor goes from `1 missing` to `0 missing`.

The check stays a `continue` rather than a `return null`, for every placeholder
and not just the starter's: a half-migrated repo can hold a stale placeholder in
`slicemachine.config.json` and its real configuration in `prismic.config.json`,
and short-circuiting would drop a live site from the sweep on the strength of a
file nobody reads any more.

Note for anyone extending the list: a name added here is dropped from every
sweep, so a real client repository added by mistake stops being checked and
reports as "no Prismic here" rather than as an error. That is an operator
decision, not a housekeeping one.
