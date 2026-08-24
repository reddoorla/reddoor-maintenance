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
 * `legacy` and `deprecated` were already treated identically everywhere
 * (ARCHIVED_STATUSES held both), so collapsing them changes no behaviour — but
 * it does mean there is NO clean reverse map. Nothing here pretends otherwise:
 * `toAirtableStatus` picks one archived name deliberately and says why.
 *
 * THE SHAPE OF THE TRANSITION (three stages):
 *
 *   stage 1 (this)  code speaks the NEW vocabulary internally; reads canonicalize
 *                   at the two Airtable/Turso seams; writes still emit the OLD
 *                   Airtable option names. Airtable untouched. No behaviour change.
 *   stage 2         add the new options to the Airtable single-select, migrate the
 *                   cells, and flip AIRTABLE_USES_NEW_VOCABULARY to true — ONE
 *                   constant. The alias map stays, so a not-yet-migrated cell keeps
 *                   reading correctly throughout.
 *   stage 3         once no old value survives in Airtable, delete the alias map.
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
 * THE stage-2 switch. While false, every write emits the OLD Airtable option
 * names, because the "Status" single-select does not yet carry the new options —
 * writing an unknown option would be rejected or (with typecast on) silently
 * create a duplicate option beside the real one.
 *
 * Flipping this to true is the entire code side of stage 2.
 */
export const AIRTABLE_USES_NEW_VOCABULARY = false;

/**
 * Canonical status → the OLD Airtable option name. Only consulted while
 * AIRTABLE_USES_NEW_VOCABULARY is false.
 *
 * `archived` is the many-to-one case and needs a deliberate pick. It is
 * "deprecated" because that — not "legacy" — is the archived option the dashboard
 * status editor has always offered (`SITE_STATUS_OPTIONS`, whose own comment
 * notes that "legacy" is set directly in Airtable, never from the dashboard).
 * Writing back exactly what the editor offers keeps that dropdown, and the value
 * it POSTs, byte-identical this stage. It is the ONLY code path that can write an
 * archived status: `updateLaunched` writes `maintained`, `ensureSite` writes
 * `building`, and `forms-notify-target` writes `launching` (or an
 * operator-supplied `--restore` value).
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
 * Every writer routes through here.
 *
 * An unknown blind-cast value passes through verbatim: `forms-notify-target
 * --restore <status>` takes operator free text, and turning a typo into a silent
 * substitution would be worse than letting Airtable reject it, which is what
 * happens today.
 */
export function toAirtableStatus(s: Status): string {
  if (AIRTABLE_USES_NEW_VOCABULARY) return s;
  return AIRTABLE_OLD_NAMES[s] ?? (s as string);
}

/** True when `s` is one of the canonical statuses (not a blind-cast typo). */
export function isCanonicalStatus(s: string): s is Status {
  return CANONICAL_SET.has(s);
}
