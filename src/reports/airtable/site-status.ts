/**
 * The site-status vocabulary — ONE module owns it (#539 Phase 4).
 *
 * The fleet's lifecycle names were inherited from an Airtable single-select
 * written by hand years ago ("probably not our problem"). The operator approved
 * a canonical vocabulary; this module is the only place that knows BOTH, so the
 * rename could land in code without touching Airtable.
 *
 *   old (Airtable today)        new (canonical)
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
 * The merge also means there is NO clean reverse map. Nothing here pretends
 * otherwise: `toAirtableStatus` picks one archived name deliberately and says
 * why, and no code path feeds operator-supplied text through it (see
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
 *   stage 3 (TODO)  delete the 7 old options from the Airtable "Status" field,
 *                   then delete — in this file — AIRTABLE_STATUS_ALIASES,
 *                   AIRTABLE_OLD_NAMES, and the now-dead
 *                   AIRTABLE_USES_NEW_VOCABULARY branch in `toAirtableStatus`
 *                   (which reduces to the identity). Only safe once no old value
 *                   can be entered, not merely once none is stored.
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

/**
 * Old Airtable single-select value → canonical status. Lives only for the
 * transition window (deleted at stage 3). Many-to-one by design: `legacy` and
 * `deprecated` both land on `archived`.
 *
 * Still load-bearing AFTER the stage-2 migration. No stored cell uses these
 * names any more, but the 7 old options remain in the field until stage 3, so a
 * human can still select one in the Airtable UI — and reads must keep
 * tolerating that. Delete this only together with the options themselves.
 */
export const AIRTABLE_STATUS_ALIASES: Readonly<Record<string, Status>> = {
  "in development": "building",
  "launch period": "launching",
  maintenance: "maintained",
  hosting: "hosted-only",
  "probably not our problem": "external",
  legacy: "archived",
  deprecated: "archived",
};

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
 *    flags it and the cockpit still surfaces it as a watch row.
 *  - No trimming or case-folding. `"maintenance "` stays unrecognized, which is
 *    what `isUnrecognizedStatus` has always been documented to catch ("typo /
 *    renamed option / stray whitespace"). Normalizing here would silence it.
 */
export function canonicalizeStatus(raw: unknown): Status | null {
  if (typeof raw !== "string") return null;
  const alias = AIRTABLE_STATUS_ALIASES[raw];
  if (alias) return alias;
  // Canonical values pass through; so does anything else, unchanged — see above.
  return raw as Status;
}

/**
 * THE stage-2 switch, now FLIPPED. While it was false, every write emitted the
 * OLD Airtable option names, because the "Status" single-select did not yet carry
 * the new options — writing an unknown option would be rejected or (with typecast
 * on) silently create a duplicate option beside the real one.
 *
 * The new options were added and all 44 cells migrated before this flipped, so
 * every write now lands on an option that exists. Flipping it was the entire code
 * side of stage 2.
 *
 * Stage 3 deletes this constant along with the `false` branch it guards.
 */
export const AIRTABLE_USES_NEW_VOCABULARY = true;

/**
 * Canonical status → the OLD Airtable option name. Only consulted while
 * AIRTABLE_USES_NEW_VOCABULARY is false — which, since the stage-2 flip, is
 * never. This map is DEAD CODE kept only so the flip stays a one-line revert
 * while stage 3 is pending; stage 3 deletes it outright.
 *
 * The rationale below describes the stage-1 behaviour it used to drive, and is
 * retained because it explains why `archived` mapped to "deprecated" — the pick a
 * revert would resurrect.
 *
 * `archived` is the many-to-one case and needs a deliberate pick. It is
 * "deprecated" because that — not "legacy" — is the archived option the dashboard
 * status editor has always offered (`SITE_STATUS_OPTIONS`, whose own comment
 * notes that "legacy" is set directly in Airtable, never from the dashboard).
 * Writing back exactly what the editor offers keeps that dropdown, and the value
 * it POSTs, byte-identical this stage. It is the ONLY code path that can write an
 * archived status: `updateLaunched` writes `maintained`, `ensureSite` writes
 * `building`, and `forms-notify-target --set on` writes `launching`. Its
 * `--set off --restore <x>` path does NOT come through here — it writes the
 * operator's string verbatim, precisely so this many-to-one pick can never be
 * applied to a value a human typed.
 */
const AIRTABLE_OLD_NAMES: Readonly<Record<Status, string>> = {
  building: "in development",
  launching: "launch period",
  maintained: "maintenance",
  "hosted-only": "hosting",
  external: "probably not our problem",
  archived: "deprecated",
};

/**
 * The string to WRITE into the Airtable "Status" cell for a canonical status.
 * Every writer of a CODE-OWNED status routes through here.
 *
 * It must NOT be handed operator free text. `archived` is many-to-one, so
 * `toAirtableStatus(canonicalizeStatus(x))` is not the identity — feeding it
 * "legacy" yields "deprecated", silently writing an option the operator never
 * asked for and which no `git revert` can undo. `forms-notify-target --restore`
 * is the one operator-text path and it writes verbatim instead (`restoreCell`).
 *
 * An unknown blind-cast value still passes through verbatim, so a caller that
 * ignores the rule above degrades to "let Airtable reject it" rather than to a
 * substitution.
 */
export function toAirtableStatus(s: Status): string {
  if (AIRTABLE_USES_NEW_VOCABULARY) return s;
  return AIRTABLE_OLD_NAMES[s] ?? (s as string);
}

/** True when `s` is one of the canonical statuses (not a blind-cast typo). */
export function isCanonicalStatus(s: string): s is Status {
  return CANONICAL_SET.has(s);
}
