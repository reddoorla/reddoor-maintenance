---
"@reddoorla/maintenance": patch
---

match-harness: the installed prose no longer names `reddoor-maint prismic-seed`, a command that does not exist (#763)

Three files the recipe installs — the `/dev/match/[uid]` route, `site-pages.js`
and `site-pages.test.ts` — told the operator that `reddoor-maint prismic-seed`
publishes the page assemblies to Prismic. No such command was ever written: the
CLI has 27 commands and none of them takes `site-pages.js` as input. On 29-navy
that read as "the content is one command away from live" through a full phase
of work. The route file made the strongest version of the claim, that the dev
surface renders _exactly what the seed publishes_, which cannot be true of a
seed that does not exist.

The prose now names what does exist: the Prismic Migration API, with the
starter's `scripts/import/migrate.example.ts` as the starting point, and says
plainly that the seed is per-site work and no `reddoor-maint` command does it.

Two mechanisms went in with the wording:

- A test reads the command list out of `src/cli/bin.ts` and refuses any
  `reddoor-maint <cmd>` the harness's prose names that the CLI does not
  register — the wrapped shape the route carried (`reddoor-maint\n//
prismic-seed`) included. Same class as #732; this closes it for commands.
- The generator's shipped-history table now covers AUTHORED files, not only the
  seven copied from beachfront. The route and the fixture test are recipe-owned
  and byte-compared on re-run like any script, so without their 0.95.1 bodies
  under `scripts/match-harness-previous/0.95.1/` every installed site would have
  been flagged as hand-edited and kept the wrong prose forever. Measured: with
  the table covering copied files only, a 0.95.1 install re-ran as `noop` with
  both files accused of a hand edit; with the entries it upgrades both in place.
