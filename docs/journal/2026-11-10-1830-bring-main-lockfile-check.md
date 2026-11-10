# 2026-11-10 — staging-bring-main checks what pnpm chose, and reseeds a lockfile that put a version back

Landed in reddoorla/reddoor-maintenance#2021 (`fix(staging-bring-main)`). Workspace decision `decisions/2026-11-10-1820-p1-106-bring-main-lockfile-check-five-rounds.md`: the operator asked for a sixth review round before landing.

**Why.** On the P1-106 promotions earlier today, pnpm 12.5.1 merged its own lockfile conflict on alamo-anatomy and mantis-landscaping. `scripts/staging-bring-main.mjs` passed both merges. Each one had put three of `staging`'s lock-file-maintenance versions back to `main`'s older ones: `rolldown` 1.3.0 → 1.2.16 (with its 15 bindings and helpers), `cookie` 2.0.2 → 2.0.1 and `@netlify/types` 3.3.1 → 3.3.0. The script looked for conflict markers and stray files, and never at what pnpm chose. The 11-10 session caught it by eye and rebuilt both lockfiles from `staging`'s (reddoorla/alamo-anatomy#108, reddoorla/mantis-landscaping#87).

**What it does now.** After pnpm runs, the script compares the merged lockfile with both parents, dependency by dependency. On a regression it retries from a side's own lockfile, `staging`'s first. It does that only from a side whose `package.json` files, `patches/` and pnpm config the merged tree still has. The retried result is checked against both sides. If no retry passes, it exits 2, names every package and makes nothing. On the real inputs, with pnpm 12.5.1 in full clones:

- Alamo (`--main 490f148 --staging fbe8c7e`): the old script made a branch with the three regressions. The new one names exactly `@netlify/types`, `cookie` and `rolldown`, seeds from `staging`, and produces a `pnpm-lock.yaml` byte-identical to the hand-fixed merge `8b2496b`.
- Mantis (`--main 77dfea7 --staging c0d8b35`): the same three, byte-identical to `6b56a7a`.

**The design moved three times under review.** Each move was forced by a reproduced input, and each fix landed with a test that failed first.

