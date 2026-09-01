---
"@reddoorla/maintenance": patch
---

sync-configs: merge `.prettierignore` instead of overwriting it, and absorb the last of reddoor-starter's local config overrides

`.prettierignore` was byte-matched, so a sync deleted whatever a site had added.
reddoor-starter ignores the Slice Machine-generated `src/prismicio-types.d.ts`
there — a prettier version bump reformats that file and reds `prettier --check`
on otherwise-fine dependency PRs — so the overwrite silently re-armed the very
failure the entry prevents. It is now merged exactly like `.gitignore`: canonical
entries are backfilled, the site's own are preserved.

Two bits that lived only in reddoor-starter's local configs are now in the shared
ones, so sites no longer need to fork them: `reducedMotion: "reduce"` in the
playwright base (every site gates scroll-behavior on prefers-reduced-motion, so a
smooth-scrolling run is a fleet-wide flake source) and the `docs/superpowers/` /
`scratchpad/` eslint ignores.

Also drops `.vercel/` from the canonical `.gitignore` entries. It arrived with the
list's first commit and was never justified — the whole fleet deploys to Netlify,
and nothing in the tooling references Vercel.
