/**
 * Block BODIES this recipe has previously shipped — the block half of what lets
 * it tell "stale, but ours" from "hand-edited by the site". `planBlockWrite`
 * flags every region it cannot recognise, so without a record of what was
 * shipped, install-once is install-forever for the three marked regions.
 *
 * The whole-FILE table is NOT here. It lives in the generated `template.ts` as
 * `MATCH_HARNESS_PREVIOUS`, it is POPULATED, and it is what upgrades an
 * installed site's `matching/gate.sh` to the one that stopped saying ALL DONE
 * over failed runs (#744). Re-pointing that import at an empty table here would
 * silently un-ship that fix to every site already carrying the v1 gate — which
 * is exactly what this file did on its first draft, and what
 * `tests/recipes/match-harness.test.ts`'s "UPGRADES a site running the shipped
 * v1 gate.sh rather than flagging it" caught. The deprecation note and the
 * import switch were written together; the data migration they both depend on
 * is #753, and had not happened. Whatever replaces the generated table has to
 * carry the bodies across in the same commit that moves the import.
 *
 * Two rules for what goes below, and they are why this table is HAND-AUTHORED:
 *
 * 1. An entry is added ONLY when a block body has been SUPERSEDED — at the
 *    moment the shipped body changes, in the same commit that changes it.
 *    Recording a body that is still current makes the table lie in the one
 *    direction that matters: it would let a stale render be replaced by itself.
 *
 * 2. A body's source is a PUBLISHED GIT TAG — `git show v0.95.0:<path>` — never
 *    the working tree. Reading the tree is how a mutant gets banked as a
 *    legitimate prior release: mutate, regenerate, revert, and the mutation is
 *    now a body this recipe will happily install over a real site. Measured on
 *    this branch: one mutate/regenerate/revert cycle added 693 lines and two
 *    copies of the same predicate.
 *
 * EMPTY at 0.95.1 on purpose. 0.95.1 changes no block body at all: its whole
 * job is to install the region terminators, which is what makes the first
 * exercise of the block replace path provably content-neutral.
 */

/** Block BODIES previously shipped per target file, for the three marked
 *  regions in `.gitignore`, `.prettierignore` and `CLAUDE.md`. */
export const MATCH_HARNESS_BLOCK_PREVIOUS: Readonly<Record<string, readonly string[]>> = {};
