#!/usr/bin/env bash
# The matching gate. This file is generic — everything specific to a site lives
# in matching/harness.json (the data) and matching/LEDGER.md (the why). It is
# installed and upgraded by the `reddoor-maint match-harness` recipe, which
# owns these bytes: a hand edit here is flagged on the next run, never
# silently overwritten.
#
#   bash matching/gate.sh <round-tag> [page ...]
#
# Runs page-diff for every page in the table (or just the named ones) at the
# full breakpoint matrix and writes matching/out-<round-tag>-<page>/.
#
# The matrix, the anchor lists, the reference and the candidate are DATA. Why a
# site chose them — which live breakpoint band hid what, why an anchor is a
# heading and not a button label — belongs in matching/LEDGER.md, which is dated
# and append-only, because JSON holds no comments.
#
# NO MASKS and the threshold from harness.json everywhere: the numbers stay
# honest and a known floor stays visible as its own region. A media-neutralised
# secondary read is `node "$PD" ... --neutralize-media`; next.mjs ignores such
# runs on purpose (next.mjs:57-64).
#
# PREFLIGHT (see the matching rules in CLAUDE.md): a page with no section in
# matching/SPEC.md has not had Phase 1 done, and its geometry must not be
# touched. Skipping the spec is how a reference's root-font ladder and its
# per-component height ladders get found reactively, after the region has
# already failed several rounds. This refuses the run instead of trusting anyone
# to remember.
set -u
# Everything configurable lives in matching/harness.json; harness.mjs is the one
# reader. --env emits shell-safe assignments (REF, CAND, MATRIX, VIEWPORTS_SP,
# THRESHOLD, MAX_HEIGHT_DELTA, PD, SC, REPORT_SCHEMA).
eval "$(node "$(dirname "$0")/harness.mjs" --env)"

# The skill must be able to write reports this site's scripts can read. Cheap,
# local, and it fails before any browser starts.
PD_SCHEMA="$(node "$PD" --version 2>/dev/null | awk '{print $4}')"
if [ "$PD_SCHEMA" != "$REPORT_SCHEMA" ]; then
  echo "gate.sh: page-diff writes report schema '${PD_SCHEMA:-none}', this harness reads $REPORT_SCHEMA." >&2
  echo "         Update matching/harness.mjs REPORT_SCHEMA or the matching-a-page skill." >&2
  exit 2
fi
SPEC="$(dirname "$0")/SPEC.md"
TAG="${1:?usage: gate.sh <round-tag> [page ...]}"
# The tag must not contain a hyphen. Output dirs are "out-<TAG>-<page>", and
# next.mjs recovers the page with /^out-[^-]+-(.+)$/ — it splits on the FIRST
# hyphen, so a tag like "r-forms-2026-08-07" yields the page key
# "forms-2026-08-07-yfv" and that run is silently never counted. It cannot split
# on the last hyphen instead, because page keys have hyphens of their own
# ("our-team", "ask-the-doctor"). Failing here is the cheap end of that: a
# mis-tagged round otherwise LOOKS green because next.mjs keeps reading an older
# report for the page you just changed. (Cost this once, 2026-08-07.)
case "$TAG" in
  *-*)
    echo "gate.sh: round tag must not contain a hyphen (got '$TAG')." >&2
    echo "         out-<TAG>-<page> is parsed on the first hyphen, so a" >&2
    echo "         hyphenated tag hides the run from next.mjs. Try '${TAG//-/}'." >&2
    exit 2
    ;;
esac
shift || true
WANT=("$@")

# Fail closed on the reference before spending a single run. A 200 is NOT
# evidence: a production host that has cut over to OUR build answers 200, and
# every region then scores near zero against itself. --check-ref requires an
# artefact only the reference serves (harness.json refMark) and refuses a
# redirect, a host listed in selfHosts, and a body carrying candMark. Measured
# on the site this harness was cut from, 2026-09-09 AFTER the consolidation:
# 12 of its 214 top-level matching scripts still assign REF a host listed in
# selfHosts — i.e. compare the candidate with itself. It was 33 of 229 before.
# (This comment read "33 of its 230" while sitting in the post-consolidation
# tree, contradicting harness.mjs's 12 three files away.)
if ! node "$(dirname "$0")/harness.mjs" --check-ref; then
  echo "gate.sh: refusing to gate against an unverified reference." >&2
  exit 2
fi

# Set SPEC_OPTIONAL=1 only for a read-only baseline sweep of pages you are not
# about to edit. It is recorded in the round tag so the exemption is visible.
SPEC_OPTIONAL="${SPEC_OPTIONAL:-0}"

has_spec() { # page
  # NB: the obvious `( |$|\b)` guard is rejected by ugrep as an empty
  # subexpression, and a preflight that errors out fails CLOSED — it refused all
  # 9 pages while SPEC.md was complete. Match the page key followed by any
  # non-key character (so `## team` matches but `## teamfoo` does not; `##
  # our-team` cannot match `team` because the key must follow the spaces).
  [ -f "$SPEC" ] && grep -qE "^##+ +$1([^A-Za-z0-9_-]|$)" "$SPEC"
}

run() { # tag refpath candpath sections
  local page="$1" refpath="$2" candpath="$3" sections="$4"
  if [ ${#WANT[@]} -gt 0 ]; then
    local hit=0
    for w in "${WANT[@]}"; do [ "$w" = "$page" ] && hit=1; done
    [ $hit -eq 1 ] || return 0
  fi
  if ! has_spec "$page"; then
    if [ "$SPEC_OPTIONAL" = "1" ]; then
      echo "########## $page ##########"
      echo "WARNING: no '## $page' section in matching/SPEC.md — Phase 1 not done."
      echo "         Running anyway because SPEC_OPTIONAL=1 (baseline read only)."
      echo "         Do NOT apply geometry fixes off this run."
    else
      echo "########## $page ##########"
      echo "REFUSED: no '## $page' section in matching/SPEC.md."
      echo "         Phase 1 (section census + per-section spec, read from"
      echo "         matching/spec/) comes before geometry."
      echo "         See CLAUDE.md rule 2. SPEC_OPTIONAL=1 for a baseline read."
      FAILED_PREFLIGHT=1
      return 0
    fi
  fi
  echo "########## $page ##########"
  node "$PD" --ref "$REF$refpath" --cand "$CAND$candpath" \
    --viewports "$MATRIX" --threshold "$THRESHOLD" \
    --sections "$sections" --out "matching/out-$TAG-$page" \
    > "matching/out-$TAG-$page.log" 2>&1
  echo "$page exit=$?"
}

# The page table is matching/harness.json. Process substitution, NOT a pipe:
# a pipe would run this loop in a subshell and FAILED_PREFLIGHT would not
# survive to the check below, so a refused page would exit 0.
while IFS=$'\t' read -r key refpath candpath anchors; do
  run "$key" "$refpath" "$candpath" "$anchors"
done < <(node "$(dirname "$0")/harness.mjs" --table)

if [ "${FAILED_PREFLIGHT:-0}" = "1" ]; then
  echo
  echo "GATE INCOMPLETE ($TAG) — one or more pages were refused for a missing"
  echo "SPEC.md section. Those pages have NOT been measured; do not report a"
  echo "score for them."
  exit 2
fi
echo "ALL DONE ($TAG)"
