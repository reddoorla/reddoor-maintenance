#!/usr/bin/env bash
# Phase 3 style gate — the mechanical net for the type spec.
#
#   bash matching/census.sh            # all 9 pages, all 3 viewports
#   bash matching/census.sh home yfv   # just these
#
# style-census diffs the computed type tuple (family, weight, size,
# line-height, letter-spacing, transform, colour) of every text snippet present
# on BOTH pages. It is the only gate that catches the 11px footer line and the
# cyan-vs-teal link that page-diff is structurally blind to — a region can be
# pixel-clean at 0.10 and still be wearing the wrong colour on small text.
#
# Prints a per-page/per-viewport mismatch count and leaves the full runs in
# matching/census-<page>-<vw>.log. Exits 1 while any count is non-zero, and 2
# when it cannot honestly report a count at all.
#
# EVIDENCE — read before adding a guard here, or removing one. A green here
# has to be produced by a census that RAN. It was not: with style-census.mjs
# absent this gate printed "Phase 3 CLEAN — 0 undeclared type mismatches" and
# exited 0. Every run died on module resolution, census-count.mjs read each
# crash log as "0 0 0" (it counts `  y=` rows and a stack trace has none —
# census-count.mjs:35-56), and no rows was reported as no mismatches. Measured
# again with style-census.mjs PRESENT and the candidate host down: identical
# output, because style-census exits 1 both when it finds mismatches
# (style-census.mjs:187) and when it dies before it looks — so the exit status
# cannot tell a finding from a crash and may not grant a green either.
#
# The guards below are what next.mjs:83-89 (no parseable gate run — refusing to
# report a score), strikes.mjs:87-97 (refusing to report "clear") and
# gate.sh:37-42 (preflight page-diff before spending a run) already do. Each
# demands an artefact only a working census produces; none of them can turn a
# red green.
set -uo pipefail
# Resolved BEFORE the cd. $0 is the path as TYPED, so a relatively invoked
# census.sh that resolved the harness afterwards would look for it under
# whatever root the cd landed on.
HARNESS="$(cd "$(dirname "$0")" && pwd)/harness.mjs"
cd "$(dirname "$0")/.."

# Everything configurable lives in matching/harness.json; harness.mjs is the one
# reader. --env supplies REF, CAND, SC and VIEWPORTS_SP — this gate held its own
# copy of all four, and its REF went stale when production cut over to our own
# build (LEDGER "REFERENCE MOVED", verified 2026-08-10) while gate.sh's was
# repointed the same day.
eval "$(node "$HARNESS" --env)"
NODE="${NODE:-node}"

# The matrix is DATA, read as VIEWPORTS_SP, the way gate.sh reads MATRIX. The
# old VIEWPORTS override is retired rather than silently ignored: a census run
# over a matrix harness.json does not name is a column set the pixel gate never
# measured, and it would look exactly like a clean one.
if [ -n "${VIEWPORTS:-}" ]; then
  echo "census.sh: the VIEWPORTS override is retired — the matrix is data now." >&2
  echo "           Edit \"matrix\" in matching/harness.json, then unset it." >&2
  exit 2
fi

# GUARD 1 — the tool is there and it starts. gate.sh compares `page-diff
# --version` with the harness's REPORT_SCHEMA before spending a run
# (gate.sh:37-42); style-census has no --version to compare (page-diff.mjs
# defines one at 191-195; nothing in style-census.mjs writes one), so the
# artefact demanded here is the other one only it produces: the usage banner it
# prints on exit 2 when --ref/--cand are missing (style-census.mjs:151-157).
# That banner is not free — `import { chromium } from "playwright"` runs first
# (style-census.mjs:19) — so a skill directory with no playwright installed
# fails HERE, once, instead of writing one crash log per page per viewport that
# every reader downstream counts as zero.
if [ ! -f "$SC" ]; then
  echo "census.sh: no style-census at $SC — refusing to report a count." >&2
  echo "           Install the matching-a-page skill, or point MATCHING_SKILL_DIR" >&2
  echo "           at a checkout that has style-census.mjs." >&2
  exit 2
