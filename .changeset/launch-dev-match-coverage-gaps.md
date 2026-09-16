---
"@reddoorla/maintenance": patch
---

launch: both /dev/match gates enumerate instead of hardcoding — +server.ts endpoints and non-home uids are no longer unchecked (#723)

The two launch gates that keep a matching twin out of production each looked at a
fixed list. `matchingDisposition` inspected three hardcoded paths and returned on
the first guarded one; the deployed `dev-guard` probed exactly one url,
`/dev/match/home`. Between them that left two shapes where **both gates pass
while a dev twin is live** — the one thing the pair exists to prevent.

**`+server.ts` endpoints.** SvelteKit layout `load` does not run for them, so a
site whose only guard is `src/routes/dev/+layout.server.ts` — the #717
class-fix, and the _better_ placement for pages — satisfied the filesystem gate
while `src/routes/dev/match/[uid]/+server.ts` shipped. The deployed gate missed
it too: it probes the page path, which 404s correctly. The filesystem half now
walks `src/routes/dev/match/**` and requires every `+server.ts` to carry its
**own** guard, layouts notwithstanding.

**Siblings.** A `/dev/match/frozen` index — a natural thing for a match harness
to grow — was inspected by neither gate. Every page directory under
`/dev/match` must now be covered, either by its own guarded `+page.server.ts` or
by a `+layout.server.ts` at or above it.

**Non-home uids.** `dev-guard` now reads `matching/harness.json` — the page table
the `match-harness` recipe installs and every gate already reads — and probes
`/dev/match/<uid>` for each page, so the gate and the harness cannot disagree
about which pages exist. Pages whose `uid` is `null` have no twin and are
skipped, as `harness.mjs` documents. An absent or unparseable harness.json falls
back to `home`: not every launched site carries the harness, and a missing file
must not become a refusal — nor may it quietly probe nothing, which would let an
absence grant the green.

Both refusals name the offending file or uid rather than reporting a generic
failure, because the previous message named a fixed list that no longer
describes what was checked.

Red first, and the controls matter as much as the failures: a self-guarded
`+server.ts` and the absent-harness fallback both passed **before** the change,
so the new rules were shown capable of passing before any refusal they produce
was trusted. The three gap fixtures — a layout-guarded site with an unguarded
endpoint, a guarded twin beside an unguarded `frozen/` sibling, and a live twin
on the uid `services` — returned `ok: true` / `complete: true` before it and
refuse after.
