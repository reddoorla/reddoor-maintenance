/**
 * The Airtable WRITE seam for the site-status vocabulary.
 *
 * The vocabulary itself — `Status`, `CANONICAL_STATUSES`, `canonicalizeStatus`,
 * `isCanonicalStatus` — moved to `src/fleet/site-status.ts` in #539 Phase 6 step 1
 * (#646): `canonicalizeStatus` runs on every Turso lead read, so it cannot live in
 * the directory Phase 6 deletes. It is re-exported here so existing Airtable-layer
 * imports keep resolving unchanged; only `toAirtableStatus`, which exists solely
 * to write an Airtable cell, stays behind and goes with the layer.
 */
import type { Status } from "../../fleet/site-status.js";

export {
  CANONICAL_STATUSES,
  canonicalizeStatus,
  isCanonicalStatus,
  type Status,
} from "../../fleet/site-status.js";

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
