/**
 * The site-status vocabulary — ONE module owns it (#539 Phase 4).
 *
 * The fleet's lifecycle names were inherited from an Airtable single-select
 * written by hand years ago ("probably not our problem"). The operator approved
 * a canonical vocabulary, and the migration is now COMPLETE in both stores:
 * Airtable's "Status" single-select carries exactly the six canonical options
 * and nothing else. This module no longer knows the old names at all.
 *
 * The retired mapping, kept as the record of what was merged into what:
 *
 *   old (retired 2026-08-25)    new (canonical)
 *   ─────────────────────────   ───────────────
 *   in development              building
 *   launch period               launching
 *   maintenance                 maintained
 *   hosting                     hosted-only
 *   probably not our problem    external
 *   legacy                    ┐
 *   deprecated                ┴ archived        ← approved MERGE, many-to-one
 *
 * `legacy` and `deprecated` were already treated identically by every PREDICATE
 * (ARCHIVED_STATUSES held both), so collapsing them changes no *selection* — no
 * fleet op gains or loses a site. It is NOT true that collapsing them changes
 * nothing at all, and one surface proved it: the cockpit's Archived lane LABELS
 * each row with its Status cell, and canonicalizing there rendered all 12 live
 * archived rows as "archived". That lane now labels from `statusRaw`, which is
 * exactly why `WebsiteRow.statusRaw` exists. The rule this leaves behind:
 * canonical values decide BEHAVIOUR; anything DISPLAYING a Status cell, or
 * writing one back, uses the raw cell.
 *
 * The merge had NO clean reverse map while both vocabularies coexisted, which
 * is why `toAirtableStatus` had to pick one archived name deliberately. With the
 * old names retired there is nothing left to pick between, and no code path
 * feeds operator-supplied text through it anyway (see
 * `src/recipes/forms-notify-target.ts`, which writes `--restore` verbatim).
 *
 * THE SHAPE OF THE TRANSITION (three stages):
 *
 *   stage 1 (DONE)  code speaks the NEW vocabulary internally; reads canonicalize
 *                   at the two Airtable/Turso seams; writes still emit the OLD
 *                   Airtable option names. Airtable untouched. No SELECTION
 *                   change — every predicate picks exactly the sites it picked
 *                   before (pinned row-by-row in tests/reports/airtable/
 *                   site-status.test.ts). Displayed labels come from `statusRaw`.
 *   stage 2 (DONE)  the Airtable "Status" single-select gained the 6 new options
 *                   and all 44 cells were migrated (verified live: maintained=13,
 *                   archived=12, external=9, building=6, hosted-only=2,
 *                   launching=2 — zero old values, zero unrecognized), `db sync`
 *                   ran clean (mismatches=0), and AIRTABLE_USES_NEW_VOCABULARY
 *                   flipped to true. Writers now emit canonical names verbatim.
 *                   The alias map STAYS: the 7 old options still exist in the
 *                   field, so a human can still pick one in the Airtable UI.
 *   stage 3 (DONE)  the operator deleted the 7 old options from the Airtable
 *                   "Status" field on 2026-08-25, which is what made this safe:
 *                   the gate was always "no old value CAN BE ENTERED", not
 *                   merely "none is stored". Verified against the live base
 *                   before any code changed — the field carries exactly the six
 *                   canonical choices, byte-exact, and all 44 cells still hold a
 *                   canonical value with ZERO blanks (deleting a single-select
 *                   option CLEARS the cells using it, so "no cell was blanked"
 *                   was checked, not assumed). AIRTABLE_STATUS_ALIASES,
 *                   AIRTABLE_OLD_NAMES and AIRTABLE_USES_NEW_VOCABULARY are
 *                   gone; both functions reduce to the identity.
 *
 * WHAT CHANGED IN BEHAVIOUR AT STAGE 3, and it is the only thing that did: an
 * old name is no longer translated. `canonicalizeStatus("maintenance")` used to
 * yield `maintained`; it now yields `"maintenance"` verbatim, which
 * `isUnrecognizedStatus` flags and the cockpit surfaces as a watch row. That is
 * intended. The option cannot be selected any more, so a stored old value would
 * mean something went wrong — a restored backup, a scripted write, an API
 * caller with a stale constant — and the fleet should say so rather than absorb
 * it into a status nobody chose.
 *
 * Canonicalization happens on READ, never at rest: `src/db/import-airtable.ts`
 * still stores the raw Airtable cell verbatim in `sites.status`, so the hourly
 * parity check keeps comparing raw-to-raw and the importer stays honest to its
 * source. Both readers — `mapRow` (Airtable) and `rowFromJoined` (Turso) — run
 * the raw value through `canonicalizeStatus`, which is what keeps the #558
 * reader-equivalence instrument green.
 */

