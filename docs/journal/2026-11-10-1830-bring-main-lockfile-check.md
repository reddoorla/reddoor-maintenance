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