fi
SC_USAGE="$("$NODE" "$SC" 2>&1)"
case "$SC_USAGE" in
  *"style-census"*"--ref"*"--cand"*"--vw"*) ;;
  *)
    echo "census.sh: $SC did not answer with a style-census --ref/--cand/--vw usage" >&2
    echo "           banner — refusing to report a count. It printed:" >&2
    echo "           ${SC_USAGE:-(nothing at all)}" >&2
    exit 2
    ;;
esac

declare -a WANT=("$@")

# page -> "refpath candpath": the same table gate.sh drives, from the same file.
# cut drops the anchors column, which the style census has no argument for
# (style-census.mjs: --ref <url> --cand <url> [--vw 1440]).
pages() { node "$HARNESS" --table | cut -f1-3; }

TOTAL=0
AMB=0
DECL=0
ROWS=0
RUNS=0
BROKEN=0
SEEN=""
# One column per viewport, from the matrix. Flush with the data rows below, at
# last: the old header hardcoded four fixed fields separated by a literal space,
# which the rows do not have, so its labels sat 1/2/3 columns right of them.
printf '%-10s' page
for vw in $VIEWPORTS_SP; do printf '%8s' "$vw"; done
printf '\n'
while read -r page refpath candpath; do
  [ -z "$page" ] && continue
  SEEN="$SEEN $page"
  if [ ${#WANT[@]} -gt 0 ]; then
    hit=0
    for w in "${WANT[@]}"; do [ "$w" = "$page" ] && hit=1; done
    [ $hit -eq 1 ] || continue
  fi
  ROWS=$((ROWS + 1))
  line=$(printf '%-10s' "$page")
  for vw in $VIEWPORTS_SP; do
    log="matching/census-$page-$vw.log"
    RUNS=$((RUNS + 1))
    "$NODE" "$SC" --ref "$REF$refpath" --cand "$CAND$candpath" --vw "$vw" >"$log" 2>&1
    # GUARD 2 — this run produced a census. The header and the counts line are
    # written together at style-census.mjs:166-169 and only after both pages
    # have been walked, so they are the artefact a completed run leaves and a
    # crashed one cannot. The viewport is read back out of the header because a
    # --vw that did not take would otherwise fill three differently named logs
    # with the same 1440 census. `ref runs`/`cand runs` must be non-zero: two
    # pages that rendered no text at all agree perfectly and mean nothing.
    if ! grep -qE "^=== style census, viewport $vw ===\$" "$log" ||
      ! grep -qE "^ref runs: [1-9][0-9]* +cand runs: [1-9][0-9]* +mismatches: [0-9]+ +ambiguous: [0-9]+\$" "$log"; then
      BROKEN=$((BROKEN + 1))
      echo "census.sh: $page @$vw produced no usable census — see $log" >&2
      line="$line$(printf '%8s' '!!')"
      continue
    fi
    # census-count splits the log three ways: REAL mismatches, AMBIGUOUS
    # same-text collisions (style-census's own split), and DECLARED rows the
    # operator has already ruled on (matching/census-deviations.mjs, the same
    # contract as floors.mjs). Only the first is outstanding work — without the
    # third, this gate can never reach zero and its number means nothing.
    read -r n a d <<<"$("$NODE" matching/census-count.mjs "$log")"
    # GUARD 2b — three integers, or the counter did not count. census-count.mjs
    # is the reader that turned a stack trace into "0 0 0"; a run of it that
    # dies (a broken census-deviations.mjs, a bad path) prints nothing at all,
    # and bash reads an empty $n as zero in the arithmetic below.
    counted=1
    for v in "${n:-}" "${a:-}" "${d:-}"; do
      case "$v" in "" | *[!0-9]*) counted=0 ;; esac
    done
    if [ "$counted" -eq 0 ]; then
      BROKEN=$((BROKEN + 1))
      echo "census.sh: census-count.mjs did not return three counts for $log" >&2
      line="$line$(printf '%8s' '!!')"
      continue
    fi
    # GUARD 2c — the number reported is the number the census MEASURED. GUARD 2
    # matched the counts line for PRESENCE and threw its numbers away, so the
    # count printed below came from census-count's row parse and nothing ever
    # compared the two. Measured 2026-09-09: a COMPLETE census whose counts line
    # said "mismatches: 3", whose `y=` rows carried one leading space instead of
    # two (census-count.mjs:39 matches /^ {2}y=/), was reported as 0 and this
    # gate printed "Phase 3 CLEAN — 0 undeclared type mismatches", exit 0. The
    # printer lives in the SKILL (style-census.mjs:171-173) and the parser is
    # copied into every site, so the two version independently and drift needs
    # nobody to touch either repo.
    #
    # The identity is exact for mismatches: style-census prints at most 100 rows
    # and states the remainder on its own line (style-census.mjs:175-177), so
    # parsed + remainder == reported. Ambiguous rows are capped the same way
    # (:184) but the remainder is NOT stated, so only a floor is checkable
    # there — any is not none, and the parse may never exceed the report.
    counts=$(grep -E "^ref runs: [1-9][0-9]* +cand runs: [1-9][0-9]* +mismatches: [0-9]+ +ambiguous: [0-9]+$" "$log" | tail -1)
    said_m=${counts##*mismatches: }
    said_m=${said_m%% *}
    said_a=${counts##*ambiguous: }
    more=$(sed -n 's/^ *… and \([0-9][0-9]*\) more (truncated print, all counted)$/\1/p' "$log" | tail -1)
    if [ $((n + d + ${more:-0})) -ne "$said_m" ] ||
      [ "$a" -gt "$said_a" ] ||
      { [ "$said_a" -gt 0 ] && [ "$a" -eq 0 ]; }; then
      BROKEN=$((BROKEN + 1))
      echo "census.sh: $log reports mismatches: $said_m ambiguous: $said_a, but" >&2
      echo "           census-count.mjs read $((n + d)) mismatch row(s)${more:+ (+ $more truncated)} and $a ambiguous." >&2
      echo "           The census and its reader disagree; there is no count to report." >&2
      line="$line$(printf '%8s' '!!')"
      continue
    fi
    AMB=$((AMB + a))
    DECL=$((DECL + d))
    TOTAL=$((TOTAL + n))
    line="$line$(printf '%8s' "$n")"
  done
  echo "$line"
done < <(pages)

echo
# GUARD 3 — something was actually censused. Process substitution above, NOT a
# pipe: a pipe runs the loop in a subshell and every counter here would still
# read 0, which is exactly the green this file exists to stop (gate.sh:123-125
# records the same trap for FAILED_PREFLIGHT). A page name that matches nothing
# must not report CLEAN either — strikes.mjs:147-156 is the same refusal, and
# it was written because a typo silently greened rule 3 on six of nine pages.
if [ "$ROWS" -eq 0 ]; then
  if [ -n "$SEEN" ]; then
    echo "census.sh: \"${WANT[*]:-}\" matches no page — refusing to report CLEAN." >&2
    echo "           known pages:$SEEN" >&2
  else
    echo "census.sh: the page table is empty — refusing to report CLEAN." >&2
    echo "           node matching/harness.mjs --table printed no rows; check" >&2
    echo "           \"pages\" in matching/harness.json." >&2
  fi
  exit 2
fi
if [ "$BROKEN" -gt 0 ]; then
  echo "CENSUS INCOMPLETE — $BROKEN of $RUNS run(s) produced no usable census (marked !!)."
  echo "Those page/viewport pairs have NOT been measured; there is no count to"
  echo "report for them, and the totals below would be a floor, not a score."
  echo "Full runs: matching/census-<page>-<vw>.log"
  exit 2
fi
if [ "$TOTAL" -eq 0 ]; then
  echo "Phase 3 CLEAN — 0 undeclared type mismatches ($DECL declared, $AMB ambiguous)."
  echo "($RUNS censused run(s) over $ROWS page(s), each one counted.)"
  [ "$AMB" -gt 0 ] && echo "($AMB ambiguous same-text rows remain: each needs ADJUDICATING," &&
    echo " not fixing — our element matches, another sharing its text does not.)"
  exit 0
fi
echo "$TOTAL type mismatch(es) remain (+ $AMB ambiguous, $DECL declared)."
echo "Full runs: matching/census-<page>-<vw>.log"
echo "A mismatch is a defect or a ledgered deviation. An ambiguous row is neither"
echo "until you look: the census keys on TEXT, so two different elements sharing a"
echo "string land under one key and only one of them may be wrong."
exit 1
