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
 *
 * First entry after 0.95.1: the CLAUDE.md block, superseded when rule 4 and the
 * round protocol gained `census.sh` (#736). Sourced from `git show v0.95.1`,
 * per rule 2, and identical at v0.95.0.
 */

/** The CLAUDE.md block as shipped at v0.95.0 and v0.95.1 — `git show
 *  v0.95.1:src/recipes/match-harness/template.ts` → `CLAUDE_MD_BLOCK`, byte-
 *  identical at both tags. Superseded by the block that names `census.sh`
 *  (#736): the recipe installed the Phase 3 style gate and the rules that would
 *  make anyone run it did not mention it. Exported so a test can seed exactly
 *  this body and prove the shipped table upgrades it. */
export const CLAUDE_MD_BLOCK_0_95_1 = `
The \`matching-a-page\` skill governs a live-reference rebuild. These five rules
exist because the skill alone did not hold on the project this harness came
from — each one is a drift that actually happened, with the mechanical check
that now catches it. \`matching/harness.json\` is this site's configuration;
\`matching/LEDGER.md\` is the dated record of every deviation, floor and mask.

### 1. Source prescribes, rects only verify

Every geometry fix must cite the rule it came from: a line in the captured
reference stylesheet under \`matching/spec/\`, or the reference's HTML. "The probe
says the gap is 40px" is not a source. If you cannot name the line you are
guessing — go read the stylesheet first.

**Check:** the commit body must name the file:line for each fix.
**Operator's challenge:** _"which line of the reference stylesheet says that?"_

### 2. Phase 1 before Phase 4

A page gets its section census and per-section spec in \`matching/SPEC.md\` BEFORE
its geometry is touched. No SPEC section, no geometry round. The census is the
coverage denominator; skipping it is how a reference's root-font ladder and its
per-component height ladders get discovered reactively, after the region has
already failed several rounds.

**Check:** \`matching/gate.sh\` refuses to run a page with no \`SPEC.md\` section.
**Operator's challenge:** _"show me the SPEC section for that region."_

### 3. Three strikes, then stop

A failing region that has not improved across 3+ gate runs does not get a fourth
attempt. Present the attempts. Never widen the threshold, add a mask, or
reclassify it as a floor to make it go away.

**Check:** \`node matching/strikes.mjs <page>\` — exits 1 while any region is
stalled, and is the first thing a geometry round runs.
**Operator's challenge:** _"how many runs has that region been flat?"_

### 4. A gate closes an item, nothing else

No fix is "done" because the code changed. Paste the gate header — it is
self-describing, so a nonstandard threshold or an undisclosed mask is visible.
The threshold and the matrix are whatever \`matching/harness.json\` says, on every
page, never a subset.

**Operator's challenge:** _"paste the gate header."_

### 5. A commit is a checkpoint, not a stopping point

Do not hand control back between rounds. After committing, run
\`node matching/next.mjs\`: while it exits 1 there is a named next action, and the
round continues. Report when the backlog is empty, when a decision is genuinely
the operator's (three strikes, a novel floor, a threshold change), or when
asked — not because a commit felt like a natural place to summarise.

This exists because the failure was habitual, not deliberate: a turn ends when
user-facing prose gets written, and "I just committed something good" is the
moment that invites writing it. The gate stops incorrect work; this stops
premature stopping.

**Pausing:** create \`matching/PAUSED\` holding a note that says what the pause
means; \`next.mjs\` and \`strikes.mjs\` then exit 0 while it exists. This rule says
"do not stop while work is named"; it never said "find work to name". An empty
agenda and a paused one end the round the same way. Deleting the switch is the
operator's call.

**Check:** \`node matching/next.mjs\` — exits 1 while any non-floor region fails.
**Operator's challenge:** _"what does next.mjs say?"_

### Round protocol

1. \`node matching/strikes.mjs <page>\` — if it exits 1, the stalled regions are
   the agenda, and stalled ones get escalated rather than re-attempted.
2. Confirm the page has a \`matching/SPEC.md\` section; write
   \`matching/spec-sections/<page>.md\` and run \`node matching/build-spec.mjs\` if
   not.
3. Fix, each change citing its source line.
4. \`bash matching/gate.sh <tag> <page>\` — paste the header.
5. Append to \`matching/LEDGER.md\` at the moment a deviation, floor or mask is
   decided, not reconstructed at the end.
6. \`pnpm verify\`, then commit and push.
`;

/** Block BODIES previously shipped per target file, for the three marked
 *  regions in `.gitignore`, `.prettierignore` and `CLAUDE.md`. */
export const MATCH_HARNESS_BLOCK_PREVIOUS: Readonly<Record<string, readonly string[]>> = {
  "CLAUDE.md": [CLAUDE_MD_BLOCK_0_95_1],
};