1. **Newest version per name**, the brief's literal rule. Round 1 showed it blind below a name's newest copy. With `foo` at 1.0.x and 2.0.0, a seed from `staging` dropped `main`'s 1.0.0 → 1.0.5 bump and passed, because the newest copy (2.0.0) was unchanged. Seeding turned a blind spot into an active loss.
2. **Per major (or `0.minor`) line.** Rounds 2 and 3 found the range exemptions speaking for the wrong copy: an exact direct pin `foo 1.5.0` excused a transitive 1.9.0 → 1.5.0. Removing a dependency also left a lower copy in its line and refused a correct merge. One importer's pin excused another's.
3. **Dependency edges.** A version counts only through a dependent the merged lockfile keeps: the same importer or the same package snapshot.
   - Peers had to be skipped. Without that, the known-good input (`staging`'s own lockfile as the merge) flagged `main`'s `@types/node` 25 reaching vite as a peer, which `staging` moved to 24 on purpose.
   - Round 4 found importers keyed by YAML document index. A pnpm ≤10 side (one document) against a pnpm 12 merge (env document first) looked up its project at the env document, so no direct dependency was checked.
   - Round 5 found pnpm's parent separator: `>` counts only when no space, `|` or `@` precedes it, so `cookie@>=2.0.2` is a global pin. It also found an `npm:` alias's range excusing a put-back, in a test that never reached the edge it named.

**Beliefs corrected on contact.**

- "Prove the instrument" paid for itself twice. The first edge version failed on the known-good Alamo input, which is how the peer problem surfaced. The per-line version had also silently dropped Alamo's `cookie`, because the override `cookie@<0.7.0: ^0.7.2` was being read as a pin on every cookie.
- A side's lockfile read through the repo's `git()` helper is trimmed and capped at 1 MB. A seed written from it would lose its final newline. That is now `spawnSync` with no trim and a 256 MB buffer, under test (M21).
- The brief said "for each package name, the newest merged must be at least the newest on each side". The edge check is stricter on every case the reviews raised, and it still names exactly the three 11-10 packages. The PR says so.

**What it does not do.** It does not catch the 11-04 Alamo failure mode, where pnpm re-resolved the whole tree upward (23 versions neither branch had). Nothing went backwards there, so this check has nothing to flag. Aliases (`baz: bar@2.0.0`) fall back to the line comparison. When a side's exact peer variant is gone, the pooled fallback takes the newest version across the merged variants.

**Honest accounting.** Five dirty review rounds hit the operator's stop, and he chose a sixth. The 33 named mutations each turn a test red (table in the PR). The fixtures are Alamo's three lockfiles, gzipped. The Alamo and Mantis end-to-end runs need network and pnpm 12.5.1, so they live in the PR body, not in CI.

Usage: $18.13, 4461/228533 tokens, 36370979/1097811 cache, rate limit allowed

## Rounds 6 and 7 (a continuation session, 2026-11-10)

**Round 6** (the operator's extra round) found one major in round 5's `npm:` guard: it also ignored a same-name alias (`cookie: npm:cookie@^0.7.0`, which pnpm writes with a plain version), so a deliberate rollback through it read as a put-back. The guard now ignores only an alias of another package (`a12fcb1d`). M31 was found equivalent and is marked `survives` with the reason.

**Round 7** (the operator's call: a seventh round, land if clean) was not clean. It found four majors, which corrects two lines of "What it does not do" above:

- **Aliases did not fall back to the line comparison; they were dropped.** pnpm 9 writes `foo: npm:bar@^1` as `version: bar@1.2.0`, and a snapshot's `string-width-cjs: string-width@4.2.3` the same way. Neither is semver, so no edge was recorded. A put-back through one passed whenever its line kept a newer copy (reproduced: `string-width` 4.2.3 → 4.2.0 under `@isaacs/cliui` gave `[]`), and a rollback through the alias's own range was refused. The edge is now the package's, held under the alias key.
- **A dependent bumped on `main` hid the put-backs under it.** Staging's lock-file maintenance took `foo@1.0.0`'s `bar` to 2.1.0, main's Renovate took `foo` to 1.0.1, and pnpm kept main's `foo@1.0.1 → bar 2.0.0`. `foo@1.0.0` was "gone", so `bar` passed. It was in the real 11-10 merge too: `rolldown@1.3.0 → @oxc-project/types 0.157.0` went back to 0.156.0, masked only because `rolldown` itself was named. Each newer copy of the dependent in its line must now resolve the dependency at least as new. Across peer variants the lowest now stands, not the newest, which is the other corrected line.
- **A `catalog:` specifier excused nothing**, so a rollback through a catalog was refused. It is now read through the lockfile's catalogs.
- **The runbook's exit-2 step could not be followed** when neither side is newer on everything. It now says how to rebuild the lockfile and re-check it with a one-liner. The one-liner gave `[]` on Alamo's hand fix and named exactly the three packages on the bad merge.

Each fix has a test that failed first and a named mutation, M38–M43. Alamo and Mantis still come out byte-identical to `8b2496b` and `6b56a7a`. The bumped-dependent rule makes one common shape stop with exit 2 where it used to pass silently: a Renovate bump on `main` overlapping staging's maintenance of that package's dependencies. That is the intended direction, and the operator decides whether it lands.

Usage (this continuation, to this point): $5.49, 1666/65891 tokens, 8418648/446714 cache, rate limit allowed

## Round 8 (the same continuation session)

**Round 8** (the operator's eighth round, on round 7's new logic) found four real defects. Three were in round 7's own fixes:

- **The bumped-dependent rule crashed on a dependent that is not semver.** A `file:` tarball or git dependent that differed between the sides threw `not a semver version` (exit 1). The reviewer reproduced it on lockfiles pnpm wrote. Such a dependent now has no line, as the rest of the check already assumed.
- **The same rule refused correct merges in real history.** A replay of every merge with three lockfiles in 20 site repos (564 merges) found two: reddoor-website `43455b08` and reddoor-starter `7a95a3fe`. The starter's `uuid@<11.1.1: '>=11.1.1'` override had pushed `@prismicio/types-internal` 3.11.2's uuid to 14.0.1. Version 3.17.2 asks for `^11.1.1` itself, so pnpm rightly resolved 11.1.1. A newer copy is now compared only within the side's own line of the dependency. After the fix, the replay matches the pre-round-7 code on every merge.
- **An importer edge whose key was renamed was dropped.** A put-back under the package's other key passed (rare: it needs a `package.json` rename on one side). Before round 7 the line fallback caught two of the three shapes. Now every key in the importer that still resolves the package is checked.
- **The runbook's `pnpm update <pkg>` rewrote `package.json`** (reproduced on Alamo: `^4.0.0` → `^4.7.8`). Its `git checkout --ours` also kept a clean text merge instead of staging's lockfile. The steps now use `--no-save --lockfile-only` and `git show <staging sha>:pnpm-lock.yaml`. Followed on Alamo, they give `[]` and a lockfile byte-identical to `8b2496b`.

**A correction to round 7's paragraph above.** It said the bumped-dependent shape "was in the real 11-10 merge too" (`@oxc-project/types` under `rolldown`). It was not. `rolldown` was not bumped on `main`; the merge put `rolldown` itself back. That is the "dependent itself put back" case, and the check still does not name dependencies under such a dependent, only the dependent.

**The mutation run found a test gap.** M34 (peer variants pooled) survived at `17b3cff8`: once round 7 took the lowest across variants, pooling gave the same answer on the existing test. The round-7 peer test now also checks a side whose own variants resolve differently against itself, which only the exact-variant lookup passes.