/** The canonical site lifecycle vocabulary. */
export type Status =
  "building" | "launching" | "maintained" | "hosted-only" | "external" | "archived";

/** Every canonical status, in lifecycle order. The order is load-bearing: the
 *  dashboard status editor renders its options from it, and stage 1 must leave
 *  that dropdown byte-identical. */
export const CANONICAL_STATUSES: readonly Status[] = [
  "building",
  "launching",
  "maintained",
  "hosted-only",
  "external",
  "archived",
] as const;

const CANONICAL_SET: ReadonlySet<string> = new Set<string>(CANONICAL_STATUSES);

/**
 * Map a raw Status cell (Airtable field value, or the `sites.status` column) to
 * the canonical vocabulary. Applied at BOTH read seams so the rest of the code
 * only ever sees canonical names.
 *
 * Three deliberate non-obvious behaviours, each protecting an existing invariant:
 *
 *  - ABSENT ONLY yields null. A cell that is present but empty (`""`) comes back
 *    as `""`, not null, because `due.ts`/`preflight.ts` treat a null status as
 *    eligible-by-default — nulling anything non-absent would silently ACTIVATE
 *    the row for scheduled client reports.
 *  - An unrecognized value is returned VERBATIM (blind-cast to Status, exactly as
 *    `mapRow` did before this module existed) so `isUnrecognizedStatus` still
 *    flags it and the cockpit still surfaces it as a watch row. Since stage 3
 *    that INCLUDES the seven retired names: `maintenance` is now as unrecognized
 *    as `maintenence`, which is the point — it can no longer be entered, so its
 *    reappearance is an anomaly to surface, not a spelling to absorb.
 *  - No trimming or case-folding. `"maintained "` stays unrecognized, which is
 *    what `isUnrecognizedStatus` has always been documented to catch ("typo /
 *    renamed option / stray whitespace"). Normalizing here would silence it.
 *
 * With the alias map gone this is the identity on every string, so `status` and
 * `statusRaw` now hold the same value for any present cell. The two fields are
 * kept distinct deliberately — the read/display split is the architecture that
 * made this migration survivable, and collapsing it would have to be undone the
 * next time Airtable's vocabulary and the code's diverge.
 */
export function canonicalizeStatus(raw: unknown): Status | null {
  if (typeof raw !== "string") return null;
  // Canonical values pass through; so does anything else, unchanged — see above.
  return raw as Status;
}

/**
 * The string to WRITE into the Airtable "Status" cell for a canonical status.
 * Every writer of a CODE-OWNED status routes through here.
 *
 * Since stage 3 this is the identity: Airtable's single-select carries exactly
 * the six canonical options, so the canonical name IS the option name. It is
 * kept as a named seam rather than inlined because it is the one place a future
 * divergence between the code's vocabulary and Airtable's would be expressed,
 * and because every writer already routes through it — inlining would scatter
 * that decision across `ensureSite`, `updateLaunched`, `forms-notify-target`
 * and the dashboard status save.
 *
 * The stage-1/2 hazard it used to carry is GONE: while a many-to-one map
 * existed, `toAirtableStatus(canonicalizeStatus(x))` was not the identity —
 * feeding it "legacy" yielded "deprecated", silently writing an option the
 * operator never asked for. Both functions are now the identity, so that trap
 * no longer exists. `forms-notify-target --restore` still writes operator text
 * verbatim (`restoreCell`) rather than routing through here, which remains the
 * right shape: operator free text is not a canonical status.
 */
export function toAirtableStatus(s: Status): string {
  return s;
}

/** True when `s` is one of the canonical statuses (not a blind-cast typo). */
export function isCanonicalStatus(s: string): s is Status {
  return CANONICAL_SET.has(s);
}
