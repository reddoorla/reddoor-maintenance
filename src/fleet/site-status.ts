/**
 * The site-status vocabulary — ONE module owns it (#539 Phase 4).
 *
 * The operator approved a canonical vocabulary; this module no longer knows the
 * old names at all.
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
 * An old name is not translated: `canonicalizeStatus("maintenance")` yields
 * `"maintenance"` verbatim, which `isUnrecognizedStatus` flags and the cockpit
 * surfaces as a watch row. That is intended. The option cannot be selected any
 * more, so a stored old value would mean something went wrong — a restored
 * backup, a scripted write, an API caller with a stale constant — and the fleet
 * should say so rather than absorb it into a status nobody chose.
 *
 * Canonicalization happens on READ, never at rest: `sites.status` holds the raw
 * cell verbatim. Both readers — `mapRow` (`src/fleet/site-fields.ts`) and
 * `rowFromJoined` (Turso) — run the raw value through `canonicalizeStatus`,
 * which is what keeps the #558 reader-equivalence instrument green.
 */

/** The canonical site lifecycle vocabulary. */
export type Status =
  "building" | "launching" | "maintained" | "hosted-only" | "external" | "archived";

/** Every canonical status, in lifecycle order. The order is load-bearing: the
 *  dashboard status editor renders its options from it. */
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
 * Map a raw Status cell (a record's field value, or the `sites.status` column) to
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
 *    flags it and the cockpit still surfaces it as a watch row. That INCLUDES
 *    the seven retired names: `maintenance` is now as unrecognized
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
 * next time the stored vocabulary and the code's diverge.
 */
export function canonicalizeStatus(raw: unknown): Status | null {
  if (typeof raw !== "string") return null;
  // Canonical values pass through; so does anything else, unchanged — see above.
  return raw as Status;
}

/** True when `s` is one of the canonical statuses (not a blind-cast typo). */
export function isCanonicalStatus(s: string): s is Status {
  return CANONICAL_SET.has(s);
}
