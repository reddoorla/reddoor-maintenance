/** #612 (#539 Phase 5): the one switch that says which store is allowed to fail.
 *
 *  ## Why a switch exists at all
 *
 *  Through Phase 5 the mirrors are best-effort by design: Airtable is
 *  authoritative, so a Turso write that fails is caught, logged and swallowed,
 *  and the hourly `fleet-db-sync` import converges whatever it missed. That is
 *  correct — right up until the freeze stops the import.
 *
 *  After that, nothing converges anything. The same swallowed failure becomes
 *  permanent data loss announced only by a log line nobody is grepping. Three
 *  outcomes change meaning at the flip:
 *
 *  | outcome           | before the freeze              | after                        |
 *  |-------------------|--------------------------------|------------------------------|
 *  | `mirrored=0`      | the sync will fix it           | that write is gone           |
 *  | `mirrored=missed` | the site isn't imported yet    | impossible, therefore a bug  |
 *  | `mirrored=absent` | no creds; Airtable still has it| every write was discarded    |
 *
 *  So the freeze is not a config change. It is: invert which store is allowed
 *  to fail.
 *
 *  ## Why a code constant rather than an env var
 *
 *  The same built artifact runs in Netlify functions and in Actions runners. An
 *  env var could be set in one and missed in the other, giving a PARTIAL freeze
 *  — half the fleet treating Turso as authoritative and half not — which is a
 *  worse state than either end. A constant is uniform by construction, and
 *  flipping it is a one-line pull request with a diff a reviewer can see.
 *
 *  This is the same shape the site-status vocabulary migration used: code
 *  handles both worlds, then one reviewed commit flips the switch.
 *
 *  ## Reading this correctly
 *
 *  Consumers take it as a DEFAULT parameter rather than reading it inline, so
 *  tests can exercise both sides as fixtures. Exactly one test asserts the
 *  shipped value; every behavioural test injects. A suite that only ever read
 *  the shipped constant would prove nothing about the state it is not in.
 */

/** `false` until the freeze. Flipping this to `true` is the freeze: Turso
 *  becomes the store that must succeed, and the Airtable write becomes the
 *  best-effort shadow kept for the one-week rollback window.
 *
 *  Do not flip it before the hourly import is stopped — with the import still
 *  running, a strict mirror would fail runs over rows the import was about to
 *  reconcile anyway. */
export const TURSO_IS_AUTHORITATIVE = false;
